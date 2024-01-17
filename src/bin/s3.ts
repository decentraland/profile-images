import { _Object, DeleteObjectsCommand, ListObjectsV2Command, ListObjectsV2Request, S3Client } from '@aws-sdk/client-s3'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'

const REGION = 'us-east-1'

export async function deleteObjects(s3: S3Client, bucket: string, keys: string[]) {
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: keys.map((Key: string) => ({ Key }))
      }
    })
  )
}
async function main() {
  const config = await createDotEnvConfigComponent({
    path: ['.env.default', '.env', '.env-admin']
  })
  const [bucket, user, secret] = await Promise.all([
    config.requireString('S3_BUCKET'),
    config.requireString('AWS_USER'),
    config.requireString('AWS_SECRET')
  ])

  const s3 = new S3Client({
    region: REGION,
    credentials: {
      secretAccessKey: secret,
      accessKeyId: user
    }
  })

  const params: ListObjectsV2Request = {
    Bucket: bucket,
    ContinuationToken: undefined,
    Prefix: 'entities/'
  }

  let objectCount = 0
  let fetched
  do {
    const command = new ListObjectsV2Command(params)
    fetched = await s3.send(command)
    if (fetched.Contents) {
      objectCount += fetched.Contents.length
    }

    params.ContinuationToken = fetched.NextContinuationToken
  } while (fetched.IsTruncated)

  console.log('objectCount', objectCount)
}

main().catch(console.error)
