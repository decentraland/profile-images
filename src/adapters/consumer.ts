import { Message, MessageSystemAttributeName } from '@aws-sdk/client-sqs'
import { START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { CatalystDeploymentEvent, Entity } from '@dcl/schemas'
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
  config,
  metrics
}: Pick<
  AppComponents,
  'logs' | 'entityFetcher' | 'imageProcessor' | 'messageValidator' | 'mainQueue' | 'dlQueue' | 'config' | 'metrics'
>): Promise<QueueWorker> {
  const logger = logs.getLogger('consumer')
  const isDLQ = (queue: QueueComponent) => queue === dlQueue
  const maxDLQRetries = (await config.getNumber('MAX_DLQ_RETRIES')) || 3
  const godotBaseTimeoutSeconds = ((await config.getNumber('GODOT_BASE_TIMEOUT')) || 15_000) / 1000
  const godotPerAvatarTimeoutSeconds = ((await config.getNumber('GODOT_AVATAR_TIMEOUT')) || 10_000) / 1000
  const visibilityBufferSeconds = 120
  const visibilityExtensionTimeoutMs = 10_000

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

    const visibilityTimeout = Math.ceil(
      godotBaseTimeoutSeconds + godotPerAvatarTimeoutSeconds * allEntities.length + visibilityBufferSeconds
    )
    const receiptHandles = validMessages.map(({ message }) => message.ReceiptHandle!).filter(Boolean)
    const visibilityExtended = await extendVisibilityForAll(queue, receiptHandles, visibilityTimeout)

    if (!visibilityExtended) {
      logger.warn(`Skipping processing because visibility could not be extended for all messages`)
      return
    }

    const visibilityHeartbeat = startVisibilityHeartbeat(queue, receiptHandles, visibilityTimeout)
    let results: ProcessingResult[]
    try {
      results = await imageProcessor.processEntities(allEntities)
    } finally {
      await visibilityHeartbeat.stop()
    }

    if (visibilityHeartbeat.hasVisibilityBeenLost()) {
      logger.warn(`Skipping message deletion because visibility was lost while processing`)
      return
    }

    logger.debug(`Processed ${results.length} entities`)

    const messageByEntity = new Map(validMessages.map(({ message, event }) => [event.entity.id, { message, event }]))
    const entityById = new Map(allEntities.map((e) => [e.id, e]))
    const messagesToDelete = []

    for (const result of results) {
      const { message, event } = messageByEntity.get(result.entity)!
      const shouldDelete =
        result.success || !result.shouldRetry || (isDLQ(queue) && getReceiveCount(message) >= maxDLQRetries)

      if (shouldDelete) {
        messagesToDelete.push(message.ReceiptHandle!)
      }

      if (result.success) {
        handleSuccess(event, queue, result, entityById.get(result.entity))
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

  async function extendVisibilityForAll(
    queue: QueueComponent,
    receiptHandles: string[],
    visibilityTimeout: number
  ): Promise<boolean> {
    const extensionResults = await Promise.allSettled(
      receiptHandles.map((handle) =>
        withTimeout(
          queue.extendVisibility(handle, visibilityTimeout),
          visibilityExtensionTimeoutMs,
          `Timed out extending visibility for message`
        )
      )
    )
    let failedExtensions = 0

    for (const extensionResult of extensionResults) {
      if (extensionResult.status === 'rejected') {
        failedExtensions++
        logger.warn(`Failed to extend visibility for message`, { error: String(extensionResult.reason) })
      }
    }

    return failedExtensions === 0
  }

  function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeout: NodeJS.Timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
    })

    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout))
  }

  function startVisibilityHeartbeat(
    queue: QueueComponent,
    receiptHandles: string[],
    visibilityTimeout: number
  ): { stop: () => Promise<void>; hasVisibilityBeenLost: () => boolean } {
    const heartbeatIntervalMs = Math.max(30, Math.floor(visibilityTimeout / 2)) * 1000
    const pendingHeartbeats = new Set<Promise<void>>()
    let visibilityLost = false

    const runHeartbeat = () => {
      const heartbeatPromise = extendVisibilityForAll(queue, receiptHandles, visibilityTimeout)
        .then((wasExtended) => {
          if (!wasExtended) {
            visibilityLost = true
          }
        })
        .finally(() => pendingHeartbeats.delete(heartbeatPromise))

      pendingHeartbeats.add(heartbeatPromise)
    }

    const heartbeat = setInterval(runHeartbeat, heartbeatIntervalMs)
    heartbeat.unref?.()

    return {
      async stop() {
        clearInterval(heartbeat)
        await Promise.allSettled([...pendingHeartbeats])
      },
      hasVisibilityBeenLost() {
        return visibilityLost
      }
    }
  }

  function handleSuccess(
    event: CatalystDeploymentEvent,
    queue: QueueComponent,
    result: ProcessingResult,
    processedEntity?: Entity
  ) {
    const queueName = isDLQ(queue) ? 'DLQ' : 'main'
    logger.info(`Successfully processed message from ${queueName} for entity ${result.entity}`)

    const durationInSeconds = (Date.now() - event.timestamp) / 1000
    if (durationInSeconds > 0) {
      metrics.observe('sqs_message_publication_to_image_generation_duration_seconds', {}, durationInSeconds)
      logger.debug(`SQS message publication to image generation duration: ${durationInSeconds}s`)
    }

    const pointers = Array.isArray(processedEntity?.pointers)
      ? processedEntity.pointers
      : Array.isArray(event.entity.pointers)
        ? event.entity.pointers
        : []
    const entityTimestamp = processedEntity?.timestamp ?? event.entity.timestamp ?? 0
    for (const pointer of pointers) {
      if (typeof pointer === 'string') {
        messageValidator.markPointerProcessed(pointer, entityTimestamp)
      }
    }
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
