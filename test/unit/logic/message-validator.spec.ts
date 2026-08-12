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

    it('should not throw when the body parses to null', () => {
      const result = validator.validateMessages([
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: 'null'
        }
      ])

      expect(result.validMessages).toHaveLength(0)
      expect(result.invalidMessages).toHaveLength(1)
      expect(result.invalidMessages[0].error).toBe('invalid_entity_type')
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
    it('should leave duplicate entities in the queue instead of deleting them', () => {
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
      expect(result.invalidMessages).toHaveLength(0)
    })

    it('should keep the newest duplicate entity message', () => {
      const result = validator.validateMessages([
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              entityId: 'same_id',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet'],
              timestamp: 1000
            }
          })
        },
        {
          MessageId: '2',
          ReceiptHandle: 'receipt2',
          Body: JSON.stringify({
            entity: {
              entityId: 'same_id',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet'],
              timestamp: 2000
            }
          })
        }
      ])

      expect(result.validMessages).toHaveLength(1)
      expect(result.validMessages[0].message.MessageId).toBe('2')
      expect(result.invalidMessages).toHaveLength(0)
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

  describe('and messages have malformed pointers', () => {
    it('should not throw when pointers contain non-string values', () => {
      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity1',
              entityType: EntityType.PROFILE,
              pointers: [123]
            }
          })
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(1)
      expect(result.invalidMessages).toHaveLength(0)
    })

    it('should not throw when pointers is not an array', () => {
      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity1',
              entityType: EntityType.PROFILE,
              pointers: 'not-an-array'
            }
          })
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(1)
      expect(result.invalidMessages).toHaveLength(0)
    })
  })

  describe('and multiple messages share the same pointer in a batch', () => {
    it('should keep the newest message and leave the older one in SQS for redelivery', () => {
      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity_old',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet'],
              timestamp: 1000
            }
          })
        },
        {
          MessageId: '2',
          ReceiptHandle: 'receipt2',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity_new',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet'],
              timestamp: 2000
            }
          })
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(1)
      expect(result.validMessages[0].event.entity.id).toBe('entity_new')
      expect(result.invalidMessages).toHaveLength(0)
    })

    it('should keep the first message when it is newer than subsequent ones', () => {
      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity_new',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet'],
              timestamp: 2000
            }
          })
        },
        {
          MessageId: '2',
          ReceiptHandle: 'receipt2',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity_old',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet'],
              timestamp: 1000
            }
          })
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(1)
      expect(result.validMessages[0].event.entity.id).toBe('entity_new')
      expect(result.invalidMessages).toHaveLength(0)
    })

    it('should keep both messages when timestamps are equal', () => {
      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity_a',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet'],
              timestamp: 1000
            }
          })
        },
        {
          MessageId: '2',
          ReceiptHandle: 'receipt2',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity_b',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet'],
              timestamp: 1000
            }
          })
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(2)
      expect(result.invalidMessages).toHaveLength(0)
    })

    it('should keep both messages when timestamps are missing', () => {
      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity_a',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet']
            }
          })
        },
        {
          MessageId: '2',
          ReceiptHandle: 'receipt2',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity_b',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet']
            }
          })
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(2)
      expect(result.invalidMessages).toHaveLength(0)
    })

    it('should handle pointer case-insensitively', () => {
      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity_old',
              entityType: EntityType.PROFILE,
              pointers: ['0xWALLET'],
              timestamp: 1000
            }
          })
        },
        {
          MessageId: '2',
          ReceiptHandle: 'receipt2',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity_new',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet'],
              timestamp: 2000
            }
          })
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(1)
      expect(result.validMessages[0].event.entity.id).toBe('entity_new')
    })

    it('should keep only the newest message when earlier same-pointer messages have equal timestamps', () => {
      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity_stale_a',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet'],
              timestamp: 1000
            }
          })
        },
        {
          MessageId: '2',
          ReceiptHandle: 'receipt2',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity_stale_b',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet'],
              timestamp: 1000
            }
          })
        },
        {
          MessageId: '3',
          ReceiptHandle: 'receipt3',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity_new',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet'],
              timestamp: 2000
            }
          })
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(1)
      expect(result.validMessages[0].event.entity.id).toBe('entity_new')
      expect(result.invalidMessages).toHaveLength(0)
    })
  })

  describe('and a pointer was recently processed cross-batch', () => {
    it('should suppress stale messages with older entity timestamp', () => {
      validator.markPointerProcessed('0xwallet', 2000)

      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity1',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet'],
              timestamp: 1000
            }
          })
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(0)
      expect(result.invalidMessages).toHaveLength(1)
      expect(result.invalidMessages[0].error).toBe('recently_processed_pointer')
    })

    it('should allow newer messages with higher entity timestamp', () => {
      validator.markPointerProcessed('0xwallet', 1000)

      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity1',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet'],
              timestamp: 2000
            }
          })
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(1)
      expect(result.invalidMessages).toHaveLength(0)
    })

    it('should allow messages when incoming entity timestamp is missing even if event timestamp exists', () => {
      validator.markPointerProcessed('0xwallet', 2000)

      const messages: Message[] = [
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            timestamp: 3000,
            entity: {
              entityId: 'entity1',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet']
            }
          })
        }
      ]

      const result = validator.validateMessages(messages)
      expect(result.validMessages).toHaveLength(1)
      expect(result.invalidMessages).toHaveLength(0)
    })

    it('should keep stale messages suppressed for the full SQS visibility timeout window', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-12T00:00:00.000Z'))
      try {
        validator.markPointerProcessed('0xwallet', 2000)
        jest.advanceTimersByTime(299_000)

        const result = validator.validateMessages([
          {
            MessageId: '1',
            ReceiptHandle: 'receipt1',
            Body: JSON.stringify({
              entity: {
                entityId: 'entity1',
                entityType: EntityType.PROFILE,
                pointers: ['0xwallet'],
                timestamp: 1000
              }
            })
          }
        ])

        expect(result.validMessages).toHaveLength(0)
        expect(result.invalidMessages).toHaveLength(1)
        expect(result.invalidMessages[0].error).toBe('recently_processed_pointer')
      } finally {
        jest.useRealTimers()
      }
    })

    it('should not regress the cached processed timestamp when an older render finishes later', () => {
      validator.markPointerProcessed('0xwallet', 2000)
      validator.markPointerProcessed('0xwallet', 1000)

      const result = validator.validateMessages([
        {
          MessageId: '1',
          ReceiptHandle: 'receipt1',
          Body: JSON.stringify({
            entity: {
              entityId: 'entity1',
              entityType: EntityType.PROFILE,
              pointers: ['0xwallet'],
              timestamp: 1500
            }
          })
        }
      ])

      expect(result.validMessages).toHaveLength(0)
      expect(result.invalidMessages).toHaveLength(1)
      expect(result.invalidMessages[0].error).toBe('recently_processed_pointer')
    })
  })
})
