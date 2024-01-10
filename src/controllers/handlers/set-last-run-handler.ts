import { HandlerContextWithPath, InvalidRequestError } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export async function setLastRunHandler(
  context: HandlerContextWithPath<'jobProducer', '/set-last-run'>
): Promise<IHttpServerComponent.IResponse> {
  const {
    request,
    components: { jobProducer }
  } = context

  const body = await request.json()
  if (!body || typeof body !== 'string' || !Number.isInteger(parseInt(body))) {
    throw new InvalidRequestError('Invalid request. Request body is not valid')
  }

  await jobProducer.changeLastRun(parseInt(body))

  return {
    status: 204
  }
}
