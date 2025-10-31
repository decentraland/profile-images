import { createSQSClient, SqsClient } from '../../../src/adapters/sqs'
import {
  DeleteMessageBatchCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand
} from '@aws-sdk/client-sqs'

// Mock the AWS SDK
const mockSend = jest.fn()
const mockSQSClient = {
  send: mockSend
}

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn(() => mockSQSClient),
  SendMessageCommand: jest.fn((params) => ({ ...params, type: 'SendMessageCommand' })),
  GetQueueAttributesCommand: jest.fn((params) => ({ ...params, type: 'GetQueueAttributesCommand' })),
  ReceiveMessageCommand: jest.fn((params) => ({ ...params, type: 'ReceiveMessageCommand' })),
  DeleteMessageCommand: jest.fn((params) => ({ ...params, type: 'DeleteMessageCommand' })),
  DeleteMessageBatchCommand: jest.fn((params) => ({ ...params, type: 'DeleteMessageBatchCommand' }))
}))

describe('when using SQS client', () => {
  let sqsClient: SqsClient

  beforeEach(async () => {
    sqsClient = await createSQSClient({
      awsConfig: { region: 'us-east-1' }
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and sending messages', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({
        MessageId: 'test-message-id',
        MD5OfMessageBody: 'test-md5'
      })
    })

    it('should send message successfully', async () => {
      const sendMessageCommand = new SendMessageCommand({
        QueueUrl: 'test-queue-url',
        MessageBody: 'test-message'
      })

      const result = await sqsClient.sendMessage(sendMessageCommand)

      expect(mockSend).toHaveBeenCalledWith(sendMessageCommand)
      expect(result).toEqual({
        MessageId: 'test-message-id',
        MD5OfMessageBody: 'test-md5'
      })
    })
  })

  describe('and getting queue attributes', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({
        Attributes: {
          ApproximateNumberOfMessages: '10',
          ApproximateNumberOfMessagesNotVisible: '5'
        }
      })
    })

    it('should get queue attributes successfully', async () => {
      const getQueueAttributesCommand = new GetQueueAttributesCommand({
        QueueUrl: 'test-queue-url',
        AttributeNames: ['All']
      })

      const result = await sqsClient.getQueueAttributes(getQueueAttributesCommand)

      expect(mockSend).toHaveBeenCalledWith(getQueueAttributesCommand)
      expect(result).toEqual({
        Attributes: {
          ApproximateNumberOfMessages: '10',
          ApproximateNumberOfMessagesNotVisible: '5'
        }
      })
    })
  })

  describe('and receiving messages', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({
        Messages: [
          {
            MessageId: 'msg-1',
            ReceiptHandle: 'receipt-1',
            Body: 'test-message-1'
          },
          {
            MessageId: 'msg-2',
            ReceiptHandle: 'receipt-2',
            Body: 'test-message-2'
          }
        ]
      })
    })

    it('should receive messages successfully', async () => {
      const receiveMessageCommand = new ReceiveMessageCommand({
        QueueUrl: 'test-queue-url',
        MaxNumberOfMessages: 10
      })

      const result = await sqsClient.receiveMessages(receiveMessageCommand)

      expect(mockSend).toHaveBeenCalledWith(receiveMessageCommand)
      expect(result.Messages).toHaveLength(2)
      expect(result.Messages?.[0]).toEqual({
        MessageId: 'msg-1',
        ReceiptHandle: 'receipt-1',
        Body: 'test-message-1'
      })
    })
  })

  describe('and deleting single message', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({})
    })

    it('should delete message successfully', async () => {
      const deleteMessageCommand = new DeleteMessageCommand({
        QueueUrl: 'test-queue-url',
        ReceiptHandle: 'receipt-1'
      })

      const result = await sqsClient.deleteMessage(deleteMessageCommand)

      expect(mockSend).toHaveBeenCalledWith(deleteMessageCommand)
      expect(result).toEqual({})
    })
  })

  describe('and deleting multiple messages', () => {
    beforeEach(() => {
      mockSend.mockResolvedValue({
        Successful: [{ Id: 'msg-1' }, { Id: 'msg-2' }],
        Failed: []
      })
    })

    it('should delete messages successfully', async () => {
      const deleteMessagesCommand = new DeleteMessageBatchCommand({
        QueueUrl: 'test-queue-url',
        Entries: [
          { Id: 'msg-1', ReceiptHandle: 'receipt-1' },
          { Id: 'msg-2', ReceiptHandle: 'receipt-2' }
        ]
      })

      const result = await sqsClient.deleteMessages(deleteMessagesCommand)

      expect(mockSend).toHaveBeenCalledWith(deleteMessagesCommand)
      expect(result.Successful).toHaveLength(2)
      expect(result.Failed).toHaveLength(0)
    })
  })

  describe('and AWS client throws error', () => {
    beforeEach(() => {
      mockSend.mockRejectedValue(new Error('AWS SQS error'))
    })

    it('should propagate the error', async () => {
      const sendMessageCommand = new SendMessageCommand({
        QueueUrl: 'test-queue-url',
        MessageBody: 'test-message'
      })

      await expect(sqsClient.sendMessage(sendMessageCommand)).rejects.toThrow('AWS SQS error')
      expect(mockSend).toHaveBeenCalledWith(sendMessageCommand)
    })
  })
})
