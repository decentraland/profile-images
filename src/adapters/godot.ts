import { exec } from 'child_process'
import { writeFile } from 'fs/promises'
import { existsSync, mkdirSync, rmSync } from 'fs'
import path from 'path'
import { AppComponents, AvatarGenerationResult, ExtendedAvatar } from '../types'
import { AvatarInfo } from '@dcl/schemas'

type GodotAvatarPayload = ExtendedAvatar & {
  destPath: string
  width: number | undefined
  height: number | undefined
  faceDestPath: string
  faceWidth: number | undefined
  faceHeight: number | undefined
}

export type GodotComponent = {
  generateImages(profiles: ExtendedAvatar[]): Promise<AvatarGenerationResult[]>
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

function normalizeUrns(avatar: AvatarInfo): AvatarInfo {
  return {
    ...avatar,
    wearables: avatar.wearables.map((wearable: any) => splitUrnAndTokenId(wearable).urn)
  }
}

export async function createGodotSnapshotComponent({
  logs,
  metrics,
  config
}: Pick<AppComponents, 'logs' | 'metrics' | 'config'>): Promise<GodotComponent> {
  const peerUrl = await config.requireString('PEER_URL')
  const logger = logs.getLogger('godot-snapshot')
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

  async function generateImages(avatars: ExtendedAvatar[]): Promise<AvatarGenerationResult[]> {
    const payloads: GodotAvatarPayload[] = []
    const results: AvatarGenerationResult[] = []

    for (const { entity, avatar } of avatars) {
      const destPath = path.join(outputPath, `${entity}.png`)
      const faceDestPath = path.join(outputPath, `${entity}_face.png`)
      payloads.push({
        entity,
        destPath,
        width,
        height,
        faceDestPath,
        faceWidth,
        faceHeight,
        avatar: normalizeUrns(avatar)
      })
      results.push({
        success: false,
        avatar,
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

    logger.debug(`Running godot to process ${payloads.length} avatars`)
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
