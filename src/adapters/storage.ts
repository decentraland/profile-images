import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { AppComponents, IStorageComponent } from '../types'

export async function createStorageComponent({
  awsConfig,
  config,
  metrics
}: Pick<AppComponents, 'awsConfig' | 'config' | 'metrics'>): Promise<IStorageComponent> {
  const s3 = new S3Client(awsConfig)
  const bucket = await config.requireString('BUCKET_NAME')

  return {
    async store(key: string, content: Buffer): Promise<void> {
      const timer = metrics.startTimer('image_upload_duration_seconds')
      let status = 'success'
      try {
        const upload = new Upload({
          client: s3,
          params: {
            Bucket: bucket,
            Key: key,
            Body: content,
            ContentType: 'image/png'
          }
        })
        await upload.done()
      } catch (e: any) {
        status = 'error'
        throw e
      } finally {
        timer.end({ status })
      }
    },

    async retrieve(key: string): Promise<Buffer | undefined> {
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
  }
}
