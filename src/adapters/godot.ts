import { exec } from 'child_process'
import { writeFile } from 'fs/promises'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { access, constants } from 'fs/promises'
import path from 'path'
import { AppComponents, AvatarGenerationResult, ExtendedAvatar } from '../types'
import { globSync } from 'fast-glob'

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

const outputPath = 'output'
const width = 256
const height = 512
const faceWidth = 256
const faceHeight = 256

export async function createGodotSnapshotComponent({
  logs,
  metrics,
  config
}: Pick<AppComponents, 'logs' | 'metrics' | 'config'>): Promise<GodotComponent> {
  const peerUrl = await config.requireString('PEER_URL')
  const logger = logs.getLogger('godot-snapshot')
  const explorerPath = process.env.EXPLORER_PATH || '.'

  let executionNumber = 0

  function run(input: any): Promise<undefined | { stderr: string; stdout: string }> {
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
      logger.debug(`about to exec: explorerPath: ${explorerPath}, display: ${process.env.DISPLAY}, command: ${command}`)

      exec(command, { timeout: 30_000 }, (error, stdout, stderr) => {
        rmSync(avatarDataPath)
        if (error) {
          for (const f of globSync('core.*')) {
            rmSync(f)
          }
          return resolve({ stdout, stderr })
        }
        resolve(undefined)
      })
    })
  }

  async function generateImages(avatars: ExtendedAvatar[]): Promise<AvatarGenerationResult[]> {
    const payloads: GodotAvatarPayload[] = []
    const results: AvatarGenerationResult[] = []

    for (const { entity, avatar } of avatars) {
      const destPath = path.join(outputPath, `${entity}_body.png`)
      const faceDestPath = path.join(outputPath, `${entity}_face.png`)
      payloads.push({
        entity,
        destPath,
        width,
        height,
        faceDestPath,
        faceWidth,
        faceHeight,
        avatar
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
    const output = await run(input)
    const duration = Date.now() - start

    metrics.observe('snapshot_generation_duration_seconds', {}, duration / payloads.length / 1000)
    logger.log(`screenshots for ${payloads.length} entities: ${duration} ms`)

    for (const result of results) {
      if (existsSync(result.avatarPath) && existsSync(result.facePath)) {
        try {
          await access(result.avatarPath, constants.R_OK)
          result.success = true
        } catch (err) {
          logger.error(`No permissions to read ${result.avatarPath}`)
        }
      } else {
        result.output = output
      }
    }

    return results
  }

  return {
    generateImages
  }
}
