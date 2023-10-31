import { SQSClient } from '@aws-sdk/client-sqs'
import { sleep } from '../logic/sleep'
import { Queue } from '../logic/queue'
import { AppComponents, JobProducer, QueueMessage } from '../types'

export async function createProducerComponent({
  awsConfig,
  config,
  logs,
  profileFetcher
}: Pick<AppComponents, 'awsConfig' | 'config' | 'logs' | 'profileFetcher'>): Promise<JobProducer> {
  const logger = logs.getLogger('producer')
  const sqs = new SQSClient(awsConfig)
  const queueName = await config.requireString('QUEUE_NAME')
  const queue = new Queue(sqs, queueName)
  const interval = parseInt(await config.requireString('INTERVAL'))

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

  async function start() {
    logger.info('Starting producer')
    let lastRun = Date.now() - interval
    while (true) {
      try {
        lastRun = await poll(interval, lastRun)
      } catch (error: any) {
        logger.error(error)
      }
      await sleep(interval)
    }
  }

  return { start }
}
