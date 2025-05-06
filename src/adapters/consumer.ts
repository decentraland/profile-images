import { Message, MessageSystemAttributeName } from '@aws-sdk/client-sqs'
import { START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { AppComponents, QueueWorker } from '../types'
import { ProcessingResult } from '../logic/image-processor'
import { getReceiveCount } from '../utils/sqs'

export const MESSAGE_SYSTEM_ATTRIBUTE_NAMES: MessageSystemAttributeName[] = ['ApproximateReceiveCount', 'SentTimestamp']

export async function createConsumerComponent({
  config,
  logs,
  entityFetcher,
  imageProcessor,
  messageValidator,
  queue
}: Pick<
  AppComponents,
  'config' | 'logs' | 'entityFetcher' | 'imageProcessor' | 'messageValidator' | 'queue'
>): Promise<QueueWorker> {
  const logger = logs.getLogger('consumer')
  let isRunning = false
  let processLoopPromise: Promise<void> | null = null

  const [mainQueueUrl, dlqUrl] = await Promise.all([config.requireString('QUEUE_URL'), config.requireString('DLQ_URL')])

  const isDLQ = (queueUrl: string) => queueUrl === dlqUrl

  async function processLoop() {
    while (isRunning) {
      const { queueUrl, messages } = await poll()
      await processMessages(queueUrl, messages)
    }
  }

  async function poll() {
    let queueUrl = mainQueueUrl
    let messages = await queue.receiveMessage(queueUrl, {
      maxNumberOfMessages: 10,
      messageSystemAttributeNames: MESSAGE_SYSTEM_ATTRIBUTE_NAMES
    })
    if (messages.length === 0) {
      queueUrl = dlqUrl
      messages = await queue.receiveMessage(queueUrl, {
        maxNumberOfMessages: 1,
        messageSystemAttributeNames: MESSAGE_SYSTEM_ATTRIBUTE_NAMES
      })
    }

    return { queueUrl, messages }
  }

  async function processMessages(queueUrl: string, messages: Message[]) {
    const queueName = isDLQ(queueUrl) ? 'dlq' : 'main'
    logger.debug(`Processing: ${messages.length} profiles from ${queueName} queue`)

    const { validMessages, invalidMessages } = messageValidator.validateMessages(messages)

    if (invalidMessages.length > 0) {
      logger.warn(`Deleting ${invalidMessages.length} invalid messages from ${queueName} queue`)
      await queue.deleteMessages(
        queueUrl,
        invalidMessages.map(({ message }) => message.ReceiptHandle!)
      )
    }

    if (validMessages.length === 0) {
      return
    }

    const entities = await entityFetcher.getEntitiesByIds(validMessages.map(({ event }) => event.entity.id))

    logger.debug(`Got ${entities.length} active entities from ${queueName} queue`)

    const results = await imageProcessor.processEntities(entities)

    const messageByEntity = new Map(validMessages.map(({ message, event }) => [event.entity.id, message]))

    const messagesToDelete = []

    for (const result of results) {
      const message = messageByEntity.get(result.entity)!
      const shouldDelete = result.success || !result.shouldRetry

      if (shouldDelete) {
        messagesToDelete.push(message.ReceiptHandle!)
      }

      if (result.success) {
        await handleSuccess(message, queueUrl, result)
      } else {
        await handleFailure(message, queueUrl, result)
      }
    }

    if (messagesToDelete.length > 0) {
      await queue.deleteMessages(queueUrl, messagesToDelete)
    }
  }

  async function handleSuccess(_message: Message, queueUrl: string, result: ProcessingResult) {
    if (isDLQ(queueUrl)) {
      logger.info(`Successfully processed message from DLQ for entity ${result.entity}`)
    }
  }

  async function handleFailure(message: Message, queueUrl: string, result: ProcessingResult) {
    const receiveCount = getReceiveCount(message)
    const error = result.error || 'Unknown error'

    if (isDLQ(queueUrl)) {
      logger.warn(`Processing failed in DLQ for entity ${result.entity}`, {
        error,
        receiveCount,
        age: Date.now() - parseInt(message.Attributes?.SentTimestamp || '0')
      })
    } else if (!result.shouldRetry) {
      logger.warn(`Not retrying - Deleting from main queue: ${result.entity}`, {
        error,
        receiveCount
      })
    } else {
      logger.warn(`Processing failed - Will retry: ${result.entity}`, {
        error,
        receiveCount
      })
    }
  }

  async function start() {
    logger.debug('Starting consumer')
    isRunning = true

    // Start the processing loop in the background
    processLoopPromise = processLoop()

    // Return immediately to not block other components
    return Promise.resolve()
  }

  async function stop() {
    logger.debug('Stopping consumer')
    isRunning = false

    if (processLoopPromise) {
      await processLoopPromise
      processLoopPromise = null
    }
  }

  return { [START_COMPONENT]: start, [STOP_COMPONENT]: stop, processMessages, poll }
}
