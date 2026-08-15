import { Lifecycle } from '@well-known-components/interfaces'
import { setupRouter } from './controllers/routes'
import { AppComponents, GlobalContext, TestComponents } from './types'
import { runBucketMigration } from './migrations/bucket-migration'

// this function wires the business logic (adapters & controllers) with the components (ports)
export async function main(program: Lifecycle.EntryPointParameters<AppComponents | TestComponents>) {
  const { components, startComponents } = program
  const globalContext: GlobalContext = {
    components
  }

  // wire the HTTP router (make it automatic? TBD)
  const router = await setupRouter(globalContext)
  // register routes middleware
  components.server.use(router.middleware())
  // register not implemented/method not allowed/cors responses middleware
  components.server.use(router.allowedMethods())
  // set the context to be passed to the handlers
  components.server.setContext(globalContext)

  // start ports: db, listeners, synchronizations, etc
  await startComponents()

  // run bucket migration if SOURCE_BUCKET_NAME is configured
  await runBucketMigration(components)
}
