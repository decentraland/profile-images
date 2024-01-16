import { HandlerContextWithPath, InvalidRequestError } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export async function setLastRunHandler(
  context: HandlerContextWithPath<'jobProducer' | 'logs', '/set-last-run'>
): Promise<IHttpServerComponent.IResponse> {
  const {
    request,
    components: { jobProducer, logs }
  } = context

  const logger = logs.getLogger('set-last-run-handler')

  const body = await request.json()
  if (!body || typeof body !== 'string' || !Number.isInteger(parseInt(body, 10))) {
    throw new InvalidRequestError('Invalid request. Request body is not valid')
  }

  const ts = parseInt(body, 10)
  await jobProducer.changeLastRun(ts)

  logger.debug(`Setting last run to: ${ts}`)

  return {
    status: 204
  }
}
