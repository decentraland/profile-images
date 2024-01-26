import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  Message,
  ReceiveMessageCommand,
  SendMessageCommand
} from '@aws-sdk/client-sqs'
import { ExtendedAvatar } from '../types'
import { SqsClient } from '../adapters/sqs'

export async function sqsSendMessage(client: SqsClient, queueUrl: string, message: ExtendedAvatar) {
  const sendCommand = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(message)
  })
  await client.sendMessage(sendCommand)
}

export async function sqsReceiveMessage(
  client: SqsClient,
  queueUrl: string,
  options: { maxNumberOfMessages: number; waitTimeSeconds?: number }
): Promise<Message[]> {
  const receiveCommand = new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: options.maxNumberOfMessages,
    WaitTimeSeconds: options.waitTimeSeconds
  })
  const { Messages = [] } = await client.receiveMessages(receiveCommand)

  return Messages
}

export async function sqsDeleteMessage(client: SqsClient, queueUrl: string, receiptHandle: string) {
  const deleteCommand = new DeleteMessageCommand({
    QueueUrl: queueUrl,
    ReceiptHandle: receiptHandle
  })
  await client.deleteMessage(deleteCommand)
}

export async function sqsStatus(client: SqsClient, queueUrl: string): Promise<Record<string, any>> {
  const command = new GetQueueAttributesCommand({
    QueueUrl: queueUrl,
    AttributeNames: [
      'ApproximateNumberOfMessages',
      'ApproximateNumberOfMessagesNotVisible',
      'ApproximateNumberOfMessagesDelayed'
    ]
  })
  const response = await client.getQueueAttributes(command)
  return {
    ApproximateNumberOfMessages: response.Attributes?.ApproximateNumberOfMessages,
    ApproximateNumberOfMessagesNotVisible: response.Attributes?.ApproximateNumberOfMessagesNotVisible,
    ApproximateNumberOfMessagesDelayed: response.Attributes?.ApproximateNumberOfMessagesDelayed
  }
}
