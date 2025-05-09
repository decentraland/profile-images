import { IHttpServerComponent } from '@well-known-components/interfaces'
import { InvalidRequestError } from '@dcl/platform-server-commons'
import { HandlerContextWithPath } from '../../types'

export async function scheduleProcessingHandler(
  context: HandlerContextWithPath<'logs' | 'entityFetcher' | 'imageProcessor', '/schedule-processing'>
): Promise<IHttpServerComponent.IResponse> {
  const {
    request,
    components: { logs, entityFetcher, imageProcessor }
  } = context

  const logger = logs.getLogger('schedule-processing-handler')

  const body = await request.json()
  if (!body || typeof body !== 'object' || !Array.isArray(body)) {
    throw new InvalidRequestError('Invalid request. Request body is not valid')
  }

  try {
    const entities = await entityFetcher.getEntitiesByIds(body.map((entity) => entity.entityId))
    const results = await imageProcessor.processEntities(entities)

    for (const result of results) {
      if (result.success) {
        logger.debug(`Successfully processed entity="${result.entity}"`)
      } else {
        logger.error(`Failed to process entity="${result.entity}": ${result.error}`)
      }
    }

    return {
      status: 200,
      body: JSON.stringify({
        results: results.map((result) => ({
          entity: result.entity,
          success: result.success,
          shouldRetry: result.shouldRetry,
          error: result.error
        }))
      })
    }
  } catch (error: any) {
    logger.error('Error processing entities', error)
    return {
      status: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    }
  }
}
