import { Message, MessageSystemAttributeName } from '@aws-sdk/client-sqs'
import { START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { Entity } from '@dcl/schemas'
import { AppComponents, QueueWorker } from '../types'
import { ProcessingResult } from '../logic/image-processor'
import { getReceiveCount } from '../utils/sqs'
import { QueueComponent } from '../logic/queue'

export const MESSAGE_SYSTEM_ATTRIBUTE_NAMES: MessageSystemAttributeName[] = ['ApproximateReceiveCount', 'SentTimestamp']

export function createConsumerComponent({
  logs,
  entityFetcher,
  imageProcessor,
  messageValidator,
  mainQueue,
  dlQueue
}: Pick<
  AppComponents,
  'logs' | 'entityFetcher' | 'imageProcessor' | 'messageValidator' | 'mainQueue' | 'dlQueue'
>): QueueWorker {
  const logger = logs.getLogger('consumer')
  const isDLQ = (queue: QueueComponent) => queue === dlQueue

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

  function formatEntityFromMessage(event: any): Entity | null {
    if (
      event.entity &&
      event.entity.metadata &&
      event.entity.metadata.avatars &&
      event.entity.metadata.avatars.length > 0 &&
      event.entity.metadata.avatars[0].avatar
    ) {
      return {
        id: event.entity.entityId,
        type: event.entity.entityType,
        version: event.entity.version || 'v3',
        pointers: event.entity.pointers || [event.entity.entityId],
        timestamp: event.entity.entityTimestamp || event.entity.localTimestamp || Date.now(),
        content: event.entity.content || [],
        metadata: event.entity.metadata
      }
    }

    return null
  }

  async function processMessages(queue: QueueComponent, messages: Message[]) {
    const queueName = isDLQ(queue) ? 'dlq' : 'main'
    logger.debug(`Processing: ${messages.length} profiles from queue`)

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
      const entity = formatEntityFromMessage(event)
      if (entity) {
        entitiesFromMessages.push(entity)
      } else {
        messagesNeedingFetcher.push({ message, event })
      }
    }

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

    const messageByEntity = new Map(validMessages.map(({ message, event }) => [event.entity.id, message]))

    const messagesToDelete = []

    for (const result of results) {
      const message = messageByEntity.get(result.entity)!
      const shouldDelete = result.success || !result.shouldRetry

      if (shouldDelete) {
        messagesToDelete.push(message.ReceiptHandle!)
      }

      if (result.success) {
        await handleSuccess(message, queue, result)
      } else {
        await handleFailure(message, queue, result)
      }
    }

    if (messagesToDelete.length > 0) {
      await queue.deleteMessages(messagesToDelete)
    }
  }

  async function handleSuccess(_message: Message, queue: QueueComponent, result: ProcessingResult) {
    if (isDLQ(queue)) {
      logger.info(`Successfully processed message from DLQ for entity ${result.entity}`)
    }
  }

  async function handleFailure(message: Message, queue: QueueComponent, result: ProcessingResult) {
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
