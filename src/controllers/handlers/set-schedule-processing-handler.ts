import { Entity, Profile } from '@dcl/schemas'
import { IHttpServerComponent } from '@well-known-components/interfaces'
import { HandlerContextWithPath } from '../../types'
import { sqsSendMessage } from '../../logic/queue'
import { InvalidRequestError } from '@dcl/platform-server-commons'

export async function scheduleProcessingHandler(
  context: HandlerContextWithPath<'logs' | 'sqsClient' | 'storage' | 'fetch' | 'config', '/schedule-processing'>
): Promise<IHttpServerComponent.IResponse> {
  const {
    request,
    components: { logs, sqsClient, storage, fetch, config }
  } = context

  const [mainQueueUrl, peerUrl] = await Promise.all([
    config.requireString('QUEUE_NAME'),
    config.requireString('PEER_URL')
  ])
  const logger = logs.getLogger('schedule-processing-handler')

  const body = await request.json()
  if (!body || typeof body !== 'object' || !Array.isArray(body)) {
    throw new InvalidRequestError('Invalid request. Request body is not valid')
  }

  await storage.deleteFailures(body)

  const response = await fetch.fetch(`${peerUrl}/content/entities/active`, {
    method: 'POST',
    body: JSON.stringify({ ids: body })
  })

  const data: Entity[] = await response.json()

  for (const entity of data) {
    const profile: Profile = entity.metadata
    await sqsSendMessage(sqsClient, mainQueueUrl, { entity: entity.id, avatar: profile.avatars[0].avatar })
    logger.debug(`Added to queue entity="${entity.id}"`)
  }

  return {
    status: 204
  }
}
