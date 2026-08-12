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
  // Mark a wallet pointer as successfully processed so subsequent messages for
  // the same wallet are suppressed within the dedup window.
  markPointerProcessed: (pointer: string) => void
}

// Default dedup window: suppress re-renders for the same wallet for this many
// seconds after a successful render. Covers the worst-case SQS visibility
// timeout and prevents redundant renders from high-frequency deployments.
const DEFAULT_POINTER_DEDUP_WINDOW_SECONDS = 60

export function createMessageValidator({ logs }: Pick<AppComponents, 'logs'>): MessageValidator {
  const logger = logs.getLogger('message-validator')

  // Tracks when each wallet pointer was last successfully processed.
  // Entries are pruned lazily on each validateMessages call.
  const recentlyProcessedPointers = new Map<string, number>()

  function pruneExpiredPointers(windowMs: number) {
    const cutoff = Date.now() - windowMs
    for (const [pointer, ts] of recentlyProcessedPointers) {
      if (ts < cutoff) recentlyProcessedPointers.delete(pointer)
    }
  }

  function markPointerProcessed(pointer: string) {
    recentlyProcessedPointers.set(pointer.toLowerCase(), Date.now())
  }

  function validateMessages(messages: Message[]): MessagesValidationResult {
    const windowMs = DEFAULT_POINTER_DEDUP_WINDOW_SECONDS * 1000
    pruneExpiredPointers(windowMs)

    const validMessages: MessagesValidationResult['validMessages'] = []
    const invalidMessages: MessagesValidationResult['invalidMessages'] = []
    // Within-batch dedup: reject if the same entityId appears more than once
    // in a single SQS poll batch.
    const processedEntityIds = new Set<string>()
    // Within-batch pointer dedup: only the first entity per pointer is accepted
    // when multiple entities for the same wallet arrive in the same batch.
    const batchPointers = new Set<string>()

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

      // Cross-batch and within-batch pointer dedup: suppress any entity whose
      // wallet pointer was rendered recently or already appears in this batch.
      // Uses the first pointer as the canonical wallet identifier.
      const pointer = (event.entity?.pointers?.[0] ?? '').toLowerCase()
      if (pointer) {
        const lastProcessed = recentlyProcessedPointers.get(pointer)
        const isRecentlySeen = lastProcessed !== undefined && Date.now() - lastProcessed < windowMs
        if (isRecentlySeen || batchPointers.has(pointer)) {
          logger.debug(`Suppressing message for recently-processed pointer ${pointer}, entity=${entityId}`)
          invalidMessages.push({ message, error: 'recently_processed_pointer' })
          continue
        }
        batchPointers.add(pointer)
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

      validMessages.push({ message, event: standardEvent })
    }

    return { validMessages, invalidMessages }
  }

  return { validateMessages, markPointerProcessed }
}
