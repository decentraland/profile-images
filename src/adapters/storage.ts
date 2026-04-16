import fs from 'fs/promises'
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { AppComponents } from '../types'

export type IStorageComponent = {
  storeImages(entity: string, avatarPath: string, facePath: string, avatarHash?: string): Promise<boolean>
  storeFailure(entity: string, failure: string): Promise<void>
  deleteFailures(entities: string[]): Promise<void>
  retrieveLastCheckedTimestamp(): Promise<undefined | number>
  storeLastCheckedTimestamp(ts: number): Promise<void>
  retrieveAvatarHash(entity: string): Promise<string | undefined>
}

const LAST_CHECKED_TIMESTAMP_KEY = 'last_checked_timestamp.txt'

export async function createStorageComponent({
  awsConfig,
  config,
  metrics,
  logs
}: Pick<AppComponents, 'awsConfig' | 'config' | 'metrics' | 'logs'>): Promise<IStorageComponent> {
  const logger = logs.getLogger('storage')
  const s3 = new S3Client(awsConfig)
  const bucket = await config.requireString('BUCKET_NAME')
  const prefix = (await config.getString('S3_IMAGES_PREFIX')) || ''

  async function store(
    key: string,
    content: Buffer,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<void> {
    const upload = new Upload({
      client: s3,
      params: {
        Bucket: bucket,
        Key: `${key}`,
        Body: content,
        ContentType: contentType,
        ...(metadata && { Metadata: metadata })
      }
    })
    await upload.done()
  }

  async function storeImages(
    entity: string,
    avatarPath: string,
    facePath: string,
    avatarHash?: string
  ): Promise<boolean> {
    const timer = metrics.startTimer('image_upload_duration_seconds')
    let status = 'success'
    try {
      const [body, face] = await Promise.all([fs.readFile(avatarPath), fs.readFile(facePath)])
      // Upload face first, then body with avatar-hash metadata.
      // This ordering ensures the hash is only written to S3 after both images
      // are stored — preventing a partial upload from being incorrectly skipped
      // on retry (if body.png with metadata uploaded but face.png failed).
      await store(`${prefix}/entities/${entity}/face.png`, face, 'image/png')
      const bodyMetadata = avatarHash ? { 'avatar-hash': avatarHash } : undefined
      await store(`${prefix}/entities/${entity}/body.png`, body, 'image/png', bodyMetadata)
      return true
    } catch (err) {
      status = 'error'
      logger.debug(`Error uploading images to bucket, marking job for retrying it: "${entity}"`)
      return false
    } finally {
      timer.end({ status })
      Promise.all([fs.rm(avatarPath), fs.rm(facePath)]).catch(logger.error)
    }
  }

  function storeFailure(entity: string, failure: string): Promise<void> {
    return store(`${prefix}/failures/${entity}.txt`, Buffer.from(JSON.stringify(failure)), 'text/plain')
  }

  async function deleteFailures(entities: string[]): Promise<void> {
    const command = new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: entities.map((entity) => ({
          Key: `${prefix}/failures/${entity}.txt`
        }))
      }
    })
    await s3.send(command)
  }

  async function retrieveLastCheckedTimestamp(): Promise<undefined | number> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: LAST_CHECKED_TIMESTAMP_KEY
    })
    try {
      const output = await s3.send(command)
      if (!output.Body) {
        return undefined
      }
      return parseInt(Buffer.from(await output.Body.transformToByteArray()).toString(), 10)
    } catch (e: any) {
      if (e.name === 'NoSuchKey') {
        return undefined
      }
      throw e
    }
  }

  async function storeLastCheckedTimestamp(ts: number): Promise<void> {
    await store(LAST_CHECKED_TIMESTAMP_KEY, Buffer.from(ts.toString()), 'text/plain')
  }

  async function retrieveAvatarHash(entity: string): Promise<string | undefined> {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: `${prefix}/entities/${entity}/body.png`
    })
    try {
      const output = await s3.send(command)
      return output.Metadata?.['avatar-hash']
    } catch (e: any) {
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
        return undefined
      }
      logger.warn(`Error retrieving avatar hash for entity=${entity}, falling back to re-render: ${e.message}`)
      return undefined
    }
  }

  return {
    storeImages,
    storeFailure,
    deleteFailures,
    retrieveLastCheckedTimestamp,
    storeLastCheckedTimestamp,
    retrieveAvatarHash
  }
}
