import { HandlerContextWithPath } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export async function healthHandler(
  _context: HandlerContextWithPath<'config', '/status'>
): Promise<IHttpServerComponent.IResponse> {
  return {
    status: 200,
    body: {}
  }
}
