import { _Object, ListObjectsV2Command, ListObjectsV2Request, S3Client } from '@aws-sdk/client-s3'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createFetchComponent } from '@well-known-components/fetch-component'

const REGION = 'us-east-1'

async function main() {
  const config = await createDotEnvConfigComponent({
    path: ['.env.default', '.env', '.env.admin']
  })

  const [bucket, user, secret] = await Promise.all([
    config.requireString('S3_BUCKET'),
    config.requireString('AWS_USER'),
    config.requireString('AWS_SECRET')
  ])

  const fetch = createFetchComponent()

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
    Prefix: 'failures/'
  }

  let fetched
  do {
    const command = new ListObjectsV2Command(params)
    fetched = await s3.send(command)
    if (fetched.Contents) {
      const entities = fetched.Contents.map((o) => o.Key?.replace('failures/', '').replace('.txt', ''))
      const response = await fetch.fetch('https://profile-images.decentraland.org/schedule-processing', {
        method: 'POST',
        body: JSON.stringify(entities)
      })

      console.log(response.status)
    }

    params.ContinuationToken = fetched.NextContinuationToken
  } while (fetched.IsTruncated)
}

main().catch(console.error)
