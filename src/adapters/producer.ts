import { AppComponents, JobProducer, QueueMessage } from '../types'
import { sleep } from '../logic/sleep'
import { Entity, EntityType, Profile } from '@dcl/schemas'

const LAST_CHECKED_TIMESTAMP_KEY = 'last_checked_timestamp.txt'

type Delta = Omit<Entity, 'metadata'> & { metadata: Profile; entityId: string }

type PointerChangesResponse = {
  deltas: Delta[]
  filters: {
    entityTypes: EntityType[]
    includeAuthChain: boolean
  }
  pagination: {
    moreData: boolean
    limit: number
    offset: number
    next: string
  }
}

export async function createProducerComponent({
  config,
  logs,
  queue,
  storage,
  fetch
}: Pick<AppComponents, 'config' | 'logs' | 'queue' | 'storage' | 'fetch'>): Promise<JobProducer> {
  const logger = logs.getLogger('producer')
  const interval = parseInt(await config.requireString('INTERVAL'), 10)
  const peerUrl = await config.requireString('PEER_URL')

  let lastRun = Date.now() - interval

  async function poll(lastTimestamp: number): Promise<number> {
    const to = Date.now()
    let url = `${peerUrl}/content/pointer-changes?entityType=${EntityType.PROFILE}&from=${lastTimestamp}&to=${to}`

    do {
      const response = await fetch.fetch(url)
      const data: PointerChangesResponse = await response.json()
      for (const profile of data.deltas) {
        const message: QueueMessage = { entity: profile.entityId, attempt: 0 }
        await queue.send(message)
      }

      url = data.pagination.next && `${peerUrl}/content/pointer-changes${data.pagination.next}`
      logger.debug(`Got ${data.deltas.length} profiles with changes`)
    } while (url)
    return to
  }

  async function changeLastRun(ts: number) {
    lastRun = ts
    await storage.store(LAST_CHECKED_TIMESTAMP_KEY, Buffer.from(lastRun.toString()), 'text/plain')
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
        await storage.store(LAST_CHECKED_TIMESTAMP_KEY, Buffer.from(lastRun.toString()), 'text/plain')
      } catch (error: any) {
        logger.error(error)
      }
      await sleep(interval)
    }
  }

  return { start, changeLastRun }
}
