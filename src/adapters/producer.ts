import { AppComponents, JobProducer, QueueMessage } from '../types'
import { sleep } from '../logic/sleep'

const LAST_CHECKED_TIMESTAMP_KEY = 'last_checked_timestamp.txt'

export async function createProducerComponent({
  config,
  logs,
  profileFetcher,
  queue,
  storage
}: Pick<AppComponents, 'config' | 'logs' | 'profileFetcher' | 'queue' | 'storage'>): Promise<JobProducer> {
  const logger = logs.getLogger('producer')
  const interval = parseInt(await config.requireString('INTERVAL'))

  let lastRun = Date.now() - interval

  async function poll(lastTimestamp: number): Promise<number> {
    const { entities, timestamp } = await profileFetcher.getProfilesWithChanges(lastTimestamp)
    logger.debug(`Got ${entities.length} profiles with changes`)
    for (const entity of entities) {
      const message: QueueMessage = { entity, attempt: 0 }
      await queue.send(message)
      logger.debug(`Added to queue entity="${entity}"`)
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

    while (true) {
      try {
        lastRun = await poll(lastRun)
        await storage.store(LAST_CHECKED_TIMESTAMP_KEY, Buffer.from(lastRun.toString()))
      } catch (error: any) {
        logger.error(error)
      }
      await sleep(interval)
    }
  }

  return { start, changeLastRun }
}
