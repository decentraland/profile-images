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
import { SQSClient as AWS_SQSClient } from '@aws-sdk/client-sqs'
import { AppComponents } from '../types'

export type SqsClient = {
  sendMessage(payload: SendMessageCommand): Promise<SendMessageCommandOutput>
  getQueueAttributes(payload: GetQueueAttributesCommand): Promise<GetQueueAttributesCommandOutput>
  receiveMessages(payload: ReceiveMessageCommand): Promise<ReceiveMessageCommandOutput>
  deleteMessage(payload: DeleteMessageCommand): Promise<DeleteMessageCommandOutput>
}

export async function createSQSClient({ awsConfig }: Pick<AppComponents, 'awsConfig'>): Promise<SqsClient> {
  const client = new AWS_SQSClient(awsConfig)

  function sendMessage(payload: SendMessageCommand): Promise<SendMessageCommandOutput> {
    return client.send(payload)
  }

  function getQueueAttributes(payload: GetQueueAttributesCommand): Promise<GetQueueAttributesCommandOutput> {
    return client.send(payload)
  }

  function receiveMessages(payload: ReceiveMessageCommand): Promise<ReceiveMessageCommandOutput> {
    return client.send(payload)
  }

  function deleteMessage(payload: DeleteMessageCommand): Promise<DeleteMessageCommandOutput> {
    return client.send(payload)
  }

  return {
    sendMessage,
    getQueueAttributes,
    receiveMessages,
    deleteMessage
  }
}
