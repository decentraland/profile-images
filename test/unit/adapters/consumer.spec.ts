import { createConsumerComponent, MESSAGE_SYSTEM_ATTRIBUTE_NAMES } from '../../../src/adapters/consumer'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createTestMetricsComponent } from '@well-known-components/metrics'
import { Message } from '@aws-sdk/client-sqs'
import { ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'
import { CatalystDeploymentEvent, Entity, EntityType, Events } from '@dcl/schemas'
import { QueueWorker } from '../../../src/types'
import { QueueComponent } from '../../../src/logic/queue'
import { MessageValidator } from '../../../src/logic/message-validator'
import { EntityFetcher } from '../../../src/adapters/entity-fetcher'
import { ImageProcessor } from '../../../src/logic/image-processor'
import { createQueueMock } from '../../mocks/queue-mock'
import { createMessageValidatorMock } from '../../mocks/message-validator-mock'
import { createEntityFetcherMock } from '../../mocks/entity-fetcher-mock'
import { createImageProcessorMock } from '../../mocks/image-processor-mock'
import { metricDeclarations } from '../../../src/metrics'

const QUEUE_URL = 'main-queue-url'
const DLQ_URL = 'dlq-url'

describe('when consuming the queue', () => {
  const config = createConfigComponent({ QUEUE_URL, DLQ_URL, MAX_DLQ_RETRIES: '5' }, {})

  let logs: ILoggerComponent
  let metrics: IMetricsComponent<keyof typeof metricDeclarations>
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
    metrics = createTestMetricsComponent(metricDeclarations)

    logs = await createLogComponent({ config })

    consumer = await createConsumerComponent({
      config,
      logs,
      mainQueue: mainQueueMock,
      dlQueue: dlQueueMock,
      messageValidator: messageValidatorMock,
      entityFetcher: entityFetcherMock,
      imageProcessor: imageProcessorMock,
      metrics
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
  const config = createConfigComponent({ QUEUE_URL, DLQ_URL, MAX_DLQ_RETRIES: '5' }, {})

  let logs: ILoggerComponent
  let metrics: IMetricsComponent<keyof typeof metricDeclarations>
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
    metrics = createTestMetricsComponent(metricDeclarations)

    logs = await createLogComponent({ config })

    consumer = await createConsumerComponent({
      config,
      logs,
      mainQueue: mainQueueMock,
      dlQueue: dlQueueMock,
      messageValidator: messageValidatorMock,
      entityFetcher: entityFetcherMock,
      imageProcessor: imageProcessorMock,
      metrics
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
        const completeEntity = createTestEntity('1')
        const standardizedEvent = createStandardizedEvent('1', completeEntity)

        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message, event: standardizedEvent }],
          invalidMessages: []
        })
        imageProcessorMock.processEntities.mockResolvedValue([
          { entity: '1', success: true, shouldRetry: false, avatar: completeEntity.metadata.avatars[0].avatar }
        ])
      })

      it('should process entities from messages without calling entity fetcher', async () => {
        await consumer.processMessages(mainQueueMock, [message])

        expect(entityFetcherMock.getEntitiesByIds).not.toHaveBeenCalled()
        expect(imageProcessorMock.processEntities).toHaveBeenCalledWith([
          {
            id: '1',
            type: EntityType.PROFILE,
            metadata: entity.metadata,
            version: 'v3',
            pointers: entity.pointers,
            timestamp: entity.timestamp,
            content: []
          }
        ])
        expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith([message.ReceiptHandle])
      })
    })

    describe('and entities cannot be extracted from messages', () => {
      beforeEach(() => {
        const incompleteEntity = {
          id: '1',
          type: EntityType.PROFILE,
          version: 'v3',
          pointers: ['0x1'],
          timestamp: 1234567890,
          content: [],
          metadata: {} // Missing avatars
        }
        const standardizedEvent = createStandardizedEvent('1', incompleteEntity)

        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message, event: standardizedEvent }],
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
        message1 = createTestMessage('1', { entity: entity1 })
        const standardizedEvent1 = createStandardizedEvent('1', entity1)

        // Message with non-extractable entity
        message2 = createTestMessage('2', {
          entity: {
            ...entity2,
            metadata: {} // Missing avatars
          }
        })
        const standardizedEvent2 = createStandardizedEvent('2', { ...entity2, metadata: {} })

        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [
            { message: message1, event: standardizedEvent1 },
            { message: message2, event: standardizedEvent2 }
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
          expect.objectContaining(entity1), // From message
          expect.objectContaining(entity2) // From fetcher
        ])
        expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith([message1.ReceiptHandle, message2.ReceiptHandle])
      })
    })

    describe('and processing succeeds', () => {
      let mockObserve: jest.SpyInstance
      let standardizedEvent: CatalystDeploymentEvent

      beforeEach(() => {
        standardizedEvent = createStandardizedEvent('1', entity)
        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message, event: standardizedEvent }],
          invalidMessages: []
        })
        entityFetcherMock.getEntitiesByIds.mockResolvedValue([entity])
        imageProcessorMock.processEntities.mockResolvedValue([
          { entity: entity.id, success: true, shouldRetry: false, avatar: entity.metadata.avatars[0].avatar }
        ])
        mockObserve = jest.spyOn(metrics, 'observe').mockImplementation(() => {})
      })

      describe('and the duration between message publication and image generation is greater than 0', () => {
        it('should delete the message and record the duration metric', async () => {
          await consumer.processMessages(mainQueueMock, [message])

          expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith([message.ReceiptHandle])
          expect(mockObserve).toHaveBeenCalledWith(
            'sqs_message_publication_to_image_generation_duration_seconds',
            {},
            expect.any(Number)
          )
        })
      })

      describe('and the duration between message publication and image generation is lower than 0', () => {
        beforeEach(() => {
          const standardizedEvent = createStandardizedEvent('1', entity)
          messageValidatorMock.validateMessages.mockReturnValue({
            validMessages: [{ message, event: { ...standardizedEvent, timestamp: Date.now() + 60000 } }],
            invalidMessages: []
          })
        })

        it('should delete the message and not record the duration metric', async () => {
          await consumer.processMessages(mainQueueMock, [message])

          expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith([message.ReceiptHandle])
          expect(mockObserve).not.toHaveBeenCalledWith(
            'sqs_message_publication_to_image_generation_duration_seconds',
            {},
            expect.any(Number)
          )
        })
      })
    })

    describe('and processing fails with shouldRetry true', () => {
      beforeEach(() => {
        const standardizedEvent = createStandardizedEvent('1', entity)
        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message, event: standardizedEvent }],
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
        await consumer.processMessages(mainQueueMock, [message])

        expect(mainQueueMock.deleteMessages).not.toHaveBeenCalled()
        expect(mainQueueMock.deleteMessage).not.toHaveBeenCalled()
      })
    })

    describe('and processing fails with shouldRetry false', () => {
      beforeEach(() => {
        const standardizedEvent = createStandardizedEvent('1', entity)
        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message, event: standardizedEvent }],
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
        const standardizedEvent = createStandardizedEvent('1', entity)
        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message, event: standardizedEvent }],
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

    describe('and processing fails with shouldRetry true', () => {
      beforeEach(() => {
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

      describe('when receive count is below limit', () => {
        beforeEach(() => {
          const messageWithLowReceiveCount = {
            ...message,
            Attributes: {
              ApproximateReceiveCount: '3'
            }
          }
          const standardizedEvent = createStandardizedEvent('1', entity)

          messageValidatorMock.validateMessages.mockReturnValue({
            validMessages: [{ message: messageWithLowReceiveCount, event: standardizedEvent }],
            invalidMessages: []
          })
        })

        it('should not delete the message', async () => {
          const messageWithLowReceiveCount = {
            ...message,
            Attributes: {
              ApproximateReceiveCount: '3'
            }
          }

          await consumer.processMessages(dlQueueMock, [messageWithLowReceiveCount])

          expect(dlQueueMock.deleteMessages).not.toHaveBeenCalled()
        })
      })

      describe('when receive count reaches limit', () => {
        beforeEach(() => {
          const messageWithMaxReceiveCount = {
            ...message,
            Attributes: {
              ...message.Attributes,
              ApproximateReceiveCount: '5'
            }
          }
          const standardizedEvent = createStandardizedEvent('1', entity)

          messageValidatorMock.validateMessages.mockReturnValue({
            validMessages: [{ message: messageWithMaxReceiveCount, event: standardizedEvent }],
            invalidMessages: []
          })
        })

        it('should delete the message', async () => {
          const messageWithMaxReceiveCount = {
            ...message,
            Attributes: {
              ...message.Attributes,
              ApproximateReceiveCount: '5'
            }
          }

          await consumer.processMessages(dlQueueMock, [messageWithMaxReceiveCount])

          expect(dlQueueMock.deleteMessages).toHaveBeenCalledWith([messageWithMaxReceiveCount.ReceiptHandle])
        })
      })

      describe('when receive count exceeds limit', () => {
        beforeEach(() => {
          const messageWithHighReceiveCount = {
            ...message,
            Attributes: {
              ApproximateReceiveCount: '7'
            }
          }
          const standardizedEvent = createStandardizedEvent('1', entity)

          messageValidatorMock.validateMessages.mockReturnValue({
            validMessages: [{ message: messageWithHighReceiveCount, event: standardizedEvent }],
            invalidMessages: []
          })
        })

        it('should delete the message', async () => {
          const messageWithHighReceiveCount = {
            ...message,
            Attributes: {
              ApproximateReceiveCount: '7'
            }
          }

          await consumer.processMessages(dlQueueMock, [messageWithHighReceiveCount])

          expect(dlQueueMock.deleteMessages).toHaveBeenCalledWith([messageWithHighReceiveCount.ReceiptHandle])
        })
      })
    })

    describe('and processing fails with shouldRetry false', () => {
      beforeEach(() => {
        const messageWithLowReceiveCount = {
          ...message,
          Attributes: {
            ApproximateReceiveCount: '2'
          }
        }
        const standardizedEvent = createStandardizedEvent('1', entity)

        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message: messageWithLowReceiveCount, event: standardizedEvent }],
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

      it('should delete the message regardless of receive count', async () => {
        const messageWithLowReceiveCount = {
          ...message,
          Attributes: {
            ApproximateReceiveCount: '2'
          }
        }

        await consumer.processMessages(dlQueueMock, [messageWithLowReceiveCount])

        expect(dlQueueMock.deleteMessages).toHaveBeenCalledWith([messageWithLowReceiveCount.ReceiptHandle])
      })
    })

    describe('and processing fails', () => {
      beforeEach(() => {
        const standardizedEvent = createStandardizedEvent('1', entity)
        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message, event: standardizedEvent }],
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
      const incompleteEntity = {
        id: '1',
        type: EntityType.PROFILE,
        version: 'v3',
        pointers: ['0x1'],
        timestamp: 1234567890,
        content: [],
        metadata: {} // Missing avatars
      }
      const standardizedEvent = createStandardizedEvent('1', incompleteEntity)

      messageValidatorMock.validateMessages.mockReturnValueOnce({
        validMessages: [{ message, event: standardizedEvent }],
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
      const incompleteEntity = {
        id: '1',
        type: EntityType.PROFILE,
        version: 'v3',
        pointers: ['0x1'],
        timestamp: 1234567890,
        content: [],
        metadata: {} // Missing avatars
      }
      const standardizedEvent = createStandardizedEvent('1', incompleteEntity)

      messageValidatorMock.validateMessages.mockReturnValueOnce({
        validMessages: [{ message, event: standardizedEvent }],
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

const createStandardizedEvent = (entityId: string, entity: Entity) =>
  ({
    type: Events.Type.CATALYST_DEPLOYMENT,
    subType: Events.SubType.CatalystDeployment.PROFILE,
    key: 'entity',
    timestamp: 1234567890,
    entity,
    authChain: []
  }) as any
