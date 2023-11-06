import { DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import { QueueMessage } from '../types'
import { sleep } from './sleep'

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

        console.time(`Total ${message.entity}`)
        try {
          await handle(message)
          const deleteCommand = new DeleteMessageCommand({
            QueueUrl: this.queueName,
            ReceiptHandle
          })
          await this.client.send(deleteCommand)
        } catch (reason) {
          console.log(`Error processing`)
          console.log(`Error processing address="${message.address}" and entity="${message.entity}"`, reason)
        } finally {
          console.timeEnd(`Total ${message.entity}`)
        }
      }
    } catch (error) {
      console.error(`Something went wrong handling messages`, error)
      await sleep(10000)
    }

    return true
  }
}
