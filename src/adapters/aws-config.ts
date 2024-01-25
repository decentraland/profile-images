import { AppComponents } from '../types'

export type AwsConfig = {
  region: string
  credentials?: { accessKeyId: string; secretAccessKey: string }
  endpoint?: string
  forcePathStyle?: boolean
}

export async function createAwsConfig({ config }: Pick<AppComponents, 'config'>): Promise<AwsConfig> {
  const awsConfig: AwsConfig = {
    region: await config.requireString('AWS_REGION')
  }
  const accessKeyId = await config.getString('AWS_ACCESS_KEY_ID')
  const secretAccessKey = await config.getString('AWS_SECRET_ACCESS_KEY')
  if (accessKeyId && secretAccessKey) {
    awsConfig.credentials = {
      accessKeyId: (await config.getString('AWS_ACCESS_KEY_ID')) || '',
      secretAccessKey: (await config.getString('AWS_SECRET_ACCESS_KEY')) || ''
    }
  }
  const awsEndpoint = await config.getString('AWS_ENDPOINT')
  if (awsEndpoint) {
    awsConfig.endpoint = awsEndpoint
    awsConfig.forcePathStyle = true
  }

  return awsConfig
}
