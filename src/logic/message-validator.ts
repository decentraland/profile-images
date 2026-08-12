import { Message } from '@aws-sdk/client-sqs'
import { CatalystDeploymentEvent, EntityType, Events } from '@dcl/schemas'
import { AppComponents } from '../types'

export type ValidationError =
  | 'undefined_body'
  | 'invalid_json'
  | 'invalid_entity_type'
  | 'duplicate_entity'
  | 'recently_processed_pointer'

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
  markPointerProcessed: (pointer: string, entityTimestamp: number) => void
}

const DEFAULT_POINTER_DEDUP_WINDOW_SECONDS = 60

export function createMessageValidator({ logs }: Pick<AppComponents, 'logs'>): MessageValidator {
  const logger = logs.getLogger('message-validator')

  const recentlyProcessedPointers = new Map<string, { entityTimestamp: number; processedAt: number }>()

  function pruneExpiredPointers(windowMs: number) {
    const cutoff = Date.now() - windowMs
    for (const [pointer, entry] of recentlyProcessedPointers) {
      if (entry.processedAt < cutoff) recentlyProcessedPointers.delete(pointer)
    }
  }

  function markPointerProcessed(pointer: string, entityTimestamp: number) {
    recentlyProcessedPointers.set(pointer.toLowerCase(), { entityTimestamp, processedAt: Date.now() })
  }

  function validateMessages(messages: Message[]): MessagesValidationResult {
    const windowMs = DEFAULT_POINTER_DEDUP_WINDOW_SECONDS * 1000
    pruneExpiredPointers(windowMs)

    const validMessages: MessagesValidationResult['validMessages'] = []
    const invalidMessages: MessagesValidationResult['invalidMessages'] = []
    const processedEntityIds = new Set<string>()
    // Maps pointer → index in validMessages so we can replace older entries
    // with newer ones when the same wallet appears multiple times in a batch.
    const batchPointerIndex = new Map<string, number>()

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

      if (!event.entity || typeof event.entity !== 'object' || !event.entity.entityId) {
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with invalid Body: ${message.Body}`
        )
        invalidMessages.push({ message, error: 'invalid_entity_type' })
        continue
      }

      const { entityId, entityType } = event.entity

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
        timestamp: event.timestamp,
        entity: {
          id: entityId,
          type: EntityType.PROFILE,
          version: event.entity?.version || 'v3',
          pointers: event.entity?.pointers,
          timestamp: event.entity?.timestamp || event.entity?.entityTimestamp,
          content: event.entity?.content || [],
          metadata: event.entity?.metadata
        },
        authChain: event.entity?.authChain || []
      }

      const rawPointers = event.entity?.pointers
      const rawPointer = Array.isArray(rawPointers) ? rawPointers[0] : undefined
      const pointer = typeof rawPointer === 'string' ? rawPointer.toLowerCase() : ''

      if (pointer) {
        const lastProcessed = recentlyProcessedPointers.get(pointer)
        if (lastProcessed !== undefined) {
          const incomingTs = standardEvent.entity.timestamp ?? standardEvent.timestamp ?? 0
          if (incomingTs > 0 && incomingTs <= lastProcessed.entityTimestamp) {
            logger.debug(`Suppressing stale message for pointer ${pointer}, entity=${entityId}`)
            invalidMessages.push({ message, error: 'recently_processed_pointer' })
            continue
          }
        }

        const existingIndex = batchPointerIndex.get(pointer)
        if (existingIndex !== undefined) {
          const existing = validMessages[existingIndex]
          const existingTs = existing.event.entity.timestamp ?? existing.event.timestamp ?? 0
          const newTs = standardEvent.entity.timestamp ?? standardEvent.timestamp ?? 0
          if (newTs > 0 && existingTs > 0 && newTs !== existingTs) {
            if (newTs > existingTs) {
              validMessages[existingIndex] = { message, event: standardEvent }
            }
            continue
          }
        }

        batchPointerIndex.set(pointer, validMessages.length)
      }

      validMessages.push({ message, event: standardEvent })
    }

    return { validMessages, invalidMessages }
  }

  return { validateMessages, markPointerProcessed }
}
