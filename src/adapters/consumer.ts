import { Message, SQSClient } from '@aws-sdk/client-sqs'
import { Queue } from '../logic/queue'
import { AppComponents, QueueMessage, QueueWorker } from '../types'
import fs from 'fs/promises'

export async function createConsumerComponent({
  awsConfig,
  config,
  logs,
  godot,
  storage
}: Pick<AppComponents, 'awsConfig' | 'config' | 'logs' | 'godot' | 'storage'>): Promise<QueueWorker> {
  const logger = logs.getLogger('consumer')
  const sqs = new SQSClient(awsConfig)
  const queueName = await config.requireString('QUEUE_NAME')
  const maxJobs = (await config.getNumber('MAX_JOBS')) || 10
  const queue = new Queue(sqs, queueName)

  async function start() {
    logger.debug('Starting consumer')
    while (true) {
      const messages = await queue.receive(maxJobs)
      if (messages.length === 0) {
        logger.debug(`Queue empty`)
        continue
      }

      logger.debug(`Processing: ${messages.length} profiles`)

      const messageByEntity = new Map<string, Message>()
      for (const message of messages) {
        if (!message.Body) {
          console.warn(
            `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with undefined Body`
          )
          await queue.deleteMessage(message.ReceiptHandle!)
          continue
        }
        const body: QueueMessage = JSON.parse(message.Body)
        if (body.entity === undefined || body.attempt === undefined) {
          console.warn(
            `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with invalid Body: ${message.Body}`
          )
          await queue.deleteMessage(message.ReceiptHandle!)
          continue
        }
        messageByEntity.set(body.entity, message)
      }

      console.time('images')
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
          await queue.deleteMessage(message.ReceiptHandle!)

          // Schedule retries if needed
          if (!result.status) {
            const body: QueueMessage = JSON.parse(message.Body!)
            const attempts = body.attempt
            if (attempts < 4) {
              const message: QueueMessage = { entity: result.entity, attempt: attempts + 1 }
              await queue.send(message)
              logger.debug(`Added to queue entity="${result.entity} with retry attempt=${attempts + 1}"`)
            } else {
              logger.debug(`Giving up on entity="${result.entity} after 5 retries"`)
            }
          }
        }
      } catch (_) {
        logger.warn(`There was a problem processing the batch of ${messageByEntity.size} profiles.`)
      } finally {
        console.timeEnd('images')
      }
    }
  }

  return { start }
}
