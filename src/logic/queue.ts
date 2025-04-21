import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  Message,
  ReceiveMessageCommand,
  SendMessageCommand
} from '@aws-sdk/client-sqs'
import { ReceiveMessageOptions } from '../types'
import { CatalystDeploymentEvent } from '@dcl/schemas'
import { AppComponents } from '../types'

export type QueueComponent = {
  sendMessage(queueUrl: string, message: CatalystDeploymentEvent): Promise<void>
  receiveMessage(queueUrl: string, options: ReceiveMessageOptions): Promise<Message[]>
  deleteMessage(queueUrl: string, receiptHandle: string): Promise<void>
  getStatus(queueUrl: string): Promise<{
    ApproximateNumberOfMessages: string
    ApproximateNumberOfMessagesNotVisible: string
    ApproximateNumberOfMessagesDelayed: string
  }>
}

export async function createQueueComponent({ sqsClient }: Pick<AppComponents, 'sqsClient'>): Promise<QueueComponent> {
  async function sendMessage(queueUrl: string, message: CatalystDeploymentEvent) {
    const sendCommand = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message)
    })
    await sqsClient.sendMessage(sendCommand)
  }

  async function receiveMessage(queueUrl: string, options: ReceiveMessageOptions): Promise<Message[]> {
    const { maxNumberOfMessages, visibilityTimeout, waitTimeSeconds, messageSystemAttributeNames } = options

    const receiveCommand = new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: maxNumberOfMessages,
      VisibilityTimeout: visibilityTimeout || 60,
      WaitTimeSeconds: waitTimeSeconds || 20,
      MessageSystemAttributeNames: messageSystemAttributeNames
    })
    const { Messages = [] } = await sqsClient.receiveMessages(receiveCommand)

    return Messages
  }

  async function deleteMessage(queueUrl: string, receiptHandle: string) {
    const deleteCommand = new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle
    })
    await sqsClient.deleteMessage(deleteCommand)
  }

  async function getStatus(queueUrl: string) {
    const command = new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: [
        'ApproximateNumberOfMessages',
        'ApproximateNumberOfMessagesNotVisible',
        'ApproximateNumberOfMessagesDelayed'
      ]
    })
    const response = await sqsClient.getQueueAttributes(command)
    return {
      ApproximateNumberOfMessages: response.Attributes?.ApproximateNumberOfMessages ?? '0',
      ApproximateNumberOfMessagesNotVisible: response.Attributes?.ApproximateNumberOfMessagesNotVisible ?? '0',
      ApproximateNumberOfMessagesDelayed: response.Attributes?.ApproximateNumberOfMessagesDelayed ?? '0'
    }
  }

  return {
    sendMessage,
    receiveMessage,
    deleteMessage,
    getStatus
  }
}
