import { Message } from '@aws-sdk/client-sqs'
import { START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { AppComponents, QueueWorker } from '../types'

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

  const [mainQueueUrl, retryQueueUrl] = await Promise.all([
    config.requireString('QUEUE_NAME'), // TODO: rename to QUEUE_URL
    config.requireString('RETRY_QUEUE_NAME') // TODO: rename to RETRY_QUEUE_URL
  ])

  async function processLoop() {
    while (isRunning) {
      const { queueUrl, messages } = await poll()
      await processMessages(queueUrl, messages)
    }
  }

  async function poll() {
    let queueUrl = mainQueueUrl
    let messages = await queue.receiveMessage(queueUrl, { maxNumberOfMessages: 10 })
    if (messages.length === 0) {
      queueUrl = retryQueueUrl
      messages = await queue.receiveMessage(queueUrl, { maxNumberOfMessages: 1 })
    }

    return { queueUrl, messages }
  }

  async function processMessages(queueUrl: string, messages: Message[]) {
    logger.debug(`Processing: ${messages.length} profiles`)

    const { validMessages, invalidMessages } = messageValidator.validateMessages(messages)

    await Promise.all(invalidMessages.map(({ message }) => queue.deleteMessage(queueUrl, message.ReceiptHandle!)))

    if (validMessages.length === 0) {
      return
    }

    const entities = await entityFetcher.getEntitiesByIds(validMessages.map(({ event }) => event.entity.id))

    logger.debug(`Got ${entities.length} active entities`)

    const results = await imageProcessor.processEntities(entities)

    const messageByEntity = new Map(validMessages.map(({ message, event }) => [event.entity.id, message]))

    for (const result of results) {
      const message = messageByEntity.get(result.entity)!

      if (result.success) {
        await queue.deleteMessage(queueUrl, message.ReceiptHandle!)
      } else if (result.shouldRetry && result.avatar) {
        const event = JSON.parse(message.Body!)
        await queue.sendMessage(retryQueueUrl, event)
        await queue.deleteMessage(queueUrl, message.ReceiptHandle!)
      } else {
        await queue.deleteMessage(queueUrl, message.ReceiptHandle!)
      }
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
