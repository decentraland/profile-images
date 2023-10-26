import fs from 'fs'
import { join } from 'path'
import { IHttpServerComponent } from '@well-known-components/interfaces'
import { HandlerContextWithPath } from '../../types'

export async function staticFileHandler(
  context: Pick<HandlerContextWithPath<'metrics' | 'config' | 'fetch', '/:file'>, 'url' | 'components' | 'params'>
): Promise<IHttpServerComponent.IResponse> {
  const { url } = context
  const path = join('node_modules/@dcl/wearable-preview/static-local', url.pathname)

  if (!fs.existsSync(path)) {
    return {
      status: 404,
      body: `Not found`
    }
  }

  return {
    status: 200,
    body: fs.readFileSync(path)
  }
}
