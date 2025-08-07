import { createQueueComponent, QueueComponent } from '../../../src/logic/queue'
import { CatalystDeploymentEvent, EntityType, Events } from '@dcl/schemas'

describe('when using queue component', () => {
  const mockSqsClient = {
    sendMessage: jest.fn(),
    receiveMessages: jest.fn(),
    deleteMessage: jest.fn(),
    deleteMessages: jest.fn(),
    getQueueAttributes: jest.fn()
  }
  let queue: QueueComponent

  beforeEach(async () => {
    queue = await createQueueComponent({ sqsClient: mockSqsClient }, 'test-queue')
    jest.clearAllMocks()
  })

  describe('and sending messages', () => {
    describe('and sending succeeds', () => {
      it('should send message', async () => {
        const message: CatalystDeploymentEvent = {
          type: Events.Type.CATALYST_DEPLOYMENT,
          subType: Events.SubType.CatalystDeployment.PROFILE,
          key: 'entity',
          timestamp: 1234,
          entity: {
            id: 'test',
            type: EntityType.PROFILE,
            version: '1',
            pointers: [],
            timestamp: 1234,
            content: []
          },
          authChain: []
        }

        await queue.sendMessage(message)

        expect(mockSqsClient.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            input: {
              QueueUrl: 'test-queue',
              MessageBody: JSON.stringify(message)
            }
          })
        )
      })
    })

    describe('and sending fails', () => {
      beforeEach(() => {
        mockSqsClient.sendMessage.mockRejectedValue(new Error('Send failed'))
      })

      it('should handle send message errors', async () => {
        await expect(queue.sendMessage({} as CatalystDeploymentEvent)).rejects.toThrow('Send failed')
      })
    })
  })

  describe('and receiving messages', () => {
    describe('and using default options', () => {
      beforeEach(() => {
        const mockMessages = [{ MessageId: '1' }, { MessageId: '2' }]
        mockSqsClient.receiveMessages.mockResolvedValue({ Messages: mockMessages })
      })

      it('should receive messages with default options', async () => {
        const messages = await queue.receiveMessage({ maxNumberOfMessages: 2 })

        expect(messages).toEqual([{ MessageId: '1' }, { MessageId: '2' }])
        expect(mockSqsClient.receiveMessages).toHaveBeenCalledWith(
          expect.objectContaining({
            input: {
              QueueUrl: 'test-queue',
              MaxNumberOfMessages: 2,
              VisibilityTimeout: 60,
              WaitTimeSeconds: 20
            }
          })
        )
      })
    })

    describe('and using custom options', () => {
      beforeEach(() => {
        mockSqsClient.receiveMessages.mockResolvedValue({ Messages: [] })
      })

      it('should receive messages with custom options', async () => {
        await queue.receiveMessage({
          maxNumberOfMessages: 5,
          visibilityTimeout: 30,
          waitTimeSeconds: 10
        })

        expect(mockSqsClient.receiveMessages).toHaveBeenCalledWith(
          expect.objectContaining({
            input: {
              QueueUrl: 'test-queue',
              MaxNumberOfMessages: 5,
              VisibilityTimeout: 30,
              WaitTimeSeconds: 10
            }
          })
        )
      })
    })

    describe('and response has undefined Messages', () => {
      beforeEach(() => {
        mockSqsClient.receiveMessages.mockResolvedValue({})
      })

      it('should handle undefined Messages in response', async () => {
        const messages = await queue.receiveMessage({ maxNumberOfMessages: 1 })

        expect(messages).toEqual([])
      })
    })

    describe('and receiving fails', () => {
      beforeEach(() => {
        mockSqsClient.receiveMessages.mockRejectedValue(new Error('Receive failed'))
      })

      it('should handle receive message errors', async () => {
        await expect(queue.receiveMessage({ maxNumberOfMessages: 1 })).rejects.toThrow('Receive failed')
      })
    })
  })

  describe('and deleting messages', () => {
    describe('and deleting single message', () => {
      it('should delete message', async () => {
        await queue.deleteMessage('receipt-handle')

        expect(mockSqsClient.deleteMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            input: {
              QueueUrl: 'test-queue',
              ReceiptHandle: 'receipt-handle'
            }
          })
        )
      })
    })

    describe('and deleting single message fails', () => {
      beforeEach(() => {
        mockSqsClient.deleteMessage.mockRejectedValue(new Error('Delete failed'))
      })

      it('should handle delete message errors', async () => {
        await expect(queue.deleteMessage('receipt-handle')).rejects.toThrow('Delete failed')
      })
    })

    describe('and deleting multiple messages', () => {
      it('should delete messages', async () => {
        await queue.deleteMessages(['receipt-handle-1', 'receipt-handle-2'])

        expect(mockSqsClient.deleteMessages).toHaveBeenCalledWith(
          expect.objectContaining({
            input: {
              QueueUrl: 'test-queue',
              Entries: [
                { Id: 'msg_0', ReceiptHandle: 'receipt-handle-1' },
                { Id: 'msg_1', ReceiptHandle: 'receipt-handle-2' }
              ]
            }
          })
        )
      })
    })
  })

  describe('and getting queue status', () => {
    describe('and all attributes are present', () => {
      beforeEach(() => {
        const mockAttributes = {
          ApproximateNumberOfMessages: '1',
          ApproximateNumberOfMessagesNotVisible: '2',
          ApproximateNumberOfMessagesDelayed: '3'
        }
        mockSqsClient.getQueueAttributes.mockResolvedValue({ Attributes: mockAttributes })
      })

      it('should get queue status with all attributes', async () => {
        const status = await queue.getStatus()

        expect(status).toEqual({
          ApproximateNumberOfMessages: '1',
          ApproximateNumberOfMessagesNotVisible: '2',
          ApproximateNumberOfMessagesDelayed: '3'
        })
        expect(mockSqsClient.getQueueAttributes).toHaveBeenCalledWith(
          expect.objectContaining({
            input: {
              QueueUrl: 'test-queue',
              AttributeNames: [
                'ApproximateNumberOfMessages',
                'ApproximateNumberOfMessagesNotVisible',
                'ApproximateNumberOfMessagesDelayed'
              ]
            }
          })
        )
      })
    })

    describe('and attributes are missing', () => {
      beforeEach(() => {
        mockSqsClient.getQueueAttributes.mockResolvedValue({ Attributes: {} })
      })

      it('should handle missing attributes in response', async () => {
        const status = await queue.getStatus()

        expect(status).toEqual({
          ApproximateNumberOfMessages: '0',
          ApproximateNumberOfMessagesNotVisible: '0',
          ApproximateNumberOfMessagesDelayed: '0'
        })
      })
    })

    describe('and Attributes is undefined', () => {
      beforeEach(() => {
        mockSqsClient.getQueueAttributes.mockResolvedValue({})
      })

      it('should handle undefined Attributes in response', async () => {
        const status = await queue.getStatus()

        expect(status).toEqual({
          ApproximateNumberOfMessages: '0',
          ApproximateNumberOfMessagesNotVisible: '0',
          ApproximateNumberOfMessagesDelayed: '0'
        })
      })
    })

    describe('and getting status fails', () => {
      beforeEach(() => {
        mockSqsClient.getQueueAttributes.mockRejectedValue(new Error('Status failed'))
      })

      it('should handle get status errors', async () => {
        await expect(queue.getStatus()).rejects.toThrow('Status failed')
      })
    })
  })
})
