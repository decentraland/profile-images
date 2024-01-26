import { Router } from '@well-known-components/http-server'
import { GlobalContext } from '../types'
import { statusHandler } from './handlers/status-handler'
import { scheduleProcessingHandler } from './handlers/set-schedule-processing-handler'
import { toolsHandler } from './handlers/tools-handler'
import { bearerTokenMiddleware, errorHandler } from '@dcl/platform-server-commons'

export async function setupRouter(globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()

  router.use(errorHandler)

  const secret = await globalContext.components.config.getString('AUTH_SECRET')
  if (secret) {
    router.post('/tools', bearerTokenMiddleware(secret), toolsHandler)
    router.post('/schedule-processing', bearerTokenMiddleware(secret), scheduleProcessingHandler)
  }

  router.get('/status', statusHandler)

  return router
}
