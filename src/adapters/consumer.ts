import { Message } from '@aws-sdk/client-sqs'
import { AppComponents, ExtendedAvatar, QueueWorker } from '../types'
import { sleep } from '../logic/sleep'

export async function createConsumerComponent({
  config,
  logs,
  godot,
  queueService,
  storage,
  metrics
}: Pick<AppComponents, 'config' | 'logs' | 'godot' | 'storage' | 'queueService' | 'metrics'>): Promise<QueueWorker> {
  const logger = logs.getLogger('consumer')
  const maxJobs = (await config.getNumber('MAX_JOBS')) || 10

  const [mainQueueUrl, retryQueueUrl, commitHash, version] = await Promise.all([
    config.requireString('QUEUE_NAME'),
    config.requireString('RETRY_QUEUE_NAME'),
    config.getString('COMMIT_HASH'),
    config.getString('CURRENT_VERSION')
  ])

  async function poll() {
    let queueUrl = mainQueueUrl
    let messages = await queueService.receive(queueUrl, { maxNumberOfMessages: maxJobs })
    if (messages.length === 0) {
      queueUrl = retryQueueUrl
      messages = await queueService.receive(queueUrl, { maxNumberOfMessages: 1 })
    }

    return { queueUrl, messages }
  }

  async function start() {
    logger.debug('Starting consumer')
    while (true) {
      const { queueUrl, messages } = await poll()

      if (messages.length === 0) {
        await sleep(20 * 1000)
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
          await queueService.deleteMessage(queueUrl, message.ReceiptHandle!)
          continue
        }
        const body: ExtendedAvatar = JSON.parse(message.Body)
        if (!body.avatar) {
          logger.warn(
            `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with invalid Body: ${message.Body}`
          )
          await queueService.deleteMessage(queueUrl, message.ReceiptHandle!)
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
          await queueService.send(retryQueueUrl, { entity: result.entity, avatar: result.avatar })
        }

        await queueService.deleteMessage(queueUrl, message.ReceiptHandle!)
      }
    }
  }

  return { start }
}
