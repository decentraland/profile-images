import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient
} from '@aws-sdk/client-sqs'
import { AppComponents, QueueMessage, QueueSendOptions, QueueService } from '../types'

export async function createQueueComponent({
  awsConfig,
  config
}: Pick<AppComponents, 'awsConfig' | 'config'>): Promise<QueueService> {
  const client = new SQSClient(awsConfig)
  const queueName = await config.requireString('QUEUE_NAME')

  async function send(message: QueueMessage, options?: QueueSendOptions) {
    const sendCommand = new SendMessageCommand({
      QueueUrl: queueName,
      MessageBody: JSON.stringify(message),
      DelaySeconds: options?.delay
    })
    await client.send(sendCommand)
  }

  async function receive(max: number): Promise<Message[]> {
    const receiveCommand = new ReceiveMessageCommand({
      QueueUrl: queueName,
      MaxNumberOfMessages: max,
      WaitTimeSeconds: 20
    })
    const { Messages = [] } = await client.send(receiveCommand)

    return Messages
  }

  async function deleteMessage(receiptHandle: string) {
    const deleteCommand = new DeleteMessageCommand({
      QueueUrl: queueName,
      ReceiptHandle: receiptHandle
    })
    await client.send(deleteCommand)
  }

  return {
    send,
    receive,
    deleteMessage
  }
}
