import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient
} from '@aws-sdk/client-sqs'
import { AppComponents, ExtendedAvatar, QueueSendOptions } from '../types'

export type QueueService = {
  send(message: ExtendedAvatar, options?: QueueSendOptions): Promise<void>
  receive(max: number): Promise<{ name: string; messages: Message[] }>
  deleteMessage(receiptHandle: string): Promise<void>
  status(): Promise<Record<string, any>>
}

export async function createQueueComponent(
  { awsConfig }: Pick<AppComponents, 'awsConfig'>,
  queueName: string
): Promise<QueueService> {
  const client = new SQSClient(awsConfig)

  async function send(message: ExtendedAvatar, options?: QueueSendOptions) {
    const sendCommand = new SendMessageCommand({
      QueueUrl: queueName,
      MessageBody: JSON.stringify(message),
      DelaySeconds: options?.delay
    })
    await client.send(sendCommand)
  }

  async function receive(max: number): Promise<{ name: string; messages: Message[] }> {
    const receiveCommand = new ReceiveMessageCommand({
      QueueUrl: queueName,
      MaxNumberOfMessages: max,
      WaitTimeSeconds: 20
    })
    const { Messages = [] } = await client.send(receiveCommand)

    return { name: queueName, messages: Messages }
  }

  async function deleteMessage(receiptHandle: string) {
    const deleteCommand = new DeleteMessageCommand({
      QueueUrl: queueName,
      ReceiptHandle: receiptHandle
    })
    await client.send(deleteCommand)
  }

  async function status(): Promise<Record<string, any>> {
    const command = new GetQueueAttributesCommand({
      QueueUrl: queueName,
      AttributeNames: [
        'ApproximateNumberOfMessages',
        'ApproximateNumberOfMessagesNotVisible',
        'ApproximateNumberOfMessagesDelayed'
      ]
    })
    const response = await client.send(command)
    return {
      ApproximateNumberOfMessages: response.Attributes?.ApproximateNumberOfMessages,
      ApproximateNumberOfMessagesNotVisible: response.Attributes?.ApproximateNumberOfMessagesNotVisible,
      ApproximateNumberOfMessagesDelayed: response.Attributes?.ApproximateNumberOfMessagesDelayed
    }
  }

  return {
    send,
    receive,
    deleteMessage,
    status
  }
}
