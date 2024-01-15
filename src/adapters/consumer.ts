import { Message } from '@aws-sdk/client-sqs'
import { AppComponents, QueueMessage, QueueWorker } from '../types'

export async function createConsumerComponent({
  config,
  logs,
  godot,
  queue,
  storage,
  retryQueue
}: Pick<AppComponents, 'config' | 'logs' | 'godot' | 'queue' | 'storage' | 'retryQueue'>): Promise<QueueWorker> {
  const logger = logs.getLogger('consumer')
  const maxJobs = (await config.getNumber('MAX_JOBS')) || 10

  async function start() {
    logger.debug('Starting consumer')
    while (true) {
      const messages = await queue.receive(maxJobs)
      if (messages.length === 0) {
        continue
      }

      logger.debug(`Processing: ${messages.length} profiles`)

      const messageByEntity = new Map<string, Message>()
      for (const message of messages) {
        if (!message.Body) {
          logger.warn(
            `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with undefined Body`
          )
          await queue.deleteMessage(message.ReceiptHandle!)
          continue
        }
        const body: QueueMessage = JSON.parse(message.Body)
        if (body.entity === undefined || body.attempt === undefined) {
          logger.warn(
            `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with invalid Body: ${message.Body}`
          )
          await queue.deleteMessage(message.ReceiptHandle!)
          continue
        }
        messageByEntity.set(body.entity, message)
      }

      const results = await godot.generateImages(Array.from(messageByEntity.keys()))

      for (const result of results) {
        const message = messageByEntity.get(result.entity)!
        if (result.success) {
          const success = await storage.storeImages(result.entity, result.avatarPath, result.facePath)
          if (!success) {
            continue
          }
        } else if (!result.entityFound) {
          // NOTE: most likely the entity is not active, but we requeue in case the entity is not yet synchonized
          const body: QueueMessage = JSON.parse(message.Body!)
          const attempts = body.attempt
          if (attempts < 4) {
            const message: QueueMessage = { entity: result.entity, attempt: attempts + 1 }
            await queue.send(message, { delay: 60 })
            logger.debug(`Added to queue entity="${result.entity} with retry attempt=${attempts + 1}"`)
          } else {
            logger.debug(`Giving up on entity="${result.entity} after 5 retries.`)
          }
        } else {
          logger.debug(`Godot failure, enqueue for individual retry, entity=${result.entity}`)
          await retryQueue.send({ entity: result.entity, attempt: 0 })
        }

        await queue.deleteMessage(message.ReceiptHandle!)
      }
    }
  }

  return { start }
}
