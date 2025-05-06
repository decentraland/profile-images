import { createQueueComponent, QueueComponent } from '../../../src/logic/queue'
import { CatalystDeploymentEvent, EntityType, Events } from '@dcl/schemas'

describe('QueueComponent', () => {
  const mockSqsClient = {
    sendMessage: jest.fn(),
    receiveMessages: jest.fn(),
    deleteMessage: jest.fn(),
    deleteMessages: jest.fn(),
    getQueueAttributes: jest.fn()
  }
  let queue: QueueComponent

  beforeEach(async () => {
    queue = await createQueueComponent({ sqsClient: mockSqsClient })
    jest.clearAllMocks()
  })

  describe('sendMessage', () => {
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

      await queue.sendMessage('test-queue', message)

      expect(mockSqsClient.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            QueueUrl: 'test-queue',
            MessageBody: JSON.stringify(message)
          }
        })
      )
    })

    it('should handle send message errors', async () => {
      mockSqsClient.sendMessage.mockRejectedValue(new Error('Send failed'))

      await expect(queue.sendMessage('test-queue', {} as CatalystDeploymentEvent)).rejects.toThrow('Send failed')
    })
  })

  describe('receiveMessage', () => {
    it('should receive messages with default options', async () => {
      const mockMessages = [{ MessageId: '1' }, { MessageId: '2' }]
      mockSqsClient.receiveMessages.mockResolvedValue({ Messages: mockMessages })

      const messages = await queue.receiveMessage('test-queue', { maxNumberOfMessages: 2 })

      expect(messages).toEqual(mockMessages)
      expect(mockSqsClient.receiveMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            QueueUrl: 'test-queue',
            MaxNumberOfMessages: 2,
            VisibilityTimeout: 60, // default value
            WaitTimeSeconds: 20 // default value
          }
        })
      )
    })

    it('should receive messages with custom options', async () => {
      mockSqsClient.receiveMessages.mockResolvedValue({ Messages: [] })

      await queue.receiveMessage('test-queue', {
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

    it('should handle undefined Messages in response', async () => {
      mockSqsClient.receiveMessages.mockResolvedValue({})

      const messages = await queue.receiveMessage('test-queue', { maxNumberOfMessages: 1 })

      expect(messages).toEqual([])
    })

    it('should handle receive message errors', async () => {
      mockSqsClient.receiveMessages.mockRejectedValue(new Error('Receive failed'))

      await expect(queue.receiveMessage('test-queue', { maxNumberOfMessages: 1 })).rejects.toThrow('Receive failed')
    })
  })

  describe('deleteMessage', () => {
    it('should delete message', async () => {
      await queue.deleteMessage('test-queue', 'receipt-handle')

      expect(mockSqsClient.deleteMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            QueueUrl: 'test-queue',
            ReceiptHandle: 'receipt-handle'
          }
        })
      )
    })

    it('should handle delete message errors', async () => {
      mockSqsClient.deleteMessage.mockRejectedValue(new Error('Delete failed'))

      await expect(queue.deleteMessage('test-queue', 'receipt-handle')).rejects.toThrow('Delete failed')
    })
  })

  describe('deleteMessages', () => {
    it('should delete messages', async () => {
      await queue.deleteMessages('test-queue', ['receipt-handle-1', 'receipt-handle-2'])

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

  describe('getStatus', () => {
    it('should get queue status with all attributes', async () => {
      const mockAttributes = {
        ApproximateNumberOfMessages: '1',
        ApproximateNumberOfMessagesNotVisible: '2',
        ApproximateNumberOfMessagesDelayed: '3'
      }
      mockSqsClient.getQueueAttributes.mockResolvedValue({ Attributes: mockAttributes })

      const status = await queue.getStatus('test-queue')

      expect(status).toEqual(mockAttributes)
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

    it('should handle missing attributes in response', async () => {
      mockSqsClient.getQueueAttributes.mockResolvedValue({ Attributes: {} })

      const status = await queue.getStatus('test-queue')

      expect(status).toEqual({
        ApproximateNumberOfMessages: '0',
        ApproximateNumberOfMessagesNotVisible: '0',
        ApproximateNumberOfMessagesDelayed: '0'
      })
    })

    it('should handle undefined Attributes in response', async () => {
      mockSqsClient.getQueueAttributes.mockResolvedValue({})

      const status = await queue.getStatus('test-queue')

      expect(status).toEqual({
        ApproximateNumberOfMessages: '0',
        ApproximateNumberOfMessagesNotVisible: '0',
        ApproximateNumberOfMessagesDelayed: '0'
      })
    })

    it('should handle get status errors', async () => {
      mockSqsClient.getQueueAttributes.mockRejectedValue(new Error('Status failed'))

      await expect(queue.getStatus('test-queue')).rejects.toThrow('Status failed')
    })
  })
})
