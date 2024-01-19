import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient
} from '@aws-sdk/client-sqs'
import { AppComponents, ExtendedAvatar } from '../types'

export type QueueService = {
  send(queueUrl: string, message: ExtendedAvatar): Promise<void>
  receive(queueUrl: string, options: { maxNumberOfMessages: number; waitTimeSeconds?: number }): Promise<Message[]>
  deleteMessage(queueUrl: string, receiptHandle: string): Promise<void>
  status(queueUrl: string): Promise<Record<string, any>>
}

export async function createQueueComponent({ awsConfig }: Pick<AppComponents, 'awsConfig'>): Promise<QueueService> {
  const client = new SQSClient(awsConfig)

  async function send(queueUrl: string, message: ExtendedAvatar) {
    const sendCommand = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message)
    })
    await client.send(sendCommand)
  }

  async function receive(
    queueUrl: string,
    options: { maxNumberOfMessages: number; waitTimeSeconds?: number }
  ): Promise<Message[]> {
    const receiveCommand = new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: options.maxNumberOfMessages,
      WaitTimeSeconds: options.waitTimeSeconds
    })
    const { Messages = [] } = await client.send(receiveCommand)

    return Messages
  }

  async function deleteMessage(queueUrl: string, receiptHandle: string) {
    const deleteCommand = new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle
    })
    await client.send(deleteCommand)
  }

  async function status(queueUrl: string): Promise<Record<string, any>> {
    const command = new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
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
