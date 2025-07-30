import { Message } from '@aws-sdk/client-sqs'
import { CatalystDeploymentEvent, EntityType, Events } from '@dcl/schemas'
import { AppComponents } from '../types'

export type ValidationError = 'undefined_body' | 'invalid_json' | 'invalid_entity_type' | 'duplicate_entity'

export type MessagesValidationResult = {
  validMessages: Array<{
    message: Message
    event: CatalystDeploymentEvent
  }>
  invalidMessages: Array<{
    message: Message
    error: ValidationError
  }>
}

export type MessageValidator = {
  validateMessages: (messages: Message[]) => MessagesValidationResult
}

export function createMessageValidator({ logs }: Pick<AppComponents, 'logs'>): MessageValidator {
  const logger = logs.getLogger('message-validator')

  function validateMessages(messages: Message[]): MessagesValidationResult {
    const validMessages: MessagesValidationResult['validMessages'] = []
    const invalidMessages: MessagesValidationResult['invalidMessages'] = []
    const processedEntityIds = new Set<string>()

    for (const message of messages) {
      if (!message.Body) {
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with undefined Body`
        )
        invalidMessages.push({ message, error: 'undefined_body' })
        continue
      }

      let event: any
      try {
        event = JSON.parse(message.Body)
      } catch {
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} has invalid JSON`
        )
        invalidMessages.push({ message, error: 'invalid_json' })
        continue
      }

      let entityId: string
      let entityType: string

      if (event.entity && typeof event.entity === 'object' && event.entity.entityId) {
        entityId = event.entity.entityId
        entityType = event.entity.entityType
      } else if (event.entity && typeof event.entity === 'string' && event.avatar) {
        entityId = event.entity
        entityType = 'profile'
      } else {
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with invalid Body: ${message.Body}`
        )
        invalidMessages.push({ message, error: 'invalid_entity_type' })
        continue
      }

      if (entityType !== 'profile' && entityType !== EntityType.PROFILE) {
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with invalid entity type: ${entityType}`
        )
        invalidMessages.push({ message, error: 'invalid_entity_type' })
        continue
      }

      if (processedEntityIds.has(entityId)) {
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with duplicate entity: ${entityId}`
        )
        invalidMessages.push({ message, error: 'duplicate_entity' })
        continue
      }

      processedEntityIds.add(entityId)

      const standardEvent: CatalystDeploymentEvent = {
        type: Events.Type.CATALYST_DEPLOYMENT,
        subType: Events.SubType.CatalystDeployment.PROFILE,
        key: 'entity',
        timestamp: event.timestamp || Date.now(),
        entity: {
          id: entityId,
          type: EntityType.PROFILE,
          version: event.entity?.version || 'v3',
          pointers: event.entity?.pointers || [entityId],
          timestamp: event.entity?.timestamp || event.entity?.entityTimestamp || Date.now(),
          content: event.entity?.content || []
        },
        authChain: event.entity?.authChain || []
      }

      validMessages.push({ message, event: standardEvent })
    }

    return { validMessages, invalidMessages }
  }

  return { validateMessages }
}
