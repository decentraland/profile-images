import { AppComponents, ExtendedAvatar, QueueWorker } from '../types'

export async function createRetryConsumerComponent({
  logs,
  godot,
  storage,
  retryQueue,
  config
}: Pick<AppComponents, 'logs' | 'godot' | 'storage' | 'retryQueue' | 'config'>): Promise<QueueWorker> {
  const logger = logs.getLogger('retry-consumer')

  const [commitHash, version] = await Promise.all([
    config.getString('COMMIT_HASH'),
    config.getString('CURRENT_VERSION')
  ])

  async function start() {
    logger.debug('Starting retry consumer')
    while (true) {
      const messages = await retryQueue.receive(1)
      if (messages.length === 0) {
        continue
      }
      const message = messages[0]
      const avatar: ExtendedAvatar = JSON.parse(message.Body!)

      const results = await godot.generateImages([avatar])
      const result = results[0]

      if (result.success) {
        const success = await storage.storeImages(result.entity, result.avatarPath, result.facePath)
        if (!success) {
          logger.error(`Error saving generated images to s3 for entity=${result.entity}`)
          return
        }
      } else {
        logger.debug(`Giving up on entity="${result.entity} because of godot failure.`)
        const failure = {
          commitHash,
          version,
          entity: result.entity
        }
        await storage.store(`failures/${result.entity}.txt`, Buffer.from(JSON.stringify(failure)), 'text/plain')
      }

      await retryQueue.deleteMessage(message.ReceiptHandle!)
    }
  }

  return { start }
}
