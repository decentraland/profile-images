import {
  ChangeMessageVisibilityCommand,
  DeleteMessageBatchCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  Message,
  ReceiveMessageCommand,
  SendMessageCommand
} from '@aws-sdk/client-sqs'
import { ReceiveMessageOptions } from '../types'
import { CatalystDeploymentEvent } from '@dcl/schemas'
import { AppComponents } from '../types'
import { chunks } from '../utils/array'

// Godot render timeout is 15s base + 10s per avatar, so 10 avatars = 115s.
// Default visibility timeout must exceed the worst-case render cycle to prevent
// duplicate redelivery under load, which causes wasted renders and backlog growth.
const DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 300

export type QueueComponent = {
  sendMessage(message: CatalystDeploymentEvent): Promise<void>
  receiveMessage(options: ReceiveMessageOptions): Promise<Message[]>
  deleteMessage(receiptHandle: string): Promise<void>
  deleteMessages(receiptHandles: string[]): Promise<void>
  extendVisibility(receiptHandle: string, visibilityTimeoutSeconds: number): Promise<void>
  getStatus(): Promise<{
    ApproximateNumberOfMessages: string
    ApproximateNumberOfMessagesNotVisible: string
    ApproximateNumberOfMessagesDelayed: string
  }>
}

export async function createQueueComponent(
  { sqsClient }: Pick<AppComponents, 'sqsClient'>,
  queueUrl: string
): Promise<QueueComponent> {
  async function sendMessage(message: CatalystDeploymentEvent) {
    const sendCommand = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message)
    })
    await sqsClient.sendMessage(sendCommand)
  }

  async function receiveMessage(options: ReceiveMessageOptions): Promise<Message[]> {
    const { maxNumberOfMessages, visibilityTimeout, waitTimeSeconds, messageSystemAttributeNames } = options

    const receiveCommand = new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: maxNumberOfMessages,
      VisibilityTimeout: visibilityTimeout ?? DEFAULT_VISIBILITY_TIMEOUT_SECONDS,
      WaitTimeSeconds: waitTimeSeconds || 20,
      MessageSystemAttributeNames: messageSystemAttributeNames
    })
    const { Messages = [] } = await sqsClient.receiveMessages(receiveCommand)

    return Messages
  }

  async function extendVisibility(receiptHandle: string, visibilityTimeoutSeconds: number): Promise<void> {
    const command = new ChangeMessageVisibilityCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: visibilityTimeoutSeconds
    })
    await sqsClient.changeMessageVisibility(command)
  }

  async function deleteMessage(receiptHandle: string) {
    const deleteCommand = new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle
    })
    await sqsClient.deleteMessage(deleteCommand)
  }

  async function deleteMessages(receiptHandles: string[]) {
    const batchSize = 10
    const batches = chunks(receiptHandles, batchSize)

    for (const batch of batches) {
      const deleteCommand = new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((receiptHandle, index) => ({
          Id: `msg_${index}`,
          ReceiptHandle: receiptHandle
        }))
      })
      await sqsClient.deleteMessages(deleteCommand)
    }
  }

  async function getStatus() {
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
    deleteMessages,
    extendVisibility,
    getStatus
  }
}
