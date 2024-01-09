import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient
} from '@aws-sdk/client-sqs'
import { QueueMessage } from '../types'

export class Queue {
  constructor(public client: SQSClient, public queueName: string) {}

  async send(message: QueueMessage) {
    const sendCommand = new SendMessageCommand({
      QueueUrl: this.queueName,
      MessageBody: JSON.stringify(message)
    })
    await this.client.send(sendCommand)
  }

  async receive(max: number): Promise<Message[]> {
    const receiveCommand = new ReceiveMessageCommand({
      QueueUrl: this.queueName,
      MaxNumberOfMessages: max
    })
    const { Messages = [] } = await this.client.send(receiveCommand)

    return Messages
  }

  async deleteMessage(receiptHandle: string) {
    const deleteCommand = new DeleteMessageCommand({
      QueueUrl: this.queueName,
      ReceiptHandle: receiptHandle
    })
    await this.client.send(deleteCommand)
  }
}
