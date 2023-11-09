import { HandlerContextWithPath, InvalidRequestError } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export async function setLastRunHandler(
  _context: HandlerContextWithPath<'jobProducer', '/set-last-run'>
): Promise<IHttpServerComponent.IResponse> {
  const body = await _context.request.json()
  if (!body || typeof body !== 'string' || !Number.isInteger(parseInt(body))) {
    throw new InvalidRequestError('Invalid request. Request body is not valid')
  }

  await _context.components.jobProducer.changeLastRun(parseInt(body))

  return {
    status: 204
  }
}
