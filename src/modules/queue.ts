import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { config } from "./config";

export type QueueMessage = {
  address: string;
  entity: string;
};

export class Queue {
  constructor(
    public client: SQSClient,
    public queueName: string
  ) {}

  async send(message: QueueMessage) {
    const sendCommand = new SendMessageCommand({
      QueueUrl: this.queueName,
      MessageBody: JSON.stringify(message),
    });
    await this.client.send(sendCommand);
  }

  async receive(handle: (message: QueueMessage) => Promise<void>, max: number) {
    try {
      const receiveCommand = new ReceiveMessageCommand({
        QueueUrl: this.queueName,
        MaxNumberOfMessages: max,
      });
      const { Messages = [] } = await this.client.send(receiveCommand);

      if (Messages.length === 0) {
        return false;
      }

      let promises: Promise<void>[] = [];

      for (const Message of Messages) {
        const { MessageId, Body, ReceiptHandle } = Message;
        if (!Body) {
          console.warn(
            `Message with MessageId=${MessageId} and ReceiptHandle=${ReceiptHandle} arrived with undefined Body`
          );
          continue;
        }

        const message: QueueMessage = JSON.parse(Body);

        console.time(`Total ${message.entity}`);
        const promise = handle(message)
          .then(() => {
            const deleteCommand = new DeleteMessageCommand({
              QueueUrl: config.QUEUE_NAME,
              ReceiptHandle,
            });
            this.client.send(deleteCommand);
            console.timeEnd(`Total ${message.entity}`);
          })
          .catch((reason) => {
            console.timeEnd(`Total ${message.entity}`);
            console.log(
              `Error processing address="${message.address}" and entity="${message.entity}"`,
              reason
            );
          });

        promises.push(promise);
      }

      await Promise.all(promises);
    } catch (error) {
      console.error(`Something went wrong handling messages`, error);
    }

    return true;
  }
}
