import { createConsumerComponent, MESSAGE_SYSTEM_ATTRIBUTE_NAMES } from '../../../src/adapters/consumer'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { Message } from '@aws-sdk/client-sqs'
import { QueueComponent } from '../../../src/logic/queue'
import { ILoggerComponent } from '@well-known-components/interfaces'
import { Entity, EntityType } from '@dcl/schemas'
import { MessageValidator } from '../../../src/logic/message-validator'
import { EntityFetcher } from '../../../src/adapters/entity-fetcher'
import { ImageProcessor } from '../../../src/logic/image-processor'
import { QueueWorker } from '../../../src/types'

const QUEUE_URL = 'main-queue-url'
const DLQ_URL = 'dlq-url'

describe('Consumer test', function () {
  const config = createConfigComponent({ QUEUE_URL, DLQ_URL }, {})

  let logs: ILoggerComponent
  let mainQueueMock: jest.Mocked<QueueComponent>
  let dlQueueMock: jest.Mocked<QueueComponent>
  let messageValidatorMock: jest.Mocked<MessageValidator>
  let entityFetcherMock: jest.Mocked<EntityFetcher>
  let imageProcessorMock: jest.Mocked<ImageProcessor>

  let consumer: QueueWorker

  beforeEach(async () => {
    const components = createMockComponents()

    mainQueueMock = components.mainQueue
    dlQueueMock = components.dlQueue
    messageValidatorMock = components.messageValidator
    entityFetcherMock = components.entityFetcher
    imageProcessorMock = components.imageProcessor

    logs = await createLogComponent({ config })

    consumer = createConsumerComponent({
      logs,
      mainQueue: mainQueueMock,
      dlQueue: dlQueueMock,
      messageValidator: messageValidatorMock,
      entityFetcher: entityFetcherMock,
      imageProcessor: imageProcessorMock
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('poll', () => {
    it('should poll main queue first and return messages if available', async () => {
      const mainQueueMessages = [createTestMessage('1'), createTestMessage('2')]

      mainQueueMock.receiveMessage.mockResolvedValueOnce(mainQueueMessages)

      const result = await consumer.poll()
      expect(result.queue).toBe(mainQueueMock)
      expect(result.messages).toBe(mainQueueMessages)
      expect(mainQueueMock.receiveMessage).toHaveBeenCalledTimes(1)
      expect(mainQueueMock.receiveMessage).toHaveBeenCalledWith({
        maxNumberOfMessages: 10,
        messageSystemAttributeNames: MESSAGE_SYSTEM_ATTRIBUTE_NAMES
      })
    })

    it('should poll DLQ if main queue is empty', async () => {
      const dlqMessages = [createTestMessage('3')]

      mainQueueMock.receiveMessage.mockResolvedValueOnce([]) // Main queue empty
      dlQueueMock.receiveMessage.mockResolvedValueOnce(dlqMessages)

      const result = await consumer.poll()

      expect(result.queue).toBe(dlQueueMock)
      expect(result.messages).toBe(dlqMessages)
      expect(dlQueueMock.receiveMessage).toHaveBeenCalledTimes(2)
      expect(dlQueueMock.receiveMessage).toHaveBeenNthCalledWith(1, {
        maxNumberOfMessages: 10,
        messageSystemAttributeNames: MESSAGE_SYSTEM_ATTRIBUTE_NAMES
      })
      expect(dlQueueMock.receiveMessage).toHaveBeenNthCalledWith(2, {
        maxNumberOfMessages: 1,
        messageSystemAttributeNames: MESSAGE_SYSTEM_ATTRIBUTE_NAMES
      })
    })
  })

  describe('processMessages', () => {
    it('should handle invalid messages by deleting them', async () => {
      const messages = [createTestMessage('1'), createTestMessage('2')]
      const invalidReceiptHandles = messages.map((msg) => msg.ReceiptHandle!)

      messageValidatorMock.validateMessages.mockReturnValueOnce({
        validMessages: [],
        invalidMessages: messages.map((msg) => ({ message: msg, error: 'invalid_json' }))
      })

      await consumer.processMessages(mainQueueMock, messages)

      expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith(invalidReceiptHandles)
      expect(entityFetcherMock.getEntitiesByIds).not.toHaveBeenCalled()
    })

    describe('Main Queue Processing', () => {
      it('should delete message on success', async () => {
        const entity = createTestEntity('1')
        const message = createTestMessage('1', { entity: { id: '1', type: EntityType.PROFILE } })

        setupSuccessfulProcessing(messageValidatorMock, entityFetcherMock, imageProcessorMock, message, entity)

        await consumer.processMessages(mainQueueMock, [message])

        expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith([message.ReceiptHandle])
      })

      it('should not delete message on failure when shouldRetry is true', async () => {
        const entity = createTestEntity('1')
        const message = createTestMessage('1', { entity: { id: '1', type: EntityType.PROFILE } })

        setupFailedProcessing(messageValidatorMock, entityFetcherMock, imageProcessorMock, message, entity, true)

        await consumer.processMessages(mainQueueMock, [message])

        expect(mainQueueMock.deleteMessages).not.toHaveBeenCalled()
        expect(mainQueueMock.deleteMessage).not.toHaveBeenCalled()
      })

      it('should delete message on failure when shouldRetry is false', async () => {
        const entity = createTestEntity('1')
        const message = createTestMessage('1', { entity: { id: '1', type: EntityType.PROFILE } })

        setupFailedProcessing(messageValidatorMock, entityFetcherMock, imageProcessorMock, message, entity, false)

        await consumer.processMessages(mainQueueMock, [message])

        expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith([message.ReceiptHandle])
      })
    })

    describe('DLQ Processing', () => {
      it('should delete message on success', async () => {
        const entity = createTestEntity('1')
        const message = createTestMessage('1', { entity: { id: '1', type: EntityType.PROFILE } })

        setupSuccessfulProcessing(messageValidatorMock, entityFetcherMock, imageProcessorMock, message, entity)

        await consumer.processMessages(dlQueueMock, [message])

        expect(dlQueueMock.deleteMessages).toHaveBeenCalledWith([message.ReceiptHandle])
      })

      it('should not delete message on failure (let visibility timeout expire)', async () => {
        const entity = createTestEntity('1')
        const message = createTestMessage('1', { entity: { id: '1', type: EntityType.PROFILE } })

        setupFailedProcessing(messageValidatorMock, entityFetcherMock, imageProcessorMock, message, entity, true) // shouldRetry is true for DLQ failures generally

        await consumer.processMessages(dlQueueMock, [message])

        expect(dlQueueMock.deleteMessages).not.toHaveBeenCalled()
        expect(dlQueueMock.deleteMessage).not.toHaveBeenCalled() // Ensure individual delete is also not called
      })
    })

    it('should handle message validation errors gracefully', async () => {
      const message = createTestMessage('1')

      // Mock validation to return empty results (as if all failed validation before this step)
      messageValidatorMock.validateMessages.mockReturnValueOnce({
        validMessages: [],
        invalidMessages: [] // Assuming no messages even get to the deletion stage if validation itself errors
      })

      await consumer.processMessages(mainQueueMock, [message])

      // On validation error (or no valid/invalid messages returned), processing should not continue to delete
      expect(entityFetcherMock.getEntitiesByIds).not.toHaveBeenCalled()
      expect(mainQueueMock.deleteMessages).not.toHaveBeenCalled()
      expect(mainQueueMock.deleteMessage).not.toHaveBeenCalled()
    })
  })

  // Helpers
  function setupSuccessfulProcessing(
    messageValidator: jest.Mocked<MessageValidator>,
    entityFetcher: jest.Mocked<EntityFetcher>,
    imageProcessor: jest.Mocked<ImageProcessor>,
    message: Message,
    entity: Entity
  ) {
    messageValidator.validateMessages.mockReturnValue({
      validMessages: [{ message, event: JSON.parse(message.Body!) }],
      invalidMessages: []
    })
    entityFetcher.getEntitiesByIds.mockResolvedValue([entity])
    imageProcessor.processEntities.mockResolvedValue([
      { entity: entity.id, success: true, shouldRetry: false, avatar: entity.metadata.avatars[0].avatar }
    ])
  }

  function setupFailedProcessing(
    messageValidator: jest.Mocked<MessageValidator>,
    entityFetcher: jest.Mocked<EntityFetcher>,
    imageProcessor: jest.Mocked<ImageProcessor>,
    message: Message,
    entity: Entity,
    shouldRetry: boolean
  ) {
    messageValidator.validateMessages.mockReturnValue({
      validMessages: [{ message, event: JSON.parse(message.Body!) }],
      invalidMessages: []
    })
    entityFetcher.getEntitiesByIds.mockResolvedValue([entity])
    imageProcessor.processEntities.mockResolvedValue([
      {
        entity: entity.id,
        success: false,
        shouldRetry,
        error: 'Processing failed',
        avatar: entity.metadata.avatars[0].avatar
      }
    ])
  }

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
      deleteMessages: jest.fn(),
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
      mainQueue: queue,
      dlQueue: queue,
      messageValidator,
      entityFetcher,
      imageProcessor
    }
  }
})
