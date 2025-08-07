import { Message, MessageSystemAttributeName } from '@aws-sdk/client-sqs'
import { START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { Entity } from '@dcl/schemas'
import { AppComponents, QueueWorker } from '../types'
import { ProcessingResult } from '../logic/image-processor'
import { getReceiveCount } from '../utils/sqs'
import { QueueComponent } from '../logic/queue'

export const MESSAGE_SYSTEM_ATTRIBUTE_NAMES: MessageSystemAttributeName[] = ['ApproximateReceiveCount', 'SentTimestamp']

export async function createConsumerComponent({
  logs,
  entityFetcher,
  imageProcessor,
  messageValidator,
  mainQueue,
  dlQueue,
  config
}: Pick<
  AppComponents,
  'logs' | 'entityFetcher' | 'imageProcessor' | 'messageValidator' | 'mainQueue' | 'dlQueue' | 'config'
>): Promise<QueueWorker> {
  const logger = logs.getLogger('consumer')
  const isDLQ = (queue: QueueComponent) => queue === dlQueue
  const maxDLQRetries = (await config.getNumber('MAX_DLQ_RETRIES')) || 3

  let isRunning = false
  let processLoopPromise: Promise<void> | null = null

  async function processLoop() {
    while (isRunning) {
      const { queue, messages } = await poll()
      await processMessages(queue, messages)
    }
  }

  async function poll() {
    let queue = mainQueue
    let messages = await mainQueue.receiveMessage({
      maxNumberOfMessages: 10,
      messageSystemAttributeNames: MESSAGE_SYSTEM_ATTRIBUTE_NAMES
    })

    if (messages.length === 0) {
      queue = dlQueue
      messages = await dlQueue.receiveMessage({
        maxNumberOfMessages: 1,
        messageSystemAttributeNames: MESSAGE_SYSTEM_ATTRIBUTE_NAMES
      })
    }

    return { queue, messages }
  }

  async function processMessages(queue: QueueComponent, messages: Message[]) {
    const queueName = isDLQ(queue) ? 'DLQ' : 'main'
    logger.debug(`Processing: ${messages.length} profiles from ${queueName} queue`)

    const { validMessages, invalidMessages } = messageValidator.validateMessages(messages)

    if (invalidMessages.length > 0) {
      logger.warn(`Deleting ${invalidMessages.length} invalid messages from ${queueName} queue`)
      await queue.deleteMessages(invalidMessages.map(({ message }) => message.ReceiptHandle!))
    }

    if (validMessages.length === 0) {
      return
    }

    const entitiesFromMessages: Entity[] = []
    const messagesNeedingFetcher: Array<{ message: Message; event: any }> = []

    for (const { message, event } of validMessages) {
      const { entity } = event

      if (
        entity &&
        entity.metadata &&
        entity.metadata.avatars &&
        entity.metadata.avatars.length > 0 &&
        entity.metadata.avatars[0].avatar
      ) {
        entitiesFromMessages.push(entity)
      } else {
        messagesNeedingFetcher.push({ message, event })
      }
    }

    logger.debug(`Got ${entitiesFromMessages.length} entities from messages that can be processed`)

    let entitiesFromFetcher: Entity[] = []
    if (messagesNeedingFetcher.length > 0) {
      logger.debug(`Fetching ${messagesNeedingFetcher.length} entities from fetcher`)
      entitiesFromFetcher = await entityFetcher.getEntitiesByIds(
        messagesNeedingFetcher.map(({ event }) => event.entity.id)
      )
    }

    const allEntities = [...entitiesFromMessages, ...entitiesFromFetcher]

    if (allEntities.length === 0) {
      logger.warn(`No entities found for messages, deleting from ${queueName} queue`)
      await queue.deleteMessages(validMessages.map(({ message }) => message.ReceiptHandle!))
      return
    }

    logger.debug(
      `Got ${allEntities.length} active entities from ${queueName} queue (${entitiesFromMessages.length} from messages, ${entitiesFromFetcher.length} from fetcher)`
    )

    const results = await imageProcessor.processEntities(allEntities)

    logger.debug(`Processed ${results.length} entities`)

    const messageByEntity = new Map(validMessages.map(({ message, event }) => [event.entity.id, message]))
    const messagesToDelete = []

    for (const result of results) {
      const message = messageByEntity.get(result.entity)!
      const shouldDelete =
        result.success || !result.shouldRetry || (isDLQ(queue) && getReceiveCount(message) >= maxDLQRetries)

      if (shouldDelete) {
        messagesToDelete.push(message.ReceiptHandle!)
      }

      if (result.success) {
        handleSuccess(message, queue, result)
      } else {
        handleFailure(message, queue, result)
      }
    }

    // Non deleted messages will be moved to the DLQ by the RedrivePolicy configured in the definition
    if (messagesToDelete.length > 0) {
      logger.debug(`Deleting ${messagesToDelete.length} messages from ${queueName} queue`)
      await queue.deleteMessages(messagesToDelete)
    }
  }

  function handleSuccess(_message: Message, queue: QueueComponent, result: ProcessingResult) {
    const queueName = isDLQ(queue) ? 'DLQ' : 'main'
    logger.info(`Successfully processed message from ${queueName} for entity ${result.entity}`)
  }

  function handleFailure(message: Message, queue: QueueComponent, result: ProcessingResult) {
    const receiveCount = getReceiveCount(message)
    const error = result.error || 'Unknown error'

    if (isDLQ(queue)) {
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
