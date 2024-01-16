import { Entity, Profile } from '@dcl/schemas'
import { HandlerContextWithPath, InvalidRequestError, ExtendedAvatar } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export async function scheduleProcessingHandler(
  context: HandlerContextWithPath<'logs' | 'queue' | 'storage' | 'fetch' | 'config', '/schedule-processing'>
): Promise<IHttpServerComponent.IResponse> {
  const {
    request,
    components: { logs, queue, storage, fetch, config }
  } = context

  const peerUrl = await config.requireString('PEER_URL')
  const logger = logs.getLogger('schedule-processing-handler')

  const body = await request.json()
  if (!body || typeof body !== 'object' || !Array.isArray(body)) {
    throw new InvalidRequestError('Invalid request. Request body is not valid')
  }

  await storage.deleteMultiple(body.map((entity: string) => `failure/${entity}.txt`))

  const response = await fetch.fetch(`${peerUrl}/content/entities/active`, {
    method: 'POST',
    body: JSON.stringify({ ids: body })
  })

  const data: Entity[] = await response.json()

  for (const entity of data) {
    const profile: Profile = entity.metadata
    const message: ExtendedAvatar = { entity: entity.id, avatar: profile.avatars[0].avatar }
    await queue.send(message)
    logger.debug(`Added to queue entity="${entity.id}"`)
  }

  return {
    status: 204
  }
}
