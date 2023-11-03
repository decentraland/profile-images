import { SQSClient } from '@aws-sdk/client-sqs'
import { Queue } from '../logic/queue'
import { AppComponents, JobProducer, QueueMessage } from '../types'

const LAST_CHECKED_TIMESTAMP_KEY = 'last_checked_timestamp.txt'

export async function createProducerComponent({
  awsConfig,
  config,
  logs,
  profileFetcher,
  storage
}: Pick<AppComponents, 'awsConfig' | 'config' | 'logs' | 'profileFetcher' | 'storage'>): Promise<JobProducer> {
  const logger = logs.getLogger('producer')
  const sqs = new SQSClient(awsConfig)
  const queueName = await config.requireString('QUEUE_NAME')
  const queue = new Queue(sqs, queueName)
  const interval = parseInt(await config.requireString('INTERVAL'))

  let lastRun = Date.now() - interval

  async function poll(ms: number, lastTimestamp: number): Promise<number> {
    const { profiles, timestamp } = await profileFetcher.getProfilesWithChanges(lastTimestamp)
    logger.debug(`Got ${profiles.length} profiles with changes`)
    for (const [address, entity] of profiles) {
      const message: QueueMessage = { address, entity }
      await queue.send(message)
      logger.debug(`Added to queue address="${address}" and entity="${entity}"`)
    }
    return timestamp
  }

  async function changeLastRun(ts: number) {
    lastRun = ts
    await storage.store(LAST_CHECKED_TIMESTAMP_KEY, Buffer.from(lastRun.toString()))
  }

  async function start() {
    logger.info('Starting producer')

    const contentBuffer = await storage.retrieve(LAST_CHECKED_TIMESTAMP_KEY)
    if (contentBuffer) {
      lastRun = parseInt(contentBuffer.toString())
    } else {
      logger.info(`Could not fetch last checked timestamp.`)
    }
    logger.info(`Starting from ${lastRun}.`)

    console.log(poll)

    // while (true) {
    //   try {
    //     lastRun = await poll(interval, lastRun)
    //     await storage.store(LAST_CHECKED_TIMESTAMP_KEY, Buffer.from(lastRun.toString()))
    //   } catch (error: any) {
    //     logger.error(error)
    //   }
    //   await sleep(interval)
    // }
  }

  return { start, changeLastRun }
}
