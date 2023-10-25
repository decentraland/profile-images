import { SQSClient } from '@aws-sdk/client-sqs'
import { Queue } from './modules/queue'
import { sleep } from './modules/sleep'
import { AppComponents, QueueMessage, QueueWorker } from './types'

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
    console.log(`Processing: ${message.address}`)
    console.time('Snapshots')
    const [face, body] = await Promise.all([snapshot.getFace(message.address), snapshot.getBody(message.address)])
    console.timeEnd('Snapshots')
    console.time('Upload')

    await Promise.all([
      storage.store(`addresses/${message.address}/face.png`, face),
      storage.store(`addresses/${message.address}/body.png`, body)
    ])

    console.timeEnd('Upload')
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
