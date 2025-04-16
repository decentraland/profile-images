import { Message } from '@aws-sdk/client-sqs'
import { START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import { AppComponents, ExtendedAvatar, QueueWorker } from '../types'
import { sqsDeleteMessage, sqsReceiveMessage, sqsSendMessage } from '../logic/queue'
import { CatalystDeploymentEvent, Entity, EntityType } from '@dcl/schemas'

export async function createConsumerComponent({
  config,
  logs,
  godot,
  sqsClient,
  storage,
  metrics,
  fetch
}: Pick<
  AppComponents,
  'config' | 'logs' | 'godot' | 'storage' | 'sqsClient' | 'metrics' | 'fetch'
>): Promise<QueueWorker> {
  const logger = logs.getLogger('consumer')
  let isRunning = false
  let processLoopPromise: Promise<void> | null = null

  const [mainQueueUrl, retryQueueUrl, commitHash, version, peerUrl] = await Promise.all([
    config.requireString('QUEUE_NAME'), // TODO: rename to QUEUE_URL
    config.requireString('RETRY_QUEUE_NAME'), // TODO: rename to RETRY_QUEUE_URL
    config.getString('COMMIT_HASH'),
    config.getString('CURRENT_VERSION'),
    config.requireString('PEER_URL')
  ])

  async function processLoop() {
    while (isRunning) {
      const { queueUrl, messages } = await poll()
      await process(queueUrl, messages)
    }
  }

  async function poll() {
    let queueUrl = mainQueueUrl
    let messages = await sqsReceiveMessage(sqsClient, queueUrl, { maxNumberOfMessages: 10 })
    if (messages.length === 0) {
      queueUrl = retryQueueUrl
      messages = await sqsReceiveMessage(sqsClient, queueUrl, { maxNumberOfMessages: 1 })
    }

    return { queueUrl, messages }
  }

  async function process(queueUrl: string, messages: Message[]) {
    logger.debug(`Processing: ${messages.length} profiles`)

    const messageByEntity = new Map<string, Message>()

    const events: CatalystDeploymentEvent[] = []
    for (const message of messages) {
      if (!message.Body) {
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with undefined Body`
        )
        await sqsDeleteMessage(sqsClient, queueUrl, message.ReceiptHandle!)
        return
      }

      const event: CatalystDeploymentEvent = JSON.parse(message.Body)
      if (!event.entity || event.entity.type !== EntityType.PROFILE) {
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with invalid Body: ${message.Body}`
        )
        await sqsDeleteMessage(sqsClient, queueUrl, message.ReceiptHandle!)
        return
      }

      if (messageByEntity.has(event.entity.id)) {
        // NOTE: we are already processing this entity in the batch
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with duplicate entity: ${event.entity.id}`
        )
        await sqsDeleteMessage(sqsClient, queueUrl, message.ReceiptHandle!)
        continue
      }

      messageByEntity.set(event.entity.id, message)

      events.push(event)
    }

    const response = await fetch.fetch(`${peerUrl}/content/entities/active`, {
      method: 'POST',
      body: JSON.stringify({ ids: events.map((event) => event.entity.id) })
    })

    const activeEntities: Entity[] = await response.json()
    const avatars: ExtendedAvatar[] = activeEntities.map(({ id, metadata }) => ({
      entity: id,
      avatar: metadata.avatars[0].avatar
    }))

    logger.debug(`Got ${activeEntities.length} active entities`)

    const { avatars: results, output: outputGenerated } = await godot.generateImages(avatars)

    for (const result of results) {
      const message = messageByEntity.get(result.entity)!
      if (result.success) {
        metrics.increment('snapshot_generation_count', { status: 'success' }, 1)
        const success = await storage.storeImages(result.entity, result.avatarPath, result.facePath)
        if (!success) {
          logger.error(`Error saving generated images to s3 for entity=${result.entity}`)
          continue
        }
      } else if (messages.length === 1) {
        metrics.increment('snapshot_generation_count', { status: 'failure' }, 1)
        logger.debug(`Giving up on entity=${result.entity} because of godot failure.`)
        const failure = {
          timestamp: new Date().toISOString(),
          commitHash,
          version,
          entity: result.entity,
          outputGenerated
        }
        await storage.storeFailure(result.entity, JSON.stringify(failure))
      } else {
        logger.debug(`Godot failure, enqueue for individual retry, entity=${result.entity}`)
        await sqsSendMessage(sqsClient, retryQueueUrl, { entity: result.entity, avatar: result.avatar })
      }

      await sqsDeleteMessage(sqsClient, queueUrl, message.ReceiptHandle!)
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

  return { [START_COMPONENT]: start, [STOP_COMPONENT]: stop, process, poll }
}
