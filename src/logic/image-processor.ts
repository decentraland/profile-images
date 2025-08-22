import { Entity } from '@dcl/schemas'
import { AppComponents, ExtendedAvatar } from '../types'

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

    const { avatars: results, output: outputGenerated } = await godot.generateImages(avatars)

    return Promise.all(
      results.map(async (result) => {
        if (result.success) {
          metrics.increment('snapshot_generation_count', { status: 'success' }, 1)
          const success = await storage.storeImages(result.entity, result.avatarPath, result.facePath)

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
            metrics.observe('entity_deployment_to_image_generation_duration_seconds', {}, durationInSeconds)
          }

          return {
            entity: result.entity,
            success: true,
            shouldRetry: false,
            avatar: result.avatar
          }
        }

        metrics.increment('snapshot_generation_count', { status: 'failure' }, 1)

        if (entities.length === 1) {
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
  }

  return {
    processEntities
  }
}
