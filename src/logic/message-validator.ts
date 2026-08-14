import { Message } from '@aws-sdk/client-sqs'
import { CatalystDeploymentEvent, EntityType, Events } from '@dcl/schemas'
import { AppComponents } from '../types'

export type ValidationError = 'undefined_body' | 'invalid_json' | 'invalid_entity_type' | 'recently_processed_pointer'

export type MessagesValidationResult = {
  validMessages: Array<{
    message: Message
    event: CatalystDeploymentEvent
  }>
  invalidMessages: Array<{
    message: Message
    error: ValidationError
  }>
  rateLimitedMessages: Array<{
    message: Message
    remainingMs: number
  }>
}

export type MessageValidator = {
  validateMessages: (messages: Message[]) => MessagesValidationResult
  markPointerProcessed: (pointer: string, entityTimestamp: number) => void
}

export type RateLimitConfig = {
  pointerDedupWindowSeconds: number
  pointerRateLimitSeconds: number
}

export function createMessageValidator(
  { logs, metrics }: Pick<AppComponents, 'logs' | 'metrics'>,
  rateLimitConfig: RateLimitConfig
): MessageValidator {
  const logger = logs.getLogger('message-validator')
  const { pointerDedupWindowSeconds, pointerRateLimitSeconds } = rateLimitConfig

  const recentlyProcessedPointers = new Map<string, { entityTimestamp: number; processedAt: number }>()

  function pruneExpiredPointers(windowMs: number) {
    const cutoff = Date.now() - windowMs
    for (const [pointer, entry] of recentlyProcessedPointers) {
      if (entry.processedAt < cutoff) recentlyProcessedPointers.delete(pointer)
    }
  }

  function markPointerProcessed(pointer: string, entityTimestamp: number) {
    if (entityTimestamp <= 0) return

    const normalizedPointer = pointer.toLowerCase()
    const existing = recentlyProcessedPointers.get(normalizedPointer)
    const timestamp = Math.max(entityTimestamp, existing?.entityTimestamp ?? 0)

    recentlyProcessedPointers.set(normalizedPointer, { entityTimestamp: timestamp, processedAt: Date.now() })
  }

  function getEntityTimestamp(entity: any): number {
    const timestamp = entity?.timestamp ?? entity?.entityTimestamp
    return typeof timestamp === 'number' ? timestamp : 0
  }

  function validateMessages(messages: Message[]): MessagesValidationResult {
    const windowMs = Math.max(pointerDedupWindowSeconds, pointerRateLimitSeconds) * 1000
    pruneExpiredPointers(windowMs)

    const validMessages: MessagesValidationResult['validMessages'] = []
    const invalidMessages: MessagesValidationResult['invalidMessages'] = []
    const rateLimitedMessages: MessagesValidationResult['rateLimitedMessages'] = []
    const candidateMessages: Array<{
      message: Message
      event: CatalystDeploymentEvent
      pointer: string
      timestamp: number
    }> = []

    for (const message of messages) {
      if (!message.Body) {
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with undefined Body`
        )
        invalidMessages.push({ message, error: 'undefined_body' })
        metrics.increment('message_validation_result_total', { result: 'undefined_body' })
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
        metrics.increment('message_validation_result_total', { result: 'invalid_json' })
        continue
      }

      if (
        !event ||
        typeof event !== 'object' ||
        !event.entity ||
        typeof event.entity !== 'object' ||
        !event.entity.entityId
      ) {
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with invalid Body: ${message.Body}`
        )
        invalidMessages.push({ message, error: 'invalid_entity_type' })
        metrics.increment('message_validation_result_total', { result: 'invalid_entity_type' })
        continue
      }

      const { entityId, entityType } = event.entity

      if (entityType !== 'profile' && entityType !== EntityType.PROFILE) {
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with invalid entity type: ${entityType}`
        )
        invalidMessages.push({ message, error: 'invalid_entity_type' })
        metrics.increment('message_validation_result_total', { result: 'invalid_entity_type' })
        continue
      }

      const entityTimestamp = getEntityTimestamp(event.entity)

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
          timestamp: entityTimestamp,
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
          if (entityTimestamp > 0 && entityTimestamp <= lastProcessed.entityTimestamp) {
            logger.debug(`Suppressing stale message for pointer ${pointer}, entity=${entityId}`)
            invalidMessages.push({ message, error: 'recently_processed_pointer' })
            metrics.increment('message_validation_result_total', { result: 'stale_pointer' })
            continue
          }

          const rateLimitWindowMs = pointerRateLimitSeconds * 1000
          const timeSinceLastRender = Date.now() - lastProcessed.processedAt
          if (timeSinceLastRender < rateLimitWindowMs) {
            const remainingMs = rateLimitWindowMs - timeSinceLastRender
            logger.debug(
              `Rate-limiting pointer ${pointer}, entity=${entityId} (rendered ${Math.floor(timeSinceLastRender / 1000)}s ago, ${Math.ceil(remainingMs / 1000)}s remaining)`
            )
            rateLimitedMessages.push({ message, remainingMs })
            metrics.increment('message_validation_result_total', { result: 'rate_limited' })
            continue
          }
        }
      }

      candidateMessages.push({
        message,
        event: standardEvent,
        pointer,
        timestamp: entityTimestamp
      })
    }

    const maxTimestampByPointer = new Map<string, number>()
    const maxTimestampByEntity = new Map<string, number>()
    for (const { event, pointer, timestamp } of candidateMessages) {
      if (timestamp <= 0) continue
      maxTimestampByEntity.set(event.entity.id, Math.max(maxTimestampByEntity.get(event.entity.id) ?? 0, timestamp))
      if (pointer) {
        maxTimestampByPointer.set(pointer, Math.max(maxTimestampByPointer.get(pointer) ?? 0, timestamp))
      }
    }

    const acceptedEntityIds = new Set<string>()
    for (const candidate of candidateMessages) {
      const maxPointerTimestamp = candidate.pointer ? (maxTimestampByPointer.get(candidate.pointer) ?? 0) : 0
      const maxEntityTimestamp = maxTimestampByEntity.get(candidate.event.entity.id) ?? 0
      const isStaleByPointer =
        candidate.timestamp > 0 && maxPointerTimestamp > 0 && candidate.timestamp < maxPointerTimestamp
      const isStaleByEntity =
        candidate.timestamp > 0 && maxEntityTimestamp > 0 && candidate.timestamp < maxEntityTimestamp

      if (isStaleByPointer || isStaleByEntity || acceptedEntityIds.has(candidate.event.entity.id)) {
        // Leave same-batch stale/duplicate messages invisible instead of returning them as invalid.
        // They should only be deleted after a newer render succeeds and cross-batch dedup can prove they are stale.
        logger.debug(
          `Leaving stale or duplicate same-batch message in queue for pointer ${candidate.pointer}, entity=${candidate.event.entity.id}`
        )
        metrics.increment('message_validation_result_total', { result: 'stale_in_batch' })
        continue
      }

      acceptedEntityIds.add(candidate.event.entity.id)
      validMessages.push({ message: candidate.message, event: candidate.event })
      metrics.increment('message_validation_result_total', { result: 'valid' })
    }

    return { validMessages, invalidMessages, rateLimitedMessages }
  }

  return { validateMessages, markPointerProcessed }
}
