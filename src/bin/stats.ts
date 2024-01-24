import { ListObjectsV2Command, ListObjectsV2Request, S3Client } from '@aws-sdk/client-s3'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs'

const REGION = 'us-east-1'

async function countObjects(s3: S3Client, bucket: string, prefix: string): Promise<number> {
  const params: ListObjectsV2Request = {
    Bucket: bucket,
    ContinuationToken: undefined,
    Prefix: prefix
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

  return objectCount
}

async function main() {
  const config = await createDotEnvConfigComponent({
    path: ['.env.default', '.env', '.env.admin']
  })
  const [bucket, user, secret, queueUrl, retryQueueUrl] = await Promise.all([
    config.requireString('S3_BUCKET'),
    config.requireString('AWS_USER'),
    config.requireString('AWS_SECRET'),
    config.requireString('QUEUE_URL'),
    config.requireString('RETRY_QUEUE_URL')
  ])

  const sqsClient = new SQSClient({
    region: REGION,
    credentials: {
      secretAccessKey: secret,
      accessKeyId: user
    }
  })

  const queues = [queueUrl, retryQueueUrl]

  for (const queueUrl of queues) {
    const command = new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: [
        'ApproximateNumberOfMessages',
        'ApproximateNumberOfMessagesNotVisible',
        'ApproximateNumberOfMessagesDelayed'
      ]
    })
    const response = await sqsClient.send(command)
    console.log(queueUrl, response.Attributes)
  }

  const s3 = new S3Client({
    region: REGION,
    credentials: {
      secretAccessKey: secret,
      accessKeyId: user
    }
  })

  console.log('failed: ', await countObjects(s3, bucket, 'failures/'))
  console.log('images: ', await countObjects(s3, bucket, 'entities/'))
}

main().catch(console.error)
