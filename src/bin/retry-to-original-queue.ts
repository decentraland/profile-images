import {
  DeleteMessageCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SQSClient,
  SendMessageCommand
} from '@aws-sdk/client-sqs'
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
    config.requireString('QUEUE_NAME'),
    config.requireString('RETRY_QUEUE_NAME')
  ])

  const client = new SQSClient({
    region: REGION,
    credentials: {
      secretAccessKey: secret,
      accessKeyId: user
    }
  })

  while (true) {
    const receiveCommand = new ReceiveMessageCommand({
      QueueUrl: retryQueueUrl,
      MaxNumberOfMessages: 10
    })
    const { Messages = [] } = await client.send(receiveCommand)

    if (Messages.length === 0) {
      break
    }

    for (const message of Messages) {
      if (message.Body) {
        const sendCommand = new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: message.Body
        })
        await client.send(sendCommand)
      }

      const deleteCommand = new DeleteMessageCommand({
        QueueUrl: retryQueueUrl,
        ReceiptHandle: message.ReceiptHandle!
      })
      await client.send(deleteCommand)
    }
  }
}

main().catch(console.error)
