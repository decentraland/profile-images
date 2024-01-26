import { SqsClient } from '../../src/adapters/sqs'
import {
  DeleteMessageCommand,
  DeleteMessageCommandOutput,
  GetQueueAttributesCommand,
  GetQueueAttributesCommandOutput,
  ReceiveMessageCommand,
  ReceiveMessageCommandOutput,
  SendMessageCommand,
  SendMessageCommandOutput
} from '@aws-sdk/client-sqs'
import { randomUUID } from 'node:crypto'

export function createInMemorySqs(): SqsClient {
  const storage: Map<string, any[]> = new Map()

  function sendMessage(payload: SendMessageCommand): Promise<SendMessageCommandOutput> {
    if (!storage.has(payload.input.QueueUrl)) {
      storage.set(payload.input.QueueUrl, [])
    }
    const queue = storage.get(payload.input.QueueUrl)
    queue.push(payload)
    return Promise.resolve({
      MessageId: randomUUID().toString(),
      $metadata: {}
    })
  }

  function getQueueAttributes(payload: GetQueueAttributesCommand): Promise<GetQueueAttributesCommandOutput> {
    const queue = storage.get(payload.input.QueueUrl)
    return Promise.resolve({
      Attributes: {
        ApproximateNumberOfMessages: queue?.length.toString(),
        ApproximateNumberOfMessagesNotVisible: '0',
        ApproximateNumberOfMessagesDelayed: '0'
      },
      $metadata: {}
    })
  }

  function receiveMessages(payload: ReceiveMessageCommand): Promise<ReceiveMessageCommandOutput> {
    if (!storage.has(payload.input.QueueUrl)) {
      return Promise.reject(new Error('Queue does not exist'))
    }
    const queue = storage.get(payload.input.QueueUrl)
    return Promise.resolve({
      Messages: queue.splice(0, payload.input.MaxNumberOfMessages).map((message) => ({
        MessageId: randomUUID().toString(),
        ReceiptHandle: randomUUID().toString(),
        Body: JSON.stringify(message.input.MessageBody),
        $metadata: {}
      })),
      $metadata: {}
    })
  }

  function deleteMessage(_payload: DeleteMessageCommand): Promise<DeleteMessageCommandOutput> {
    return Promise.resolve({
      $metadata: {}
    })
  }

  return { sendMessage, getQueueAttributes, receiveMessages, deleteMessage }
}
