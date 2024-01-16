import { AppComponents, JobProducer, ExtendedAvatar } from '../types'
import { sleep } from '../logic/sleep'
import { Entity, EntityType, Profile } from '@dcl/schemas'

const LAST_CHECKED_TIMESTAMP_KEY = 'last_checked_timestamp.txt'

type Delta = Omit<Entity, 'metadata' | 'id'> & { metadata: Profile; entityId: string; localTimestamp: number }

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
    let url = `${peerUrl}/content/pointer-changes?entityType=${
      EntityType.PROFILE
    }&from=${lastTimestamp}&to=${Date.now()}`

    const statusResponse = await fetch.fetch(`${peerUrl}/content/status`)
    const status = await statusResponse.json()
    if (status.synchronizationStatus.synchronizationState !== 'Syncing') {
      logger.error('${peerUrl} is not syncing')
      return lastTimestamp
    }

    let to = lastTimestamp
    do {
      const pointerChanges: PointerChangesResponse = await (await fetch.fetch(url)).json()
      const ids: string[] = []

      for (const delta of pointerChanges.deltas) {
        ids.push(delta.entityId)
        if (delta.localTimestamp > to) {
          to = delta.localTimestamp
        }
      }

      if (ids.length > 0) {
        const response = await fetch.fetch(`${peerUrl}/content/entities/active`, {
          method: 'POST',
          body: JSON.stringify({ ids })
        })

        const activeEntities: Entity[] = await response.json()

        for (const entity of activeEntities) {
          const message: ExtendedAvatar = { entity: entity.id, avatar: entity.metadata.avatars[0].avatar }
          await queue.send(message)
        }

        logger.debug(`Got ${activeEntities.length} active entities`)
      }
      url = pointerChanges.pagination.next && `${peerUrl}/content/pointer-changes${pointerChanges.pagination.next}`
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
