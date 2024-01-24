import { PurgeQueueCommand, SQSClient } from '@aws-sdk/client-sqs'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'

const REGION = 'us-east-1'

export async function purge(sqsClient: SQSClient, queueUrl: string) {
  const command = new PurgeQueueCommand({
    QueueUrl: queueUrl
  })
  const purgeResponse = await sqsClient.send(command)
  console.log('purgeResponse', purgeResponse.$metadata)
}

async function main() {
  const config = await createDotEnvConfigComponent({
    path: ['.env.default', '.env', '.env.admin']
  })
  const [user, secret, queueUrl, retryQueueUrl] = await Promise.all([
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
    await purge(sqsClient, queueUrl)
  }
}

main().catch(console.error)
