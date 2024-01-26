import { createTestMetricsComponent } from '@well-known-components/metrics'
import { createConsumerComponent } from '../../src/adapters/consumer'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { ExtendedAvatar } from '../../src/types'
import { GodotComponent } from '../../src/adapters/godot'
import { SqsClient } from '../../src/adapters/sqs'
import { ReceiveMessageCommand, Message } from '@aws-sdk/client-sqs'
import { metricDeclarations } from '../../src/metrics'
import { IStorageComponent } from '../../src/adapters/storage'

const QUEUE_NAME = 'main-queue'
const RETRY_QUEUE_NAME = 'retry-queue'

describe('Consumer test', function () {
  const config = createConfigComponent({ QUEUE_NAME, RETRY_QUEUE_NAME }, {})
  const metrics = createTestMetricsComponent(metricDeclarations)

  it('poll', async () => {
    const logs = await createLogComponent({ config })

    const godot: GodotComponent = {
      generateImages: jest.fn()
    }

    const receiveMessages = jest.fn()
    const sqsClient: SqsClient = {
      receiveMessages
    } as any
    const storage: IStorageComponent = {} as any
    const consumer = await createConsumerComponent({ metrics, config, logs, godot, sqsClient, storage })

    let queueMessages = [1, 2, 3, 4]
    let retryQueueMessages = [5, 6]
    receiveMessages.mockImplementation((payload: ReceiveMessageCommand) => {
      if (payload.input.QueueUrl === QUEUE_NAME) {
        const r = { Messages: queueMessages }
        queueMessages = []
        return r
      } else if (payload.input.QueueUrl === RETRY_QUEUE_NAME) {
        const r = { Messages: retryQueueMessages }
        retryQueueMessages = []
        return r
      }
    })

    {
      const { queueUrl, messages } = await consumer.poll()
      expect(queueUrl).toEqual(QUEUE_NAME)
      expect(messages).toHaveLength(4)
    }

    {
      const { queueUrl, messages } = await consumer.poll()
      expect(queueUrl).toEqual(RETRY_QUEUE_NAME)
      expect(messages).toHaveLength(2)
    }

    {
      const { messages } = await consumer.poll()
      expect(messages).toHaveLength(0)
    }
  })

  it('process: handle invalid messages', async () => {
    const logs = await createLogComponent({ config })

    const godot: GodotComponent = {
      generateImages: jest.fn()
    }

    const deleteMessage = jest.fn()
    const sqsClient: SqsClient = {
      deleteMessage
    } as any
    const storage: IStorageComponent = {} as any
    const consumer = await createConsumerComponent({ metrics, config, logs, godot, sqsClient, storage })

    const messages: Message[] = [
      {
        ReceiptHandle: '0'
      }
    ]
    await consumer.process(QUEUE_NAME, messages)

    expect(deleteMessage).toHaveBeenCalledTimes(1)
    const { QueueUrl, ReceiptHandle } = deleteMessage.mock.calls[0][0].input
    expect(QueueUrl).toEqual(QUEUE_NAME)
    expect(ReceiptHandle).toEqual('0')
  })

  it('process: call godot with a single entity failure', async () => {
    const logs = await createLogComponent({ config })

    const generateImages = jest.fn()

    const deleteMessage = jest.fn()
    const sendMessage = jest.fn()
    const sqsClient: SqsClient = {
      deleteMessage,
      sendMessage
    } as any

    const storeFailure = jest.fn()
    const storage: IStorageComponent = {
      storeFailure
    } as any

    const consumer = await createConsumerComponent({
      metrics,
      config,
      logs,
      godot: { generateImages },
      sqsClient,
      storage
    })

    const messages: Message[] = [
      {
        ReceiptHandle: '0',
        Body: JSON.stringify({ entity: '0', avatar: {} })
      }
    ]

    generateImages.mockImplementation((input: ExtendedAvatar[]) => {
      return input.map(({ avatar, entity }: ExtendedAvatar) => ({
        avatar,
        entity,
        success: false,
        avatarPath: 'avatar0.png',
        facePath: 'face0.png'
      }))
    })

    await consumer.process(QUEUE_NAME, messages)

    expect(deleteMessage).toHaveBeenCalledTimes(1)
    {
      const { QueueUrl, ReceiptHandle } = deleteMessage.mock.calls[0][0].input
      expect(QueueUrl).toEqual(QUEUE_NAME)
      expect(ReceiptHandle).toEqual('0')
    }

    expect(storeFailure).toHaveBeenCalledTimes(1)
    expect(storeFailure.mock.calls[0][0]).toEqual('0')
  })

  it('process: call godot with multiple entity failure should requeue the messages individually', async () => {
    const logs = await createLogComponent({ config })

    const generateImages = jest.fn()

    const deleteMessage = jest.fn()
    const sendMessage = jest.fn()
    const sqsClient: SqsClient = {
      deleteMessage,
      sendMessage
    } as any

    const storage: IStorageComponent = {} as any

    const consumer = await createConsumerComponent({
      metrics,
      config,
      logs,
      godot: { generateImages },
      sqsClient,
      storage
    })

    const messages: Message[] = [
      {
        ReceiptHandle: '0',
        Body: JSON.stringify({ entity: '0', avatar: {} })
      },
      {
        ReceiptHandle: '1',
        Body: JSON.stringify({ entity: '1', avatar: {} })
      }
    ]

    generateImages.mockImplementation((input: ExtendedAvatar[]) => {
      return input.map(({ avatar, entity }: ExtendedAvatar, i) => ({
        avatar,
        entity,
        success: false,
        avatarPath: `avatar${i}.png`,
        facePath: `face${i}.png`
      }))
    })

    await consumer.process(QUEUE_NAME, messages)

    expect(deleteMessage).toHaveBeenCalledTimes(2)
    {
      const { QueueUrl, ReceiptHandle } = deleteMessage.mock.calls[0][0].input
      expect(QueueUrl).toEqual(QUEUE_NAME)
      expect(ReceiptHandle).toEqual('0')
    }
    {
      const { QueueUrl, ReceiptHandle } = deleteMessage.mock.calls[1][0].input
      expect(QueueUrl).toEqual(QUEUE_NAME)
      expect(ReceiptHandle).toEqual('1')
    }

    expect(sendMessage).toHaveBeenCalledTimes(2)
    {
      const { QueueUrl } = sendMessage.mock.calls[0][0].input
      expect(QueueUrl).toEqual(RETRY_QUEUE_NAME)
    }
    {
      const { QueueUrl } = sendMessage.mock.calls[0][0].input
      expect(QueueUrl).toEqual(RETRY_QUEUE_NAME)
    }
  })

  it('process: call godot with successful results', async () => {
    const logs = await createLogComponent({ config })

    const generateImages = jest.fn()

    const deleteMessage = jest.fn()
    const sqsClient: SqsClient = {
      deleteMessage
    } as any

    const storeImages = jest.fn().mockResolvedValue(true)
    const storage: IStorageComponent = {
      storeImages
    } as any

    const consumer = await createConsumerComponent({
      metrics,
      config,
      logs,
      godot: { generateImages },
      sqsClient,
      storage
    })

    const messages: Message[] = [
      {
        ReceiptHandle: '0',
        Body: JSON.stringify({ entity: '0', avatar: {} })
      },
      {
        ReceiptHandle: '1',
        Body: JSON.stringify({ entity: '1', avatar: {} })
      }
    ]

    generateImages.mockImplementation((input: ExtendedAvatar[]) => {
      return input.map(({ avatar, entity }: ExtendedAvatar, i) => ({
        avatar,
        entity,
        success: true,
        avatarPath: `avatar${i}.png`,
        facePath: `face${i}.png`
      }))
    })

    await consumer.process(QUEUE_NAME, messages)

    expect(deleteMessage).toHaveBeenCalledTimes(2)
    {
      const { QueueUrl, ReceiptHandle } = deleteMessage.mock.calls[0][0].input
      expect(QueueUrl).toEqual(QUEUE_NAME)
      expect(ReceiptHandle).toEqual('0')
    }
    {
      const { QueueUrl, ReceiptHandle } = deleteMessage.mock.calls[1][0].input
      expect(QueueUrl).toEqual(QUEUE_NAME)
      expect(ReceiptHandle).toEqual('1')
    }
  })
})
