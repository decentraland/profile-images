import fs from 'fs/promises'
import { AppComponents } from '../../src/types'
import { IStorageComponent } from '../../src/adapters/storage'

export async function createInMemoryStorage({
  config,
  logs
}: Pick<AppComponents, 'config' | 'logs'>): Promise<IStorageComponent> {
  const storage: Map<string, Uint8Array> = new Map()
  const LAST_CHECKED_TIMESTAMP_KEY = 'last_checked_timestamp.txt'

  const logger = logs.getLogger('in-memory-storage')
  const prefix = (await config.getString('S3_IMAGES_PREFIX')) || ''

  async function store(key: string, content: Buffer, _contentType: string): Promise<void> {
    storage.set(key, content)
  }

  async function storeImages(entity: string, avatarPath: string, facePath: string): Promise<boolean> {
    try {
      const [body, face] = await Promise.all([fs.readFile(avatarPath), fs.readFile(facePath)])
      await Promise.all([
        store(`${prefix}/entities/${entity}/body.png`, body, 'image/png'),
        store(`${prefix}/entities/${entity}/face.png`, face, 'image/png')
      ])
      return true
    } catch (err) {
      logger.debug(`Error uploading images to bucket, marking job for retrying it: "${entity}"`)
      return false
    } finally {
      Promise.all([fs.rm(avatarPath), fs.rm(facePath)]).catch(logger.error)
    }
  }

  function storeFailure(entity: string, failure: string): Promise<void> {
    return store(`${prefix}/failures/${entity}.txt`, Buffer.from(JSON.stringify(failure)), 'text/plain')
  }

  async function deleteFailures(entities: string[]): Promise<void> {
    entities.forEach((entity) => storage.delete(`${prefix}/failures/${entity}.txt`))
  }

  async function retrieveLastCheckedTimestamp(): Promise<undefined | number> {
    const lastRun = storage.get(LAST_CHECKED_TIMESTAMP_KEY)
    if (lastRun) {
      return parseInt(Buffer.from(lastRun).toString(), 10)
    }
    return undefined
  }

  async function storeLastCheckedTimestamp(ts: number): Promise<void> {
    await store(LAST_CHECKED_TIMESTAMP_KEY, Buffer.from(ts.toString()), 'text/plain')
  }

  return {
    storeImages,
    storeFailure,
    deleteFailures,
    retrieveLastCheckedTimestamp,
    storeLastCheckedTimestamp
  }
}
