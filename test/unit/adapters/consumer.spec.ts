import { createConsumerComponent } from '../../../src/adapters/consumer'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { Message } from '@aws-sdk/client-sqs'
import { QueueComponent } from '../../../src/logic/queue'
import { ILoggerComponent } from '@well-known-components/interfaces'
import { CatalystDeploymentEvent, Entity, EntityType } from '@dcl/schemas'
import { MessageValidator } from '../../../src/logic/message-validator'
import { EntityFetcher } from '../../../src/adapters/entity-fetcher'
import { ImageProcessor } from '../../../src/logic/image-processor'

const QUEUE_NAME = 'main-queue'
const RETRY_QUEUE_NAME = 'retry-queue'

describe('Consumer test', function () {
  const config = createConfigComponent({ QUEUE_NAME, RETRY_QUEUE_NAME }, {})
  let logs: ILoggerComponent

  beforeEach(async () => {
    logs = await createLogComponent({ config })
  })

  describe('poll', () => {
    it('should poll main queue first and retry queue if main is empty', async () => {
      const { queue, messageValidator, entityFetcher, imageProcessor } = createMockComponents()

      queue.receiveMessage.mockResolvedValueOnce([])
      queue.receiveMessage.mockResolvedValueOnce([createTestMessage('4'), createTestMessage('5')])

      const consumer = await createConsumerComponent({
        config,
        logs,
        queue,
        messageValidator,
        entityFetcher,
        imageProcessor
      })

      const result1 = await consumer.poll()
      expect(result1.queueUrl).toBe(RETRY_QUEUE_NAME)
      expect(result1.messages).toHaveLength(2)

      expect(queue.receiveMessage).toHaveBeenCalledTimes(2)
      expect(queue.receiveMessage).toHaveBeenNthCalledWith(1, QUEUE_NAME, { maxNumberOfMessages: 10 })
      expect(queue.receiveMessage).toHaveBeenNthCalledWith(2, RETRY_QUEUE_NAME, { maxNumberOfMessages: 1 })
    })

    it('should throw error when queue.receiveMessage fails', async () => {
      const { queue, messageValidator, entityFetcher, imageProcessor } = createMockComponents()

      const expectedError = new Error('Queue error')
      queue.receiveMessage.mockRejectedValueOnce(expectedError)

      const consumer = await createConsumerComponent({
        config,
        logs,
        queue,
        messageValidator,
        entityFetcher,
        imageProcessor
      })

      await expect(consumer.poll()).rejects.toThrow(expectedError)

      expect(queue.receiveMessage).toHaveBeenCalledTimes(1)
      expect(queue.receiveMessage).toHaveBeenCalledWith(QUEUE_NAME, { maxNumberOfMessages: 10 })
    })
  })

  describe('processMessages', () => {
    it('should handle invalid messages and delete them immediately', async () => {
      const { queue, messageValidator, entityFetcher, imageProcessor } = createMockComponents()
      const messages = [createTestMessage('1'), createTestMessage('2')]

      messageValidator.validateMessages.mockReturnValueOnce({
        validMessages: [],
        invalidMessages: messages.map((msg) => ({ message: msg, error: 'invalid_json' }))
      })

      const consumer = await createConsumerComponent({
        config,
        logs,
        queue,
        messageValidator,
        entityFetcher,
        imageProcessor
      })

      await consumer.processMessages(QUEUE_NAME, messages)

      expect(messageValidator.validateMessages).toHaveBeenCalledTimes(1)
      expect(queue.deleteMessage).toHaveBeenCalledTimes(2)
      expect(entityFetcher.getEntitiesByIds).not.toHaveBeenCalled()
      expect(imageProcessor.processEntities).not.toHaveBeenCalled()
    })

    it('should process valid messages successfully', async () => {
      const { queue, messageValidator, entityFetcher, imageProcessor } = createMockComponents()
      const entity1 = createTestEntity('1')
      const entity2 = createTestEntity('2')

      const event1 = { entity: { id: '1', type: EntityType.PROFILE }, avatar: entity1.metadata.avatars[0].avatar }
      const event2 = { entity: { id: '2', type: EntityType.PROFILE }, avatar: entity2.metadata.avatars[0].avatar }

      const messages = [createTestMessage('1', event1), createTestMessage('2', event2)]

      messageValidator.validateMessages.mockReturnValueOnce({
        validMessages: messages.map((msg) => ({
          message: msg,
          event: JSON.parse(msg.Body!) as CatalystDeploymentEvent
        })),
        invalidMessages: []
      })

      entityFetcher.getEntitiesByIds.mockResolvedValueOnce([entity1, entity2])

      imageProcessor.processEntities.mockResolvedValueOnce([
        { entity: '1', success: true, shouldRetry: false, avatar: entity1.metadata.avatars[0].avatar },
        { entity: '2', success: true, shouldRetry: false, avatar: entity2.metadata.avatars[0].avatar }
      ])

      const consumer = await createConsumerComponent({
        config,
        logs,
        queue,
        messageValidator,
        entityFetcher,
        imageProcessor
      })

      await consumer.processMessages(QUEUE_NAME, messages)

      expect(messageValidator.validateMessages).toHaveBeenCalledWith(messages)
      expect(entityFetcher.getEntitiesByIds).toHaveBeenCalledWith(['1', '2'])
      expect(imageProcessor.processEntities).toHaveBeenCalledWith([entity1, entity2])
      expect(queue.deleteMessage).toHaveBeenCalledTimes(2)
      expect(queue.deleteMessage).toHaveBeenNthCalledWith(1, QUEUE_NAME, 'receipt-1')
      expect(queue.deleteMessage).toHaveBeenNthCalledWith(2, QUEUE_NAME, 'receipt-2')
    })

    it('should handle processing failures with retry', async () => {
      const { queue, messageValidator, entityFetcher, imageProcessor } = createMockComponents()
      const entity1 = createTestEntity('1')
      const entity2 = createTestEntity('2')

      const event1 = { entity: { id: '1', type: EntityType.PROFILE }, avatar: entity1.metadata.avatars[0].avatar }
      const event2 = { entity: { id: '2', type: EntityType.PROFILE }, avatar: entity2.metadata.avatars[0].avatar }

      const messages = [createTestMessage('1', event1), createTestMessage('2', event2)]

      messageValidator.validateMessages.mockReturnValueOnce({
        validMessages: messages.map((msg) => ({
          message: msg,
          event: JSON.parse(msg.Body!) as CatalystDeploymentEvent
        })),
        invalidMessages: []
      })

      entityFetcher.getEntitiesByIds.mockResolvedValueOnce([entity1, entity2])

      imageProcessor.processEntities.mockResolvedValueOnce([
        { entity: '1', success: false, shouldRetry: true, avatar: entity1.metadata.avatars[0].avatar },
        { entity: '2', success: false, shouldRetry: true, avatar: entity2.metadata.avatars[0].avatar }
      ])

      const consumer = await createConsumerComponent({
        config,
        logs,
        queue,
        messageValidator,
        entityFetcher,
        imageProcessor
      })

      await consumer.processMessages(QUEUE_NAME, messages)

      expect(messageValidator.validateMessages).toHaveBeenCalledWith(messages)
      expect(entityFetcher.getEntitiesByIds).toHaveBeenCalledWith(['1', '2'])
      expect(imageProcessor.processEntities).toHaveBeenCalledWith([entity1, entity2])
      expect(queue.deleteMessage).toHaveBeenCalledTimes(2)
      expect(queue.sendMessage).toHaveBeenCalledTimes(2)
      expect(queue.sendMessage).toHaveBeenNthCalledWith(1, RETRY_QUEUE_NAME, event1)
      expect(queue.sendMessage).toHaveBeenNthCalledWith(2, RETRY_QUEUE_NAME, event2)
    })
  })

  // Helpers
  const createTestMessage = (id: string, body?: any): Message => ({
    MessageId: id,
    ReceiptHandle: `receipt-${id}`,
    Body: body ? JSON.stringify(body) : undefined,
    MD5OfBody: 'test-md5',
    Attributes: {}
  })

  const createTestEntity = (id: string): Entity => ({
    id,
    type: EntityType.PROFILE,
    metadata: {
      avatars: [
        {
          avatar: {
            bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseMale',
            eyes: { color: { r: 0.23, g: 0.24, b: 0.25 } },
            hair: { color: { r: 0.23, g: 0.24, b: 0.25 } },
            skin: { color: { r: 0.23, g: 0.24, b: 0.25 } }
          }
        }
      ]
    },
    version: 'v3',
    pointers: [`0x${id}`],
    timestamp: 1234567890,
    content: []
  })

  const createMockComponents = () => {
    const queue: jest.Mocked<QueueComponent> = {
      receiveMessage: jest.fn(),
      sendMessage: jest.fn(),
      deleteMessage: jest.fn(),
      getStatus: jest.fn().mockReturnValue({ isProcessing: false })
    }

    const messageValidator: jest.Mocked<MessageValidator> = {
      validateMessages: jest.fn().mockReturnValue({
        validMessages: [],
        invalidMessages: []
      })
    }

    const entityFetcher: jest.Mocked<EntityFetcher> = {
      getEntitiesByIds: jest.fn()
    }

    const imageProcessor: jest.Mocked<ImageProcessor> = {
      processEntities: jest.fn()
    }

    return {
      queue,
      messageValidator,
      entityFetcher,
      imageProcessor
    }
  }
})
