import { Message } from '@aws-sdk/client-sqs'
import { AppComponents, QueueMessage, QueueWorker } from '../types'
import fs from 'fs/promises'

export async function createConsumerComponent({
  config,
  logs,
  godot,
  queue,
  storage
}: Pick<AppComponents, 'config' | 'logs' | 'godot' | 'queue' | 'storage'>): Promise<QueueWorker> {
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

      console.time('generate images + upload to s3')
      try {
        const results = await godot.generateImages(Array.from(messageByEntity.keys()))
        logger.debug(`results: ${JSON.stringify(results)}`)

        for (const result of results) {
          if (result.status) {
            try {
              const [body, face] = await Promise.all([fs.readFile(result.avatarPath), fs.readFile(result.facePath)])
              await Promise.all([
                storage.store(`entities/${result.entity}/body.png`, body),
                storage.store(`entities/${result.entity}/face.png`, face)
              ])
            } catch (err) {
              logger.debug(`Error uploading images to bucket, marking job for retrying it: "${result.entity}"`)
              result.status = false
            } finally {
              Promise.all([fs.rm(result.avatarPath), fs.rm(result.facePath)]).catch(logger.error)
            }
          }
        }

        // Cleanup
        for (const result of results) {
          const message = messageByEntity.get(result.entity)!

          // Schedule retries if needed
          if (result.error) {
            await storage.store(`failures/${result.entity}.txt`, Buffer.from(result.error))
            logger.debug(`Giving up on entity="${result.entity} because of godot failure.`)
          } else if (!result.status) {
            const body: QueueMessage = JSON.parse(message.Body!)
            const attempts = body.attempt
            if (attempts < 4) {
              const message: QueueMessage = { entity: result.entity, attempt: attempts + 1 }
              await queue.send(message, { delay: 15 })
              logger.debug(`Added to queue entity="${result.entity} with retry attempt=${attempts + 1}"`)
            } else {
              logger.debug(`Giving up on entity="${result.entity} after 5 retries.`)
            }
          }

          await queue.deleteMessage(message.ReceiptHandle!)
        }
      } finally {
        console.timeEnd('generate images + upload to s3')
      }
    }
  }

  return { start }
}
