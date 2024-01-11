import { HandlerContextWithPath, InvalidRequestError, QueueMessage } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export async function scheduleProcessingHandler(
  context: HandlerContextWithPath<'logs' | 'queue' | 'storage', '/schedule-processing'>
): Promise<IHttpServerComponent.IResponse> {
  const {
    request,
    components: { logs, queue, storage }
  } = context

  const logger = logs.getLogger('schedule-processing-handler')

  const body = await request.json()
  if (!body || typeof body !== 'object' || !Array.isArray(body)) {
    throw new InvalidRequestError('Invalid request. Request body is not valid')
  }

  await storage.deleteMultiple(body.map((entity: string) => `failure/${entity}.txt`))
  for (const entity of body) {
    const message: QueueMessage = { entity, attempt: 0 }
    await queue.send(message)
    logger.debug(`Added to queue entity="${entity}"`)
  }

  return {
    status: 204
  }
}
