import { AppComponents, QueueMessage, QueueWorker } from '../types'

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
      const { entity }: QueueMessage = JSON.parse(message.Body!)

      try {
        const results = await godot.generateImages([entity])
        const result = results[0]

        if (result.success) {
          result.success = await storage.storeImages(entity, result.avatarPath, result.facePath)
        }

        if (!result.success) {
          const body: QueueMessage = JSON.parse(message.Body!)
          const attempts = body.attempt
          if (attempts < 4) {
            const message: QueueMessage = { entity: result.entity, attempt: attempts + 1 }
            await retryQueue.send(message, { delay: 15 })
            logger.debug(`Added to queue entity="${result.entity} with retry attempt=${attempts + 1}"`)
          } else {
            logger.debug(`Giving up on entity="${result.entity} after 5 retries.`)
          }
        }
        await retryQueue.deleteMessage(message.ReceiptHandle!)
      } catch (err) {
        logger.debug(`Giving up on entity="${entity} because of godot failure.`)
        const failure = {
          error: err,
          commitHash,
          version,
          entity
        }
        try {
          await storage.store(`failures/${entity}.txt`, Buffer.from(JSON.stringify(failure)), 'text/plain')
        } catch (err) {
          logger.error(`cannot store ${entity} failure: ${JSON.stringify(err)}`)
        }
      }

      await retryQueue.deleteMessage(message.ReceiptHandle!)
    }
  }

  return { start }
}
