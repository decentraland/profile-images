import { exec } from 'child_process'
import { writeFile } from 'fs/promises'
import { existsSync, mkdirSync, rmSync } from 'fs'
import path from 'path'
import { AppComponents, AvatarGenerationResult, GodotComponent } from '../types'

import { Entity } from '@dcl/schemas'

let executionNumber = 0

type OptionsGenerateAvatars = Partial<{
  outputPath: string
  faceWidth: number
  faceHeight: number
  width: number
  height: number
}>

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

export async function createGodotSnapshotComponent({
  config,
  metrics
}: Pick<AppComponents, 'config' | 'metrics'>): Promise<GodotComponent> {
  const peerUrl = await config.requireString('PEER_URL')

  function run(entities: string[], options: OptionsGenerateAvatars): Promise<AvatarGenerationResult[]> {
    return new Promise(async (resolve, reject) => {
      console.log(`Running godot to process ${entities.length}`)
      console.log(`Running godot to process ${JSON.stringify(entities)}`)
      // unique number for temp files
      executionNumber += 1

      // create directory if exists
      if (options.outputPath && !existsSync(options.outputPath)) {
        mkdirSync(options.outputPath)
      }

      const response = await fetch(`${peerUrl}/content/entities/active`, {
        method: 'POST',
        body: JSON.stringify({ ids: entities })
      })
      const profiles: Entity[] = await response.json()

      const payloads: GodotAvatarPayload[] = []
      const results: AvatarGenerationResult[] = []

      for (const entity of entities) {
        const profile = profiles.find((p) => p.id === entity)
        const destPath = path.join(options.outputPath ?? '', `${entity}.png`)
        const faceDestPath = path.join(options.outputPath ?? '', `${entity}_face.png`)
        if (profile) {
          payloads.push({
            entity,
            destPath,
            width: options.width,
            height: options.height,
            faceDestPath,
            faceWidth: options.faceWidth,
            faceHeight: options.faceHeight,
            avatar: profile.metadata.avatars[0].avatar
          })
        }
        results.push({
          status: false,
          entity,
          avatarPath: destPath,
          facePath: faceDestPath
        })
      }

      if (payloads.length === 0) {
        return resolve(results)
      }

      const output = {
        baseUrl: `${peerUrl}/content`,
        payload: payloads
      }

      const avatarDataPath = `temp-avatars-${executionNumber}.json`
      await writeFile(avatarDataPath, JSON.stringify(output))
      const explorerPath = process.env.EXPLORER_PATH || '.'
      const command = `${explorerPath}/decentraland.godot.client.x86_64 --rendering-driver opengl3 --avatar-renderer --avatars ${avatarDataPath}`
      console.log('explorerPath', explorerPath, 'display', process.env.DISPLAY, 'command', command)

      exec(command, { timeout: 30_000 }, (error, stdout, stderr) => {
        console.log('exec', 'error', error, 'stdout', stdout, 'stderr', stderr)
        rmSync(avatarDataPath)

        if (error) {
          // console.error(error, stderr)
          return reject(error)
        }

        for (const result of results) {
          if (existsSync(result.avatarPath) && existsSync(result.facePath)) {
            result.status = true
          }
        }

        resolve(results)
      })
    })
  }

  async function generateImages(entities: string[]): Promise<AvatarGenerationResult[]> {
    const timer = metrics.startTimer('snapshot_generation_duration_seconds', { image: 'both' })
    let status = 'success'
    try {
      console.time('screenshots')
      try {
        return await run(entities, {
          outputPath: 'output',
          width: 256,
          height: 512,
          faceWidth: 256,
          faceHeight: 256
        })
      } finally {
        console.timeEnd('screenshots')
      }
    } catch (error) {
      console.error('process execution error', error)
      status = 'error'
      throw error
    } finally {
      timer.end({ status })
    }
  }

  return {
    generateImages
  }
}
