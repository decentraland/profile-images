import path from 'path'
import { exec, ExecException } from 'child_process'
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
  const godotEditorFileName = 'decentraland.godot.client.x86_64'
  const godotEditorPath = `${explorerPath}/${godotEditorFileName}`
  const baseTime = (await config.getNumber('GODOT_BASE_TIMEOUT')) || 15_000
  const timePerAvatar = (await config.getNumber('GODOT_AVATAR_TIMEOUT')) || 10_000

  let executionNumber = 0

  function runGodot(input: GodotInput): Promise<{ error: boolean; stderr: string; stdout: string }> {
    // Helper: kill all processes whose command line matches the Godot executable.
    const killProcessTree = () => {
      // Adjust the match pattern if needed.
      const pkillCommand = `pkill -9 -f "${godotEditorFileName}"`
      exec(pkillCommand, (err, _stdout, _stderr) => {
        if (err) {
          // pkill returns code 1 if no process was matched; ignore that.
          if ((err as any).code !== 1) {
            logger.error('Error executing pkill for godot process tree', {
              message: (err as Error).message
            })
          }
        }
      })
    }

    // Helper: kill the process group and then ensure the entire tree is killed.
    const killProcessGroup = (childProcessPid: number | undefined) => {
      if (childProcessPid !== undefined) {
        try {
          // Attempt to kill the entire process group.
          process.kill(-childProcessPid, 'SIGKILL')
        } catch (e: unknown) {
          if (e instanceof Error && (e as any).code === 'ESRCH') {
            // Process group already terminated.
          } else if (e instanceof Error) {
            logger.error('Error when killing process group', { message: e.message })
          } else {
            logger.error('Error when killing process group', { error: String(e) })
          }
        }
      } else {
        logger.error('childProcess.pid is undefined; cannot kill process group')
      }
      // Additionally, call pkill to catch any stray Godot processes.
      killProcessTree()
    }

    return new Promise(async (resolve) => {
      executionNumber += 1
      const timeout = baseTime + input.payload.length * timePerAvatar
      const avatarDataPath = `temp-avatars-${executionNumber}.json`
      await writeFile(avatarDataPath, JSON.stringify(input))

      await mkdir(outputPath, { recursive: true })
      const command = `${godotEditorPath} --rendering-driver opengl3 --avatar-renderer --avatars ${avatarDataPath}`
      logger.debug(
        `about to exec: explorerPath: ${explorerPath}, display: ${process.env.DISPLAY}, command: ${command}, timeout: ${timeout}`
      )

      let resolved = false

      // Set a failsafe timeout that will kill the process group if the command hasn't finished.
      const timeoutHandler: NodeJS.Timeout = setTimeout(() => {
        killProcessGroup(childProcessPid)
        if (!resolved) {
          resolved = true
          resolve({ error: true, stdout: '', stderr: 'timeout' })
        }
      }, timeout + 5000)

      // Execute the command via exec (which spawns a shell)
      const childProcess = exec(
        command,
        { timeout } as any,
        (error: ExecException | null, stdout: string, stderr: string) => {
          if (resolved) return
          clearTimeout(timeoutHandler)
          if (error) {
            for (const f of globSync('core.*')) {
              rm(f).catch(logger.error)
            }
            resolved = true
            return resolve({ error: true, stdout, stderr })
          }
          resolved = true
          resolve({ error: false, stdout, stderr })
        }
      )

      // Let the child process run independently.
      if (typeof childProcess.unref === 'function') {
        childProcess.unref()
      }

      // Save the child's PID.
      const childProcessPid = childProcess.pid

      childProcess.on('close', (_code, signal) => {
        // If a SIGTERM was received, try to kill the process group.
        if (signal === 'SIGTERM') {
          killProcessGroup(childProcessPid)
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
