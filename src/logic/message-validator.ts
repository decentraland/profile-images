import { Message } from '@aws-sdk/client-sqs'
import { CatalystDeploymentEvent, EntityType } from '@dcl/schemas'
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

      let event: CatalystDeploymentEvent
      try {
        event = JSON.parse(message.Body)
      } catch {
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} has invalid JSON`
        )
        invalidMessages.push({ message, error: 'invalid_json' })
        continue
      }

      if (!event.entity || event.entity.type !== EntityType.PROFILE) {
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with invalid Body: ${message.Body}`
        )
        invalidMessages.push({ message, error: 'invalid_entity_type' })
        continue
      }

      if (processedEntityIds.has(event.entity.id)) {
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with duplicate entity: ${event.entity.id}`
        )
        invalidMessages.push({ message, error: 'duplicate_entity' })
        continue
      }

      processedEntityIds.add(event.entity.id)
      validMessages.push({ message, event })
    }

    return { validMessages, invalidMessages }
  }

  return { validateMessages }
}
