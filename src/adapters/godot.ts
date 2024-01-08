import { exec } from 'child_process'
import { writeFile } from 'fs/promises'
import { existsSync, mkdirSync, rmSync } from 'fs'
import path from 'path'
import { AppComponents, Godot } from '../types'
import fs from 'fs/promises'

let executionNumber = 0

type OptionsGenerateAvatars = Partial<{
  outputPath: string
  faceWidth: number
  faceHeight: number
  width: number
  height: number
}>

type AvatarGenerationResult = {
  avatarPath: string
  facePath: string
}

type GodotAvatarPayload = {
  destPath: string
  width: number | undefined
  height: number | undefined
  faceDestPath: string
  faceWidth: number | undefined
  faceHeight: number | undefined
  avatar: any
}

export async function createGodotSnapshotComponent({
  config,
  metrics
}: Pick<AppComponents, 'config' | 'metrics'>): Promise<Godot> {
  const peerUrl = await config.requireString('PEER_URL')
  console.log('peerUrl', peerUrl)

  async function preparePayload(address: string, options: OptionsGenerateAvatars): Promise<GodotAvatarPayload> {
    const response = await fetch(`${peerUrl}/lambdas/profiles/${address}`)
    const data = await response.json()
    const destPath = path.join(options.outputPath ?? '', `${address}.png`)
    const faceDestPath = path.join(options.outputPath ?? '', `${address}_face.png`)
    return {
      destPath,
      width: options.width,
      height: options.height,
      faceDestPath,
      faceWidth: options.faceWidth,
      faceHeight: options.faceHeight,
      avatar: data.avatars[0].avatar
    }
  }

  async function generateAvatars(
    addresses: string[],
    _options?: OptionsGenerateAvatars
  ): Promise<AvatarGenerationResult[]> {
    // default values
    const options = {
      ..._options
    }

    return new Promise(async (resolve, reject) => {
      // unique number for temp files
      executionNumber += 1

      // create directory if exists
      if (options.outputPath && !existsSync(options.outputPath)) {
        mkdirSync(options.outputPath)
      }

      console.log('godot', 'generateAvatars', addresses, options)

      const promises = addresses.map((address) => preparePayload(address, options))
      console.log('promises', promises.length)
      const payloads: GodotAvatarPayload[] = await Promise.all(promises)
      console.log('payloads', payloads)

      const results: AvatarGenerationResult[] = payloads.map((payload) => {
        return {
          avatarPath: payload.destPath,
          facePath: payload.faceDestPath
        }
      })

      const output = {
        baseUrl: `${peerUrl}/content`,
        payload: payloads
      }
      const avatarDataPath = `temp-avatars-${executionNumber}.json`
      await writeFile(avatarDataPath, JSON.stringify(output))
      const explorerPath = process.env.EXPLORER_PATH || '.'
      const command = `${explorerPath}/decentraland.godot.client.x86_64 --rendering-driver opengl3 --avatar-renderer --avatars ${avatarDataPath}`
      console.log('explorerPath', explorerPath, 'display', process.env.DISPLAY, 'command', command)
      const areFilesCreated = (payload: any): boolean => {
        for (const avatar of payload) {
          if (!existsSync(avatar.destPath)) {
            return false
          }
        }
        return true
      }

      exec(command, { timeout: 30_000 }, (error, stdout, stderr) => {
        console.log('exec', 'error', error, 'stdout', stdout, 'stderr', stderr)
        if (error) {
          if (!areFilesCreated(payloads)) {
            console.error(error, stderr)
            reject(error)
          }
        }
        if (stderr) {
          if (!areFilesCreated(payloads)) {
            console.error(stderr)
            reject(error)
          }
        }
        rmSync(avatarDataPath)
        resolve(results)
      })
    })
  }

  async function getImages(address: string) {
    const timer = metrics.startTimer('snapshot_generation_duration_seconds', { image: 'both' })
    let status = 'success'
    try {
      console.time('screenshot for both')
      try {
        const results = await generateAvatars([address], {
          outputPath: 'output',
          width: 256,
          height: 512,
          faceWidth: 256,
          faceHeight: 256
        })

        const [body, face] = await Promise.all([fs.readFile(results[0].avatarPath), fs.readFile(results[0].facePath)])
        return {
          body,
          face
        }
      } finally {
        console.timeEnd('screenshot for both')
      }
    } catch (error) {
      console.error(error)
      status = 'error'
      throw error
    } finally {
      timer.end({ status })
    }
  }

  return {
    getImages
  }
}
