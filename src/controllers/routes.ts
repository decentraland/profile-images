import { Router } from '@well-known-components/http-server'
import { GlobalContext } from '../types'
import { statusHandler } from './handlers/status-handler'
import { errorHandler } from './handlers/error-handler'
import { staticFileHandler } from './handlers/static-file-handler'

export async function setupRouter(_globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()

  router.use(errorHandler)

  router.get('/status', statusHandler)
  // these are necessary for hosting the wearable-preview locally
  router.get('/:file', staticFileHandler)
  router.get('/:folder/:file', staticFileHandler)
  router.get('/:folder/:subfolder/:file', staticFileHandler)

  return router
}
