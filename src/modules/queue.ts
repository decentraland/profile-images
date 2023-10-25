import { DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import { config } from './config'
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

  async receive(handle: (message: QueueMessage) => Promise<void>, max: number) {
    try {
      const receiveCommand = new ReceiveMessageCommand({
        QueueUrl: this.queueName,
        MaxNumberOfMessages: max
      })
      const { Messages = [] } = await this.client.send(receiveCommand)

      if (Messages.length === 0) {
        return false
      }

      for (const Message of Messages) {
        const { MessageId, Body, ReceiptHandle } = Message
        if (!Body) {
          console.warn(
            `Message with MessageId=${MessageId} and ReceiptHandle=${ReceiptHandle} arrived with undefined Body`
          )
          continue
        }

        const message: QueueMessage = JSON.parse(Body)

        try {
          await handle(message)

          try {
            const deleteCommand = new DeleteMessageCommand({
              QueueUrl: config.QUEUE_NAME,
              ReceiptHandle
            })
            await this.client.send(deleteCommand)
          } catch (error) {
            console.error(
              `Could not delete message with MessageId=${MessageId} and ReceiptHandle=${ReceiptHandle}`,
              error
            )
          }
        } catch (error) {
          console.error(`Something went wrong processing address=${message.address}`, error)
        }
      }
    } catch (error) {
      console.error(`Something went wrong handling messages`, error)
    }

    return true
  }
}
