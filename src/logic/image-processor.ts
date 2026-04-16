import { Entity } from '@dcl/schemas'
import { AppComponents, ExtendedAvatar } from '../types'
import { computeAvatarHash } from '../utils/avatar-comparison'

export type ProcessingResult = ExtendedAvatar & {
  success: boolean
  shouldRetry: boolean
  error?: string
}

export type ImageProcessor = {
  processEntities(entities: Entity[]): Promise<ProcessingResult[]>
}

export async function createImageProcessor({
  config,
  logs,
  godot,
  storage,
  metrics
}: Pick<AppComponents, 'config' | 'logs' | 'godot' | 'storage' | 'metrics'>): Promise<ImageProcessor> {
  const logger = logs.getLogger('image-processor')
  const [commitHash, version] = await Promise.all([
    config.requireString('COMMIT_HASH'),
    config.requireString('CURRENT_VERSION')
  ])

  async function processEntities(entities: Entity[]): Promise<ProcessingResult[]> {
    if (entities.length === 0) {
      logger.warn('No entities provided to process')
      return []
    }

    const deploymentTimestamps = new Map<string, number>(entities.map(({ id, timestamp }) => [id, timestamp]))

    const avatars: ExtendedAvatar[] = entities.map(({ id, metadata }) => ({
      entity: id,
      avatar: metadata.avatars[0].avatar
    }))

    // Compute hashes for all incoming avatars and fetch stored hashes in parallel
    const incomingHashes = new Map(avatars.map((a) => [a.entity, computeAvatarHash(a.avatar)]))

    const storedHashes = await Promise.all(
      avatars.map(async ({ entity }) => ({
        entity,
        hash: await storage.retrieveAvatarHash(entity)
      }))
    )

    const storedByEntity = new Map(storedHashes.map(({ entity, hash }) => [entity, hash]))

    // Partition entities: those that need rendering vs those that can be skipped
    const needsRender: ExtendedAvatar[] = []
    const skipped: ExtendedAvatar[] = []

    for (const extAvatar of avatars) {
      const storedHash = storedByEntity.get(extAvatar.entity)
      const incomingHash = incomingHashes.get(extAvatar.entity)
      if (storedHash && storedHash === incomingHash) {
        skipped.push(extAvatar)
      } else {
        needsRender.push(extAvatar)
      }
    }

    // Build synthetic success results for skipped entities
    const skippedResults: ProcessingResult[] = skipped.map((extAvatar) => {
      metrics.increment('snapshot_generation_count', { status: 'skipped' }, 1)
      logger.debug(`Skipping image generation for entity=${extAvatar.entity}: avatar unchanged`)
      return {
        entity: extAvatar.entity,
        success: true,
        shouldRetry: false,
        avatar: extAvatar.avatar
      }
    })

    // If no entities need rendering, return early
    if (needsRender.length === 0) {
      return skippedResults
    }

    const { avatars: results, output: outputGenerated } = await godot.generateImages(needsRender)

    const renderedResults = await Promise.all(
      results.map(async (result) => {
        if (result.success) {
          metrics.increment('snapshot_generation_count', { status: 'success' }, 1)
          const hash = incomingHashes.get(result.entity)
          if (!hash) {
            logger.warn(
              `No precomputed avatar hash for entity=${result.entity} — image will be stored without change-detection metadata`
            )
          }
          const success = await storage.storeImages(result.entity, result.avatarPath, result.facePath, hash)

          if (!success) {
            logger.error(`Error saving generated images to s3 for entity=${result.entity}`)
            return {
              entity: result.entity,
              success: false,
              shouldRetry: true,
              error: 'Failed to store images',
              avatar: result.avatar
            }
          }

          const deploymentTimestamp = deploymentTimestamps.get(result.entity)

          if (deploymentTimestamp) {
            const durationInSeconds = (Date.now() - deploymentTimestamp) / 1000
            if (durationInSeconds > 0) {
              metrics.observe('entity_deployment_to_image_generation_duration_seconds', {}, durationInSeconds)
              logger.debug(`Total duration for entity=${result.entity} is ${durationInSeconds}s`)
            }
          }

          return {
            entity: result.entity,
            success: true,
            shouldRetry: false,
            avatar: result.avatar
          }
        }

        metrics.increment('snapshot_generation_count', { status: 'failure' }, 1)

        if (needsRender.length === 1) {
          logger.debug(`Giving up on entity=${result.entity} because of godot failure.`)
          const failure = {
            timestamp: new Date().toISOString(),
            commitHash,
            version,
            entity: result.entity,
            outputGenerated
          }
          await storage.storeFailure(result.entity, JSON.stringify(failure))

          return {
            entity: result.entity,
            success: false,
            shouldRetry: false,
            error: 'Godot generation failed',
            avatar: result.avatar
          }
        }

        logger.debug(`Godot failure, enqueue for individual retry, entity=${result.entity}`)
        return {
          entity: result.entity,
          success: false,
          shouldRetry: true,
          error: 'Godot generation failed',
          avatar: result.avatar
        }
      })
    )

    // Merge rendered results with skipped results, preserving original entity order
    const resultByEntity = new Map<string, ProcessingResult>()
    for (const r of [...renderedResults, ...skippedResults]) {
      resultByEntity.set(r.entity, r)
    }

    return entities.map(({ id, metadata }) => {
      const result = resultByEntity.get(id)
      if (!result) {
        logger.error(`No processing result for entity=${id} — Godot returned fewer results than expected`)
        return {
          entity: id,
          success: false,
          shouldRetry: true,
          error: 'Missing processing result',
          avatar: metadata.avatars[0].avatar
        }
      }
      return result
    })
  }

  return {
    processEntities
  }
}
