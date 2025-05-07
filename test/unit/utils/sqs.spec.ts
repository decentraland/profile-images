import { Message } from '@aws-sdk/client-sqs'
import { getReceiveCount } from '../../../src/utils/sqs'

describe('SQS Utils', () => {
  describe('getReceiveCount', () => {
    it('should return the parsed ApproximateReceiveCount from message attributes', () => {
      const message: Message = {
        MessageId: '123',
        ReceiptHandle: 'receipt-123',
        Body: 'test',
        Attributes: {
          ApproximateReceiveCount: '5'
        }
      }

      expect(getReceiveCount(message)).toBe(5)
    })

    it('should return 0 when ApproximateReceiveCount is not present', () => {
      const message: Message = {
        MessageId: '123',
        ReceiptHandle: 'receipt-123',
        Body: 'test',
        Attributes: {}
      }

      expect(getReceiveCount(message)).toBe(0)
    })

    it('should return 0 when Attributes is not present', () => {
      const message: Message = {
        MessageId: '123',
        ReceiptHandle: 'receipt-123',
        Body: 'test'
      }

      expect(getReceiveCount(message)).toBe(0)
    })
  })
})
