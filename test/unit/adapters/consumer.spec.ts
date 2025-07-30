import { createConsumerComponent, MESSAGE_SYSTEM_ATTRIBUTE_NAMES } from '../../../src/adapters/consumer'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { Message } from '@aws-sdk/client-sqs'
import { ILoggerComponent } from '@well-known-components/interfaces'
import { Entity, EntityType } from '@dcl/schemas'
import { QueueWorker } from '../../../src/types'
import { QueueComponent } from '../../../src/logic/queue'
import { MessageValidator } from '../../../src/logic/message-validator'
import { EntityFetcher } from '../../../src/adapters/entity-fetcher'
import { ImageProcessor } from '../../../src/logic/image-processor'
import { createQueueMock } from '../../mocks/queue-mock'
import { createMessageValidatorMock } from '../../mocks/message-validator-mock'
import { createEntityFetcherMock } from '../../mocks/entity-fetcher-mock'
import { createImageProcessorMock } from '../../mocks/image-processor-mock'

const QUEUE_URL = 'main-queue-url'
const DLQ_URL = 'dlq-url'

describe('when consuming the queue', () => {
  const config = createConfigComponent({ QUEUE_URL, DLQ_URL }, {})

  let logs: ILoggerComponent
  let mainQueueMock: jest.Mocked<QueueComponent>
  let dlQueueMock: jest.Mocked<QueueComponent>
  let messageValidatorMock: jest.Mocked<MessageValidator>
  let entityFetcherMock: jest.Mocked<EntityFetcher>
  let imageProcessorMock: jest.Mocked<ImageProcessor>

  let consumer: QueueWorker

  beforeEach(async () => {
    mainQueueMock = createQueueMock()
    dlQueueMock = createQueueMock()
    messageValidatorMock = createMessageValidatorMock()
    entityFetcherMock = createEntityFetcherMock()
    imageProcessorMock = createImageProcessorMock()

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

  describe('and main queue has messages', () => {
    beforeEach(() => {
      const mainQueueMessages = [createTestMessage('1'), createTestMessage('2')]
      mainQueueMock.receiveMessage.mockResolvedValueOnce(mainQueueMessages)
    })

    it('should return messages from main queue', async () => {
      const result = await consumer.poll()
      expect(result.queue).toBe(mainQueueMock)
      expect(result.messages).toEqual([createTestMessage('1'), createTestMessage('2')])
      expect(mainQueueMock.receiveMessage).toHaveBeenCalledTimes(1)
      expect(mainQueueMock.receiveMessage).toHaveBeenCalledWith({
        maxNumberOfMessages: 10,
        messageSystemAttributeNames: MESSAGE_SYSTEM_ATTRIBUTE_NAMES
      })
    })
  })

  describe('and main queue is empty but DLQ has messages', () => {
    beforeEach(() => {
      const dlqMessages = [createTestMessage('3')]
      mainQueueMock.receiveMessage.mockResolvedValueOnce([])
      dlQueueMock.receiveMessage.mockResolvedValueOnce(dlqMessages)
    })

    it('should return messages from DLQ', async () => {
      const result = await consumer.poll()
      expect(result.queue).toBe(dlQueueMock)
      expect(result.messages).toEqual([createTestMessage('3')])
      expect(dlQueueMock.receiveMessage).toHaveBeenCalledTimes(1)
      expect(dlQueueMock.receiveMessage).toHaveBeenCalledWith({
        maxNumberOfMessages: 1,
        messageSystemAttributeNames: MESSAGE_SYSTEM_ATTRIBUTE_NAMES
      })
    })
  })
})

describe('when processing messages', () => {
  const config = createConfigComponent({ QUEUE_URL, DLQ_URL }, {})

  let logs: ILoggerComponent
  let mainQueueMock: jest.Mocked<QueueComponent>
  let dlQueueMock: jest.Mocked<QueueComponent>
  let messageValidatorMock: jest.Mocked<MessageValidator>
  let entityFetcherMock: jest.Mocked<EntityFetcher>
  let imageProcessorMock: jest.Mocked<ImageProcessor>

  let consumer: QueueWorker

  let entity: Entity
  let message: Message

  beforeEach(async () => {
    mainQueueMock = createQueueMock()
    dlQueueMock = createQueueMock()
    messageValidatorMock = createMessageValidatorMock()
    entityFetcherMock = createEntityFetcherMock()
    imageProcessorMock = createImageProcessorMock()

    logs = await createLogComponent({ config })

    consumer = createConsumerComponent({
      logs,
      mainQueue: mainQueueMock,
      dlQueue: dlQueueMock,
      messageValidator: messageValidatorMock,
      entityFetcher: entityFetcherMock,
      imageProcessor: imageProcessorMock
    })

    entity = createTestEntity('1')
    message = createTestMessage('1', { entity })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and messages are invalid', () => {
    beforeEach(() => {
      const messages = [createTestMessage('1'), createTestMessage('2')]
      messageValidatorMock.validateMessages.mockReturnValueOnce({
        validMessages: [],
        invalidMessages: messages.map((msg) => ({ message: msg, error: 'invalid_json' }))
      })
    })

    it('should delete invalid messages', async () => {
      const messages = [createTestMessage('1'), createTestMessage('2')]
      const invalidReceiptHandles = messages.map((msg) => msg.ReceiptHandle!)

      await consumer.processMessages(mainQueueMock, messages)

      expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith(invalidReceiptHandles)
      expect(entityFetcherMock.getEntitiesByIds).not.toHaveBeenCalled()
    })
  })

  describe('and processing from main queue', () => {
    describe('and entities can be extracted from messages', () => {
      beforeEach(() => {
        // Override the message to have extractable entity data
        message = createTestMessage('1', {
          entity: {
            entityId: '1',
            entityType: EntityType.PROFILE,
            id: '1',
            version: 'v3',
            pointers: ['0x1'],
            entityTimestamp: 1234567890,
            content: [],
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
            }
          }
        })

        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message, event: JSON.parse(message.Body!) }],
          invalidMessages: []
        })
        imageProcessorMock.processEntities.mockResolvedValue([
          { entity: entity.id, success: true, shouldRetry: false, avatar: entity.metadata.avatars[0].avatar }
        ])
      })

      it('should process entities from messages without calling entity fetcher', async () => {
        await consumer.processMessages(mainQueueMock, [message])

        expect(entityFetcherMock.getEntitiesByIds).not.toHaveBeenCalled()
        expect(imageProcessorMock.processEntities).toHaveBeenCalledWith([
          expect.objectContaining({
            id: '1',
            type: EntityType.PROFILE,
            metadata: expect.objectContaining({
              avatars: expect.arrayContaining([
                expect.objectContaining({
                  avatar: expect.objectContaining({
                    bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseMale'
                  })
                })
              ])
            })
          })
        ])
        expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith([message.ReceiptHandle])
      })
    })

    describe('and entities cannot be extracted from messages', () => {
      beforeEach(() => {
        // Override the message to have non-extractable entity data
        message = createTestMessage('1', {
          entity: {
            entityId: '1',
            entityType: EntityType.PROFILE,
            id: '1',
            // Missing metadata.avatars
            metadata: {}
          }
        })

        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message, event: JSON.parse(message.Body!) }],
          invalidMessages: []
        })
        entityFetcherMock.getEntitiesByIds.mockResolvedValue([entity])
        imageProcessorMock.processEntities.mockResolvedValue([
          { entity: entity.id, success: true, shouldRetry: false, avatar: entity.metadata.avatars[0].avatar }
        ])
      })

      it('should fetch entities from entity fetcher', async () => {
        await consumer.processMessages(mainQueueMock, [message])

        expect(entityFetcherMock.getEntitiesByIds).toHaveBeenCalledWith(['1'])
        expect(imageProcessorMock.processEntities).toHaveBeenCalledWith([entity])
        expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith([message.ReceiptHandle])
      })
    })

    describe('and some entities can be extracted and others need fetching', () => {
      let message1: Message
      let message2: Message
      let entity1: Entity
      let entity2: Entity

      beforeEach(() => {
        entity1 = createTestEntity('1')
        entity2 = createTestEntity('2')

        // Message with extractable entity
        message1 = createTestMessage('1', {
          entity: {
            entityId: '1',
            entityType: EntityType.PROFILE,
            id: '1',
            version: 'v3',
            pointers: ['0x1'],
            entityTimestamp: 1234567890,
            content: [],
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
            }
          }
        })

        // Message with non-extractable entity
        message2 = createTestMessage('2', {
          entity: {
            entityId: '2',
            entityType: EntityType.PROFILE,
            id: '2',
            // Missing metadata.avatars
            metadata: {}
          }
        })

        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [
            { message: message1, event: JSON.parse(message1.Body!) },
            { message: message2, event: JSON.parse(message2.Body!) }
          ],
          invalidMessages: []
        })
        entityFetcherMock.getEntitiesByIds.mockResolvedValue([entity2])
        imageProcessorMock.processEntities.mockResolvedValue([
          { entity: entity1.id, success: true, shouldRetry: false, avatar: entity1.metadata.avatars[0].avatar },
          { entity: entity2.id, success: true, shouldRetry: false, avatar: entity2.metadata.avatars[0].avatar }
        ])
      })

      it('should combine entities from messages and fetcher', async () => {
        await consumer.processMessages(mainQueueMock, [message1, message2])

        expect(entityFetcherMock.getEntitiesByIds).toHaveBeenCalledWith(['2'])
        expect(imageProcessorMock.processEntities).toHaveBeenCalledWith([
          expect.objectContaining({ id: '1' }), // From message
          expect.objectContaining({ id: '2' }) // From fetcher
        ])
        expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith([message1.ReceiptHandle, message2.ReceiptHandle])
      })
    })

    describe('and processing succeeds', () => {
      beforeEach(() => {
        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message, event: JSON.parse(message.Body!) }],
          invalidMessages: []
        })
        entityFetcherMock.getEntitiesByIds.mockResolvedValue([entity])
        imageProcessorMock.processEntities.mockResolvedValue([
          { entity: entity.id, success: true, shouldRetry: false, avatar: entity.metadata.avatars[0].avatar }
        ])
      })

      it('should delete the message', async () => {
        await consumer.processMessages(mainQueueMock, [message])

        expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith([message.ReceiptHandle])
      })
    })

    describe('and processing fails with shouldRetry false', () => {
      beforeEach(() => {
        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message, event: JSON.parse(message.Body!) }],
          invalidMessages: []
        })
        entityFetcherMock.getEntitiesByIds.mockResolvedValue([entity])
        imageProcessorMock.processEntities.mockResolvedValue([
          {
            entity: entity.id,
            success: false,
            shouldRetry: false,
            error: 'Processing failed',
            avatar: entity.metadata.avatars[0].avatar
          }
        ])
      })

      it('should delete the message', async () => {
        await consumer.processMessages(mainQueueMock, [message])

        expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith([message.ReceiptHandle])
      })
    })
  })

  describe('and processing from DLQ', () => {
    describe('and processing succeeds', () => {
      beforeEach(() => {
        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message, event: JSON.parse(message.Body!) }],
          invalidMessages: []
        })
        entityFetcherMock.getEntitiesByIds.mockResolvedValue([entity])
        imageProcessorMock.processEntities.mockResolvedValue([
          { entity: entity.id, success: true, shouldRetry: false, avatar: entity.metadata.avatars[0].avatar }
        ])
      })

      it('should delete the message', async () => {
        await consumer.processMessages(dlQueueMock, [message])

        expect(dlQueueMock.deleteMessages).toHaveBeenCalledWith([message.ReceiptHandle])
      })
    })

    describe('and processing fails', () => {
      beforeEach(() => {
        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message, event: JSON.parse(message.Body!) }],
          invalidMessages: []
        })
        entityFetcherMock.getEntitiesByIds.mockResolvedValue([entity])
        imageProcessorMock.processEntities.mockResolvedValue([
          {
            entity: entity.id,
            success: false,
            shouldRetry: true,
            error: 'Processing failed',
            avatar: entity.metadata.avatars[0].avatar
          }
        ])
      })

      it('should not delete the message', async () => {
        await consumer.processMessages(dlQueueMock, [message])

        expect(dlQueueMock.deleteMessages).not.toHaveBeenCalled()
        expect(dlQueueMock.deleteMessage).not.toHaveBeenCalled()
      })
    })
  })

  describe('and message validation returns empty results', () => {
    beforeEach(() => {
      messageValidatorMock.validateMessages.mockReturnValueOnce({
        validMessages: [],
        invalidMessages: []
      })
    })

    it('should not call entity fetcher or delete messages', async () => {
      await consumer.processMessages(mainQueueMock, [message])

      expect(entityFetcherMock.getEntitiesByIds).not.toHaveBeenCalled()
      expect(mainQueueMock.deleteMessages).not.toHaveBeenCalled()
      expect(mainQueueMock.deleteMessage).not.toHaveBeenCalled()
    })
  })

  describe('and entity fetcher returns null entities', () => {
    beforeEach(() => {
      // Override message to have non-extractable entity
      message = createTestMessage('1', {
        entity: {
          entityId: '1',
          entityType: EntityType.PROFILE,
          id: '1',
          // Missing metadata.avatars
          metadata: {}
        }
      })

      messageValidatorMock.validateMessages.mockReturnValueOnce({
        validMessages: [{ message, event: JSON.parse(message.Body!) }],
        invalidMessages: []
      })
      entityFetcherMock.getEntitiesByIds.mockResolvedValueOnce([])
    })

    it('should delete the message and not call image processor', async () => {
      await consumer.processMessages(mainQueueMock, [message])

      expect(entityFetcherMock.getEntitiesByIds).toHaveBeenCalledWith(['1'])
      expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith([message.ReceiptHandle])
      expect(imageProcessorMock.processEntities).not.toHaveBeenCalled()
    })
  })

  describe('and entity fetcher returns empty array', () => {
    beforeEach(() => {
      // Override message to have non-extractable entity
      message = createTestMessage('1', {
        entity: {
          entityId: '1',
          entityType: EntityType.PROFILE,
          id: '1',
          // Missing metadata.avatars
          metadata: {}
        }
      })

      messageValidatorMock.validateMessages.mockReturnValueOnce({
        validMessages: [{ message, event: JSON.parse(message.Body!) }],
        invalidMessages: []
      })
      entityFetcherMock.getEntitiesByIds.mockResolvedValueOnce([])
    })

    it('should delete the message and not call image processor', async () => {
      await consumer.processMessages(mainQueueMock, [message])

      expect(entityFetcherMock.getEntitiesByIds).toHaveBeenCalledWith(['1'])
      expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith([message.ReceiptHandle])
      expect(imageProcessorMock.processEntities).not.toHaveBeenCalled()
    })
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
