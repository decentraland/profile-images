import { CopyObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client, _Object } from '@aws-sdk/client-s3'
import { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import { AwsConfig } from '../adapters/aws-config'

const CONCURRENCY = 20
const LOG_EVERY = 100
const MAX_RETRIES = 3

type MigrationComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  awsConfig: AwsConfig
}

export async function runBucketMigration({ config, logs, awsConfig }: MigrationComponents): Promise<void> {
  const logger = logs.getLogger('bucket-migration')

  const sourceBucket = await config.getString('SOURCE_BUCKET_NAME')
  if (!sourceBucket) {
    logger.info('SOURCE_BUCKET_NAME not set, skipping bucket migration')
    return
  }

  const destinationBucket = await config.requireString('BUCKET_NAME')
  const destinationPrefix = (await config.getString('S3_IMAGES_PREFIX')) || ''
  const sourcePrefix = (await config.getString('SOURCE_S3_IMAGES_PREFIX')) || destinationPrefix

  logger.info(
    `Starting bucket migration from "${sourceBucket}" (prefix: "${sourcePrefix}") to "${destinationBucket}" (prefix: "${destinationPrefix}")`
  )

  const s3 = new S3Client(awsConfig)

  let totalListed = 0
  let copied = 0
  let skipped = 0
  let failed = 0
  let continuationToken: string | undefined

  do {
    const listCommand = new ListObjectsV2Command({
      Bucket: sourceBucket,
      Prefix: sourcePrefix || undefined,
      ContinuationToken: continuationToken
    })

    const listResult = await s3.send(listCommand)
    const objects = listResult.Contents || []
    totalListed += objects.length
    continuationToken = listResult.NextContinuationToken

    // Process objects with concurrency limit
    const chunks = chunkArray<_Object>(objects, CONCURRENCY)
    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async (obj) => {
          if (!obj.Key) return 'skipped'

          const destinationKey =
            sourcePrefix !== destinationPrefix ? obj.Key.replace(sourcePrefix, destinationPrefix) : obj.Key

          // Check if object already exists in destination
          try {
            await s3.send(new HeadObjectCommand({ Bucket: destinationBucket, Key: destinationKey }))
            return 'skipped' // already exists
          } catch (err: any) {
            if (err.name !== 'NotFound' && err.$metadata?.httpStatusCode !== 404) {
              throw err
            }
            // Object doesn't exist, proceed with copy
          }

          await copyWithRetry(s3, sourceBucket, obj.Key, destinationBucket, destinationKey)
          return 'copied'
        })
      )

      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value === 'copied') copied++
          else skipped++
        } else {
          failed++
          logger.warn(`Failed to copy object: ${result.reason}`)
        }
      }

      if ((copied + skipped + failed) % LOG_EVERY < CONCURRENCY) {
        logger.info(
          `Migration progress: ${copied} copied, ${skipped} skipped, ${failed} failed (${totalListed} listed so far)`
        )
      }
    }
  } while (continuationToken)

  logger.info(
    `Bucket migration complete: ${copied} copied, ${skipped} skipped, ${failed} failed out of ${totalListed} total objects`
  )
}

async function copyWithRetry(
  s3: S3Client,
  sourceBucket: string,
  sourceKey: string,
  destinationBucket: string,
  destinationKey: string
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await s3.send(
        new CopyObjectCommand({
          Bucket: destinationBucket,
          Key: destinationKey,
          CopySource: encodeURI(`${sourceBucket}/${sourceKey}`),
          MetadataDirective: 'COPY'
        })
      )
      return
    } catch (err: any) {
      if (err.name === 'NoSuchKey') return // source object disappeared, skip
      if (attempt === MAX_RETRIES) throw err
      await sleep(Math.pow(2, attempt - 1) * 1000)
    }
  }
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
