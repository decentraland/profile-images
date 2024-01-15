import { exec } from 'child_process'
import { writeFile } from 'fs/promises'
import { existsSync, mkdirSync, rmSync } from 'fs'
import path from 'path'
import { AppComponents, AvatarGenerationResult } from '../types'
import { Entity } from '@dcl/schemas'

type GodotAvatarPayload = {
  entity: string
  destPath: string
  width: number | undefined
  height: number | undefined
  faceDestPath: string
  faceWidth: number | undefined
  faceHeight: number | undefined
  avatar: any
}

export type GodotComponent = {
  generateImages(entities: string[]): Promise<AvatarGenerationResult[]>
}

export function splitUrnAndTokenId(urnReceived: string) {
  const urnLength = urnReceived.split(':').length

  if (urnLength === 7) {
    const lastColonIndex = urnReceived.lastIndexOf(':')
    const urnValue = urnReceived.slice(0, lastColonIndex)
    return { urn: urnValue, tokenId: urnReceived.slice(lastColonIndex + 1) }
  } else {
    return { urn: urnReceived, tokenId: undefined }
  }
}

const outputPath = 'output'
const width = 256
const height = 512
const faceWidth = 256
const faceHeight = 256

const profileWithAssetUrns = (profile: any) => ({
  ...profile,
  metadata: {
    ...profile.metadata,
    avatars: profile.metadata.avatars.map((av: any) => ({
      ...av,
      avatar: {
        ...av.avatar,
        wearables: av.avatar.wearables.map((wearable: any) => splitUrnAndTokenId(wearable).urn)
      }
    }))
  }
})

export async function createGodotSnapshotComponent({
  config,
  fetch,
  logs,
  metrics
}: Pick<AppComponents, 'config' | 'fetch' | 'logs' | 'metrics'>): Promise<GodotComponent> {
  const logger = logs.getLogger('godot-snapshot')
  const peerUrl = await config.requireString('PEER_URL')
  const explorerPath = process.env.EXPLORER_PATH || '.'

  let executionNumber = 0

  function run(input: any): Promise<void> {
    return new Promise(async (resolve) => {
      // unique number for temp files
      executionNumber += 1

      // create directory if exists
      if (!existsSync(outputPath)) {
        mkdirSync(outputPath)
      }

      const avatarDataPath = `temp-avatars-${executionNumber}.json`

      await writeFile(avatarDataPath, JSON.stringify(input))
      const command = `${explorerPath}/decentraland.godot.client.x86_64 --rendering-driver opengl3 --avatar-renderer --avatars ${avatarDataPath}`
      logger.debug(`about to exec, explorerPath: ${explorerPath}, display: ${process.env.DISPLAY}, command: ${command}`)

      exec(command, { timeout: 30_000 }, (_error, _stdout, _stderr) => {
        rmSync(avatarDataPath)
        resolve()
      })
    })
  }

  async function generateImages(entities: string[]): Promise<AvatarGenerationResult[]> {
    const response = await fetch.fetch(`${peerUrl}/content/entities/active`, {
      method: 'POST',
      body: JSON.stringify({ ids: entities })
    })
    const profiles: Entity[] = (await response.json()).map(profileWithAssetUrns)

    const payloads: GodotAvatarPayload[] = []
    const results: AvatarGenerationResult[] = []

    for (const entity of entities) {
      const profile = profiles.find((p) => p.id === entity)
      const destPath = path.join(outputPath, `${entity}.png`)
      const faceDestPath = path.join(outputPath, `${entity}_face.png`)
      if (profile) {
        payloads.push({
          entity,
          destPath,
          width,
          height,
          faceDestPath,
          faceWidth,
          faceHeight,
          avatar: profile.metadata.avatars[0].avatar
        })
      }
      results.push({
        success: false,
        entityFound: !!profile,
        entity,
        avatarPath: destPath,
        facePath: faceDestPath
      })
    }

    if (payloads.length === 0) {
      return results
    }

    const input = {
      baseUrl: `${peerUrl}/content`,
      payload: payloads
    }

    logger.debug(`Running godot to process ${payloads.length} avatars `)
    const start = Date.now()
    await run(input)
    const duration = Date.now() - start

    metrics.observe('snapshot_generation_duration_seconds', {}, duration / payloads.length)
    logger.log(`screenshots for ${payloads.length} entities: ${duration} ms`)

    for (const result of results) {
      if (existsSync(result.avatarPath) && existsSync(result.facePath)) {
        result.success = true
      }
    }

    return results
  }

  return {
    generateImages
  }
}
