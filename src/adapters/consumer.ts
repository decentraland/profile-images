import { SQSClient } from '@aws-sdk/client-sqs'
import { Queue } from '../modules/queue'
import { sleep } from '../modules/sleep'
import { AppComponents, QueueMessage, QueueWorker } from '../types'

export async function createConsumerComponent({
  awsConfig,
  config,
  snapshot,
  storage
}: Pick<AppComponents, 'awsConfig' | 'config' | 'snapshot' | 'storage'>): Promise<QueueWorker> {
  const sqs = new SQSClient(awsConfig)
  const queueName = await config.requireString('QUEUE_NAME')
  const maxJobs = parseInt(await config.requireString('MAX_JOBS'))
  const interval = parseInt(await config.requireString('INTERVAL'))
  const queue = new Queue(sqs, queueName)

  const handle = async (message: QueueMessage) => {
    console.log(`Processing: ${message.entity}`)

    console.time(`Snapshots ${message.entity}`)
    const [face, body] = await Promise.all([snapshot.getFace(message.address), snapshot.getBody(message.address)])
    console.timeEnd(`Snapshots ${message.entity}`)

    console.time(`Upload ${message.entity}`)
    await Promise.all([
      storage.store(`entities/${message.entity}/face.png`, face),
      storage.store(`entities/${message.entity}/body.png`, body)
    ])
    console.timeEnd(`Upload ${message.entity}`)
  }

  async function job() {
    console.log('Running jobs')
    const didWork = await queue.receive(handle, maxJobs)
    if (!didWork) {
      console.log(`Queue empty`)
      await sleep(interval / 2)
    }
  }

  async function start() {
    console.log('starting consumer')
    while (true) {
      await job()
    }
  }

  return { start }
}
