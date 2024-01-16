import fs from 'fs/promises'
import { DeleteObjectsCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { AppComponents, IStorageComponent } from '../types'

export async function createStorageComponent({
  awsConfig,
  config,
  metrics,
  logs
}: Pick<AppComponents, 'awsConfig' | 'config' | 'metrics' | 'logs'>): Promise<IStorageComponent> {
  const logger = logs.getLogger('storage')
  const s3 = new S3Client(awsConfig)
  const bucket = await config.requireString('BUCKET_NAME')

  async function store(key: string, content: Buffer, contentType: string): Promise<void> {
    const timer = metrics.startTimer('image_upload_duration_seconds')
    let status = 'success'
    try {
      const upload = new Upload({
        client: s3,
        params: {
          Bucket: bucket,
          Key: key,
          Body: content,
          ContentType: contentType
        }
      })
      await upload.done()
    } catch (e: any) {
      status = 'error'
      throw e
    } finally {
      timer.end({ status })
    }
  }

  async function deleteMultiple(keys: string[]): Promise<void> {
    const command = new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: keys.map((key) => ({
          Key: key
        }))
      }
    })
    await s3.send(command)
  }

  async function retrieve(key: string): Promise<Buffer | undefined> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    })
    try {
      const output = await s3.send(command)
      return output.Body ? Buffer.from(await output.Body.transformToByteArray()) : undefined
    } catch (e: any) {
      if (e.name === 'NoSuchKey') {
        return undefined
      }
      throw e
    }
  }

  async function storeImages(entity: string, avatarPath: string, facePath: string): Promise<boolean> {
    try {
      const [body, face] = await Promise.all([fs.readFile(avatarPath), fs.readFile(facePath)])
      await Promise.all([
        store(`entities/${entity}/body.png`, body, 'image/png'),
        store(`entities/${entity}/face.png`, face, 'image/png')
      ])
      return true
    } catch (err) {
      logger.debug(`Error uploading images to bucket, marking job for retrying it: "${entity}"`)
      return false
    } finally {
      Promise.all([fs.rm(avatarPath), fs.rm(facePath)]).catch(logger.error)
    }
  }

  return {
    store,
    storeImages,
    deleteMultiple,
    retrieve
  }
}
