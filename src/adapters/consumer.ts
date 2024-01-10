import { SQSClient } from '@aws-sdk/client-sqs'
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

      const receiptByEntity = new Map<string, string>()
      for (const { MessageId, Body, ReceiptHandle } of messages) {
        if (!Body) {
          console.warn(
            `Message with MessageId=${MessageId} and ReceiptHandle=${ReceiptHandle} arrived with undefined Body`
          )
          await queue.deleteMessage(ReceiptHandle!)
          continue
        }
        const body: QueueMessage = JSON.parse(Body)
        receiptByEntity.set(body.entity, ReceiptHandle!)
      }

      console.time('images')
      try {
        const results = await godot.generateImages(Array.from(receiptByEntity.keys()))
        console.log('results', results)

        for (const { status, entity, avatarPath, facePath } of results) {
          if (status) {
            try {
              const [body, face] = await Promise.all([fs.readFile(avatarPath), fs.readFile(facePath)])
              await Promise.all([
                storage.store(`entities/${entity}/body.png`, body),
                storage.store(`entities/${entity}/face.png`, face)
              ])
              await queue.deleteMessage(receiptByEntity.get(entity)!)
            } catch (err) {
              // TODO: maybe increment retry-count
              await queue.deleteMessage(receiptByEntity.get(entity)!)
            } finally {
              Promise.all([fs.rm(avatarPath), fs.rm(facePath)]).catch(logger.error)
            }
          }
        }
      } catch (_) {
        logger.warn(`There was a problem processing the batch of ${receiptByEntity.size} profiles.`)
        for (const [entity] of receiptByEntity) {
          await queue.deleteMessage(receiptByEntity.get(entity)!)
        }
      } finally {
        console.timeEnd('images')
      }
    }
  }

  return { start }
}
