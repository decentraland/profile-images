import { createConsumerComponent, MESSAGE_SYSTEM_ATTRIBUTE_NAMES } from '../../../src/adapters/consumer'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createTestMetricsComponent } from '@dcl/metrics'
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
        invalidMessages: messages.map((msg) => ({ message: msg, error: 'invalid_json' })),
        rateLimitedMessages: []
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

  describe('and messages are rate-limited', () => {
    it('should extend visibility for each rate-limited message with correct timeout', async () => {
      const msg1 = createTestMessage('1')
      const msg2 = createTestMessage('2')
      messageValidatorMock.validateMessages.mockReturnValueOnce({
        validMessages: [],
        invalidMessages: [],
        rateLimitedMessages: [
          { message: msg1, remainingMs: 5000 },
          { message: msg2, remainingMs: 1500 }
        ]
      })

      await consumer.processMessages(mainQueueMock, [msg1, msg2])

      expect(mainQueueMock.extendVisibility).toHaveBeenCalledTimes(2)
      expect(mainQueueMock.extendVisibility).toHaveBeenCalledWith(msg1.ReceiptHandle, 5)
      expect(mainQueueMock.extendVisibility).toHaveBeenCalledWith(msg2.ReceiptHandle, 2)
    })

    it('should ceil remainingMs to the next whole second', async () => {
      const msg = createTestMessage('1')
      messageValidatorMock.validateMessages.mockReturnValueOnce({
        validMessages: [],
        invalidMessages: [],
        rateLimitedMessages: [{ message: msg, remainingMs: 1 }]
      })

      await consumer.processMessages(mainQueueMock, [msg])

      expect(mainQueueMock.extendVisibility).toHaveBeenCalledWith(msg.ReceiptHandle, 1)
    })

    it('should log warning and continue when extendVisibility fails', async () => {
      const msg1 = createTestMessage('1')
      const msg2 = createTestMessage('2')
      messageValidatorMock.validateMessages.mockReturnValueOnce({
        validMessages: [],
        invalidMessages: [],
        rateLimitedMessages: [
          { message: msg1, remainingMs: 5000 },
          { message: msg2, remainingMs: 3000 }
        ]
      })
      mainQueueMock.extendVisibility.mockRejectedValueOnce(new Error('SQS error'))

      await expect(consumer.processMessages(mainQueueMock, [msg1, msg2])).resolves.not.toThrow()
      expect(mainQueueMock.extendVisibility).toHaveBeenCalledTimes(2)
      expect(mainQueueMock.extendVisibility).toHaveBeenCalledWith(msg2.ReceiptHandle, 3)
    })

    it('should handle rate-limited messages alongside valid and invalid messages', async () => {
      const validMsg = createTestMessage('1', { entity: createTestEntity('1') })
      const invalidMsg = createTestMessage('2')
      const rateLimitedMsg = createTestMessage('3')
      const validEntity = createTestEntity('1')
      const standardizedEvent = createStandardizedEvent('1', validEntity)

      messageValidatorMock.validateMessages.mockReturnValueOnce({
        validMessages: [{ message: validMsg, event: standardizedEvent }],
        invalidMessages: [{ message: invalidMsg, error: 'invalid_json' }],
        rateLimitedMessages: [{ message: rateLimitedMsg, remainingMs: 10000 }]
      })
      imageProcessorMock.processEntities.mockResolvedValue([
        { entity: '1', success: true, shouldRetry: false, avatar: validEntity.metadata.avatars[0].avatar }
      ])

      await consumer.processMessages(mainQueueMock, [validMsg, invalidMsg, rateLimitedMsg])

      expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith([invalidMsg.ReceiptHandle])
      expect(mainQueueMock.extendVisibility).toHaveBeenCalledWith(rateLimitedMsg.ReceiptHandle, 10)
      expect(imageProcessorMock.processEntities).toHaveBeenCalled()
    })

    it('should not call entity fetcher or image processor when only rate-limited messages exist', async () => {
      const msg = createTestMessage('1')
      messageValidatorMock.validateMessages.mockReturnValueOnce({
        validMessages: [],
        invalidMessages: [],
        rateLimitedMessages: [{ message: msg, remainingMs: 5000 }]
      })

      await consumer.processMessages(mainQueueMock, [msg])

      expect(mainQueueMock.extendVisibility).toHaveBeenCalledWith(msg.ReceiptHandle, 5)
      expect(entityFetcherMock.getEntitiesByIds).not.toHaveBeenCalled()
      expect(imageProcessorMock.processEntities).not.toHaveBeenCalled()
    })
  })

  describe('and processing from main queue', () => {
    describe('and entities can be extracted from messages', () => {
      beforeEach(() => {
        const completeEntity = createTestEntity('1')
        const standardizedEvent = createStandardizedEvent('1', completeEntity)

        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message, event: standardizedEvent }],
          invalidMessages: [],
          rateLimitedMessages: []
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

      it('should extend visibility for all valid messages before processing', async () => {
        await consumer.processMessages(mainQueueMock, [message])

        expect(mainQueueMock.extendVisibility).toHaveBeenCalledWith(message.ReceiptHandle, expect.any(Number))
      })

      it('should calculate visibility timeout based on entity count', async () => {
        await consumer.processMessages(mainQueueMock, [message])

        const expectedTimeout = Math.ceil(15 + 10 * 1 + 120)
        expect(mainQueueMock.extendVisibility).toHaveBeenCalledWith(message.ReceiptHandle, expectedTimeout)
      })

      it('should keep extending visibility while processing is still running', async () => {
        jest.useFakeTimers()
        let resolveProcessing!: (value: any) => void
        imageProcessorMock.processEntities.mockReturnValue(
          new Promise((resolve) => {
            resolveProcessing = resolve
          })
        )

        try {
          const processPromise = consumer.processMessages(mainQueueMock, [message])
          await jest.advanceTimersByTimeAsync(0)

          expect(imageProcessorMock.processEntities).toHaveBeenCalled()
          expect(mainQueueMock.extendVisibility).toHaveBeenCalledTimes(1)

          await jest.advanceTimersByTimeAsync(73_000)

          expect(mainQueueMock.extendVisibility).toHaveBeenCalledTimes(2)
          expect(mainQueueMock.extendVisibility).toHaveBeenLastCalledWith(
            message.ReceiptHandle,
            Math.ceil(15 + 10 + 120)
          )

          resolveProcessing([
            { entity: '1', success: true, shouldRetry: false, avatar: entity.metadata.avatars[0].avatar }
          ])
          await processPromise
        } finally {
          jest.useRealTimers()
        }
      })

      it('should not delete messages if heartbeat visibility extension fails while processing', async () => {
        jest.useFakeTimers()
        let resolveProcessing!: (value: any) => void
        mainQueueMock.extendVisibility.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('SQS error'))
        imageProcessorMock.processEntities.mockReturnValue(
          new Promise((resolve) => {
            resolveProcessing = resolve
          })
        )

        try {
          const processPromise = consumer.processMessages(mainQueueMock, [message])
          await jest.advanceTimersByTimeAsync(0)

          expect(imageProcessorMock.processEntities).toHaveBeenCalled()

          await jest.advanceTimersByTimeAsync(73_000)

          resolveProcessing([
            { entity: '1', success: true, shouldRetry: false, avatar: entity.metadata.avatars[0].avatar }
          ])
          await processPromise

          expect(mainQueueMock.deleteMessages).not.toHaveBeenCalled()
        } finally {
          jest.useRealTimers()
        }
      })
    })

    describe('and visibility extension fails', () => {
      beforeEach(() => {
        const completeEntity = createTestEntity('1')
        const standardizedEvent = createStandardizedEvent('1', completeEntity)

        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message, event: standardizedEvent }],
          invalidMessages: [],
          rateLimitedMessages: []
        })
        imageProcessorMock.processEntities.mockResolvedValue([
          { entity: '1', success: true, shouldRetry: false, avatar: completeEntity.metadata.avatars[0].avatar }
        ])
        mainQueueMock.extendVisibility.mockRejectedValue(new Error('SQS error'))
      })

      it('should leave messages in the queue and avoid unprotected processing', async () => {
        await consumer.processMessages(mainQueueMock, [message])

        expect(imageProcessorMock.processEntities).not.toHaveBeenCalled()
        expect(mainQueueMock.deleteMessages).not.toHaveBeenCalled()
      })

      it('should time out visibility extension attempts that do not settle', async () => {
        jest.useFakeTimers()
        mainQueueMock.extendVisibility.mockReturnValue(new Promise(() => {}))

        try {
          const processPromise = consumer.processMessages(mainQueueMock, [message])
          await jest.advanceTimersByTimeAsync(0)

          await jest.advanceTimersByTimeAsync(10_000)
          await processPromise

          expect(imageProcessorMock.processEntities).not.toHaveBeenCalled()
          expect(mainQueueMock.deleteMessages).not.toHaveBeenCalled()
        } finally {
          jest.useRealTimers()
        }
      })
    })

    describe('and multiple entities are processed', () => {
      let message1: Message
      let message2: Message

      beforeEach(() => {
        const entity1 = createTestEntity('1')
        const entity2 = createTestEntity('2')
        message1 = createTestMessage('1', { entity: entity1 })
        message2 = createTestMessage('2', { entity: entity2 })

        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [
            { message: message1, event: createStandardizedEvent('1', entity1) },
            { message: message2, event: createStandardizedEvent('2', entity2) }
          ],
          invalidMessages: [],
          rateLimitedMessages: []
        })
        imageProcessorMock.processEntities.mockResolvedValue([
          { entity: '1', success: true, shouldRetry: false, avatar: entity1.metadata.avatars[0].avatar },
          { entity: '2', success: true, shouldRetry: false, avatar: entity2.metadata.avatars[0].avatar }
        ])
      })

      it('should extend visibility for each message with timeout based on total entity count', async () => {
        await consumer.processMessages(mainQueueMock, [message1, message2])

        const expectedTimeout = Math.ceil(15 + 10 * 2 + 120)
        expect(mainQueueMock.extendVisibility).toHaveBeenCalledTimes(2)
        expect(mainQueueMock.extendVisibility).toHaveBeenCalledWith(message1.ReceiptHandle, expectedTimeout)
        expect(mainQueueMock.extendVisibility).toHaveBeenCalledWith(message2.ReceiptHandle, expectedTimeout)
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
          invalidMessages: [],
          rateLimitedMessages: []
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
          invalidMessages: [],
          rateLimitedMessages: []
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
          invalidMessages: [],
          rateLimitedMessages: []
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
            invalidMessages: [],
            rateLimitedMessages: []
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

      describe('and the processed entity has malformed pointers', () => {
        beforeEach(() => {
          const malformedEntity = { ...entity, pointers: 'not-an-array' as any }
          const standardizedEvent = createStandardizedEvent('1', { ...entity, metadata: {}, pointers: ['0xevent'] })

          messageValidatorMock.validateMessages.mockReturnValue({
            validMessages: [{ message, event: standardizedEvent }],
            invalidMessages: [],
            rateLimitedMessages: []
          })
          entityFetcherMock.getEntitiesByIds.mockResolvedValue([malformedEntity])
          imageProcessorMock.processEntities.mockResolvedValue([
            { entity: entity.id, success: true, shouldRetry: false, avatar: entity.metadata.avatars[0].avatar }
          ])
        })

        it('should not throw and should fall back to the event pointers', async () => {
          await consumer.processMessages(mainQueueMock, [message])

          expect(mainQueueMock.deleteMessages).toHaveBeenCalledWith([message.ReceiptHandle])
          expect(messageValidatorMock.markPointerProcessed).toHaveBeenCalledWith('0xevent', entity.timestamp)
        })
      })
    })

    describe('and processing fails with shouldRetry true', () => {
      beforeEach(() => {
        const standardizedEvent = createStandardizedEvent('1', entity)
        messageValidatorMock.validateMessages.mockReturnValue({
          validMessages: [{ message, event: standardizedEvent }],
          invalidMessages: [],
          rateLimitedMessages: []
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
          invalidMessages: [],
          rateLimitedMessages: []
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
          invalidMessages: [],
          rateLimitedMessages: []
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
            invalidMessages: [],
            rateLimitedMessages: []
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
            invalidMessages: [],
            rateLimitedMessages: []
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
            invalidMessages: [],
            rateLimitedMessages: []
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
          invalidMessages: [],
          rateLimitedMessages: []
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
          invalidMessages: [],
          rateLimitedMessages: []
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
        invalidMessages: [],
        rateLimitedMessages: []
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
        invalidMessages: [],
        rateLimitedMessages: []
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
        invalidMessages: [],
        rateLimitedMessages: []
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
