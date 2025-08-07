import { createLogComponent } from '@well-known-components/logger'
import { createMessageValidator, MessageValidator } from '../../../src/logic/message-validator'
import { Message } from '@aws-sdk/client-sqs'
import { EntityType } from '@dcl/schemas'
import { ILoggerComponent } from '@well-known-components/interfaces'

describe('when validating messages', () => {
  let logs: ILoggerComponent
  let validator: MessageValidator

  let messages: Message[]

  beforeEach(async () => {
    logs = await createLogComponent({})
    validator = createMessageValidator({ logs })
  })

  describe('and messages are valid', () => {
    beforeEach(() => {
      messages = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity1',
              entityType: EntityType.PROFILE
            }
          })
        },
        {
          MessageId: '2',
          ReceiptHandle: 'receipt2',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity2',
              entityType: EntityType.PROFILE
            }
          })
        }
      ]
    })
    it('should validate valid messages', () => {
      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(2)
      expect(result.invalidMessages).toHaveLength(0)
    })
  })

  describe('and messages have no body', () => {
    beforeEach(() => {
      messages = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1'
        }
      ]
    })

    it('should detect messages without body', () => {
      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(0)
      expect(result.invalidMessages).toHaveLength(1)
      expect(result.invalidMessages[0].error).toBe('undefined_body')
    })
  })

  describe('and messages have invalid JSON', () => {
    beforeEach(() => {
      messages = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: 'invalid json'
        }
      ]
    })

    it('should detect invalid JSON', () => {
      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(0)
      expect(result.invalidMessages).toHaveLength(1)
      expect(result.invalidMessages[0].error).toBe('invalid_json')
    })
  })

  describe('and messages have invalid entity structure', () => {
    beforeEach(() => {
      messages = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({})
        }
      ]
    })

    it('should return an invalid_entity_type error', () => {
      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(0)
      expect(result.invalidMessages).toHaveLength(1)
      expect(result.invalidMessages[0].error).toBe('invalid_entity_type')
    })
  })

  describe('and messages have entity without entityId', () => {
    beforeEach(() => {
      messages = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              entityType: EntityType.PROFILE
            }
          })
        }
      ]
    })

    it('should return an invalid_entity_type error', () => {
      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(0)
      expect(result.invalidMessages).toHaveLength(1)
      expect(result.invalidMessages[0].error).toBe('invalid_entity_type')
    })
  })

  describe('and messages have entity with string entityId instead of object', () => {
    beforeEach(() => {
      messages = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: 'entity1',
            avatar: {}
          })
        }
      ]
    })

    it('should return an invalid_entity_type error', () => {
      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(0)
      expect(result.invalidMessages).toHaveLength(1)
      expect(result.invalidMessages[0].error).toBe('invalid_entity_type')
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
              entityId: 'entity1',
              entityType: 'not_profile'
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
              entityId: 'same_id',
              entityType: EntityType.PROFILE
            }
          })
        },
        {
          MessageId: '2',
          ReceiptHandle: 'receipt2',
          Body: JSON.stringify({
            entity: {
              entityId: 'same_id',
              entityType: EntityType.PROFILE
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

  describe('and messages have complete entity data', () => {
    it('should validate messages with complete entity metadata', () => {
      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity1',
              entityType: EntityType.PROFILE,
              version: 'v3',
              pointers: ['0xentity1'],
              entityTimestamp: 1234567890,
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
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(1)
      expect(result.invalidMessages).toHaveLength(0)

      const validMessage = result.validMessages[0]
      expect(validMessage.event.entity.id).toBe('entity1')
      expect(validMessage.event.entity.type).toBe(EntityType.PROFILE)
      expect(validMessage.event.entity.metadata.avatars).toHaveLength(1)
    })
  })
})
