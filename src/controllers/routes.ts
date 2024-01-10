import { Router } from '@well-known-components/http-server'
import { GlobalContext } from '../types'
import { statusHandler } from './handlers/status-handler'
import { errorHandler } from './handlers/error-handler'
import { setLastRunHandler } from './handlers/set-last-run-handler'
import { scheduleProcessingHandler } from './handlers/set-schedule-processing-handler'

export async function setupRouter(_globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()

  router.use(errorHandler)

  router.post('/set-last-run', setLastRunHandler)
  router.post('/schedule-processing', scheduleProcessingHandler)

  router.get('/status', statusHandler)

  return router
}
