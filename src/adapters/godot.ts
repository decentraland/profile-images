import path from 'path'
import { exec } from 'child_process'
import { writeFile } from 'fs/promises'
import { stat, mkdir, rm } from 'fs/promises'
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

type GodotInput = {
  baseUrl: string
  payload: GodotAvatarPayload[]
}

export type GodotComponent = {
  generateImages(profiles: ExtendedAvatar[]): Promise<{ output?: string; avatars: AvatarGenerationResult[] }>
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

  function runGodot(input: GodotInput): Promise<{ error: boolean; stderr: string; stdout: string }> {
    return new Promise(async (resolve) => {
      executionNumber += 1

      const timeout = 15_000 + input.payload.length * 10_000
      const avatarDataPath = `temp-avatars-${executionNumber}.json`
      await writeFile(avatarDataPath, JSON.stringify(input))

      await mkdir(outputPath, { recursive: true })
      const command = `${explorerPath}/decentraland.godot.client.x86_64 --rendering-driver opengl3 --avatar-renderer --avatars ${avatarDataPath}`
      logger.debug(`about to exec: explorerPath: ${explorerPath}, display: ${process.env.DISPLAY}, command: ${command}`)

      const childProcess = exec(command, { timeout }, (error, stdout, stderr) => {
        rm(avatarDataPath).catch(logger.error)
        if (error) {
          for (const f of globSync('core.*')) {
            rm(f).catch(logger.error)
          }
          return resolve({ error: true, stdout, stderr })
        }
        resolve({ error: false, stdout, stderr })
      })

      childProcess.on('close', (_code, signal) => {
        // timeout sends SIGTERM, we might want to kill it harder
        if (signal === 'SIGTERM') {
          childProcess.kill('SIGKILL')
        }
      })
    })
  }

  async function generateImages(
    avatars: ExtendedAvatar[]
  ): Promise<{ output?: string; avatars: AvatarGenerationResult[] }> {
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
      return { avatars: results }
    }

    const input = {
      baseUrl: `${peerUrl}/content`,
      payload: payloads
    }

    const [previousTopData, previousDiskUsage] = await Promise.all([getTopData(), getDiskUsage()])

    logger.debug(`Running godot to process ${payloads.length} avatars`)
    const start = Date.now()
    const { error, stdout, stderr } = await runGodot(input)
    const duration = Date.now() - start

    metrics.observe('snapshot_generation_duration_seconds', {}, duration / payloads.length / 1000)
    logger.log(`screenshots for ${payloads.length} entities: ${duration} ms`)

    let failedGeneration = false
    for (const result of results) {
      try {
        await Promise.all([stat(result.avatarPath), stat(result.facePath)])
        result.success = true
      } catch (err: any) {
        failedGeneration = true
        logger.error(err)
      }
    }

    let output = undefined
    if (failedGeneration) {
      const [nextTopData, nextDiskUsage] = await Promise.all([getTopData(), getDiskUsage()])
      output = `
        > error: ${error}\n
        > previousTopData: ${previousTopData}\n
        > previousDiskUsage: ${previousDiskUsage}\n
        > nextTopData: ${nextTopData}\n
        > nextDiskUsage: ${nextDiskUsage}\n
        > stdout: ${stdout}\n
        > stderr: ${stderr}\n
        > input: ${JSON.stringify(input)}\n
        > duration: ${duration} ms\n
      `
    }

    return { avatars: results, output }
  }

  return {
    generateImages
  }
}

// @returns the top 10 processes sorted by resident memory
function getTopData(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    exec('top -b -n 1 -o RES | head -n 17', (error, stdout, _stderr) => {
      if (error) {
        reject(error)
      }
      resolve(stdout)
    })
  })
}

// @returns the disk usage
function getDiskUsage(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    exec('df -h', (error, stdout, _stderr) => {
      if (error) {
        reject(error)
      }
      resolve(stdout)
    })
  })
}
