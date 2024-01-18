import { Message } from '@aws-sdk/client-sqs'
import { AppComponents, ExtendedAvatar, QueueWorker } from '../types'
import { sleep } from '../logic/sleep'

export async function createConsumerComponent({
  config,
  logs,
  godot,
  queue,
  storage,
  retryQueue,
  metrics
}: Pick<
  AppComponents,
  'config' | 'logs' | 'godot' | 'queue' | 'storage' | 'retryQueue' | 'metrics'
>): Promise<QueueWorker> {
  const logger = logs.getLogger('consumer')
  const maxJobs = (await config.getNumber('MAX_JOBS')) || 10

  const [commitHash, version] = await Promise.all([
    config.getString('COMMIT_HASH'),
    config.getString('CURRENT_VERSION')
  ])

  let paused = false
  function setPaused(p: boolean): void {
    paused = p
  }

  async function start() {
    logger.debug('Starting consumer')
    while (true) {
      if (paused) {
        await sleep(60 * 1000)
        continue
      }

      const messages = await Promise.race([queue.receive(maxJobs), retryQueue.receive(1)])

      if (messages.length === 0) {
        continue
      }

      logger.debug(`Processing: ${messages.length} profiles`)

      const messageByEntity = new Map<string, Message>()

      const input: ExtendedAvatar[] = []
      for (const message of messages) {
        if (!message.Body) {
          logger.warn(
            `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with undefined Body`
          )
          await queue.deleteMessage(message.ReceiptHandle!)
          continue
        }
        const body: ExtendedAvatar = JSON.parse(message.Body)
        if (!body.avatar) {
          logger.warn(
            `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with invalid Body: ${message.Body}`
          )
          await queue.deleteMessage(message.ReceiptHandle!)
          continue
        }
        messageByEntity.set(body.entity, message)

        input.push(body)
      }

      const results = await godot.generateImages(input)

      for (const result of results) {
        const message = messageByEntity.get(result.entity)!
        if (result.success) {
          const success = await storage.storeImages(result.entity, result.avatarPath, result.facePath)
          if (!success) {
            logger.error(`Error saving generated images to s3 for entity=${result.entity}`)
            continue
          }
        } else if (messages.length === 1) {
          metrics.increment('snapshot_generation_failures', {}, 1)
          logger.debug(`Giving up on entity=${result.entity} because of godot failure.`)
          const failure = {
            commitHash,
            version,
            entity: result.entity,
            output: result.output
          }
          await storage.store(`failures/${result.entity}.txt`, Buffer.from(JSON.stringify(failure)), 'text/plain')
        } else {
          logger.debug(`Godot failure, enqueue for individual retry, entity=${result.entity}`)
          await retryQueue.send({ entity: result.entity, avatar: result.avatar })
        }

        await queue.deleteMessage(message.ReceiptHandle!)
      }
    }
  }

  return { setPaused, start }
}
