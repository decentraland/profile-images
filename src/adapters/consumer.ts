import { SQSClient } from '@aws-sdk/client-sqs'
import { Queue } from '../logic/queue'
import { sleep } from '../logic/sleep'
import { AppComponents, QueueMessage, QueueWorker } from '../types'

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
  const maxJobs = 1 //parseInt(await config.requireString('MAX_JOBS'))
  const interval = await config.requireNumber('INTERVAL')
  const queue = new Queue(sqs, queueName)

  const handle = async (message: QueueMessage) => {
    logger.debug(`Processing: ${message.entity}`)

    console.time('both images')
    try {
      const images = await godot.getImages(message.address)
      await Promise.all([
        storage.store(`entities/${message.entity}/body.png`, images.body),
        storage.store(`entities/${message.entity}/face.png`, images.face)
      ])
    } finally {
      console.timeEnd('both images')
    }
  }

  async function job() {
    logger.debug('Running jobs')
    const didWork = await queue.receive(handle, maxJobs)
    if (!didWork) {
      logger.debug(`Queue empty`)
      await sleep(interval / 2)
    }
  }

  async function start() {
    logger.debug('Starting consumer')
    while (true) {
      await job()
    }
  }

  return { start }
}
