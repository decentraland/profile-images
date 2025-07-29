import { createLogComponent } from '@well-known-components/logger'
import { createMessageValidator, MessageValidator } from '../../../src/logic/message-validator'
import { Message } from '@aws-sdk/client-sqs'
import { EntityType } from '@dcl/schemas'
import { ILoggerComponent } from '@well-known-components/interfaces'

describe('when validating messages', () => {
  let logs: ILoggerComponent
  let validator: MessageValidator

  beforeEach(async () => {
    logs = await createLogComponent({})
    validator = createMessageValidator({ logs })
  })

  describe('and messages are valid', () => {
    it('should validate valid messages', () => {
      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              id: 'entity1',
              type: EntityType.PROFILE
            }
          })
        },
        {
          MessageId: '2',
          ReceiptHandle: 'receipt2',
          Body: JSON.stringify({
            entity: {
              id: 'entity2',
              type: EntityType.PROFILE
            }
          })
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(2)
      expect(result.invalidMessages).toHaveLength(0)
    })
  })

  describe('and messages have no body', () => {
    it('should detect messages without body', () => {
      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1'
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(0)
      expect(result.invalidMessages).toHaveLength(1)
      expect(result.invalidMessages[0].error).toBe('undefined_body')
    })
  })

  describe('and messages have invalid JSON', () => {
    it('should detect invalid JSON', () => {
      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: 'invalid json'
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(0)
      expect(result.invalidMessages).toHaveLength(1)
      expect(result.invalidMessages[0].error).toBe('invalid_json')
    })
  })

  describe('and messages have invalid entity type', () => {
    it('should detect invalid entity type', () => {
      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              id: 'entity1',
              type: 'not_profile'
            }
          })
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(0)
      expect(result.invalidMessages).toHaveLength(1)
      expect(result.invalidMessages[0].error).toBe('invalid_entity_type')
    })
  })

  describe('and messages have duplicate entities', () => {
    it('should detect duplicate entities', () => {
      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              id: 'same_id',
              type: EntityType.PROFILE
            }
          })
        },
        {
          MessageId: '2',
          ReceiptHandle: 'receipt2',
          Body: JSON.stringify({
            entity: {
              id: 'same_id',
              type: EntityType.PROFILE
            }
          })
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(1)
      expect(result.invalidMessages).toHaveLength(1)
      expect(result.invalidMessages[0].error).toBe('duplicate_entity')
    })
  })
})
