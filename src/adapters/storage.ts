import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { AppComponents, IStorageComponent } from '../types'

export async function createStorageComponent({
  awsConfig,
  config
}: Pick<AppComponents, 'awsConfig' | 'config'>): Promise<IStorageComponent> {
  const s3 = new S3Client(awsConfig)
  const bucket = await config.requireString('BUCKET_NAME')

  return {
    async store(key: string, content: Buffer): Promise<void> {
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
    }
  }
}
