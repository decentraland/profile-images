import { Message } from '@aws-sdk/client-sqs'

export function getReceiveCount(message: Message) {
  return parseInt(message.Attributes?.ApproximateReceiveCount || '0')
}
