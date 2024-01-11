import { exec } from 'child_process'
import { writeFile } from 'fs/promises'
import { existsSync, mkdirSync, rmSync } from 'fs'
import path from 'path'
import { AppComponents, AvatarGenerationResult, GodotComponent } from '../types'
import { Entity } from '@dcl/schemas'

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

const profileWithAssetUrns = (profile: any) => {
  return {
    ...profile,
    metadata: {
      ...profile.metadata,
      avatars: profile.metadata.avatars.map((av: any) => ({
        ...av,
        avatar: {
          ...av.avatar,
          wearables: av.avatar.wearables.map((wearable: any) => {
            const { urn } = splitUrnAndTokenId(wearable)
            return urn
          })
        }
      }))
    }
  }
}

export async function createGodotSnapshotComponent({
  config,
  logs,
  metrics,
  fetch
}: Pick<AppComponents, 'config' | 'logs' | 'metrics' | 'fetch'>): Promise<GodotComponent> {
  const logger = logs.getLogger('godot-snapshot')
  const peerUrl = await config.requireString('PEER_URL')
  const explorerPath = process.env.EXPLORER_PATH || '.'

  let executionNumber = 0

  function run(entities: string[], options: OptionsGenerateAvatars): Promise<AvatarGenerationResult[]> {
    return new Promise(async (resolve, reject) => {
      logger.debug(`Running godot to process ${entities.length}: ${JSON.stringify(entities)}`)
      // unique number for temp files
      executionNumber += 1

      // create directory if exists
      if (options.outputPath && !existsSync(options.outputPath)) {
        mkdirSync(options.outputPath)
      }

      const response = await fetch.fetch(`${peerUrl}/content/entities/active`, {
        method: 'POST',
        body: JSON.stringify({ ids: entities })
      })
      const profiles: Entity[] = (await response.json()).map(profileWithAssetUrns)

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
      // logger.debug(`output: ${JSON.stringify(output)}`)

      const avatarDataPath = `temp-avatars-${executionNumber}.json`

      await writeFile(avatarDataPath, JSON.stringify(output))
      const command = `${explorerPath}/decentraland.godot.client.x86_64 --rendering-driver opengl3 --avatar-renderer --avatars ${avatarDataPath}`
      logger.debug(`about to exec, explorerPath: ${explorerPath}, display: ${process.env.DISPLAY}, command: ${command}`)

      const timer = metrics.startTimer('snapshot_generation_duration_seconds', { profiles: payloads.length })
      console.time(`screenshots for ${entities.length} entities`)
      exec(command, { timeout: 30_000 }, (error, _stdout, _stderr) => {
        rmSync(avatarDataPath)

        if (error) {
          timer.end({ status: 'error' })
          console.timeEnd(`screenshots for ${entities.length} entities`)
          return reject(error)
        }

        for (const result of results) {
          if (existsSync(result.avatarPath) && existsSync(result.facePath)) {
            result.status = true
          }
        }

        console.timeEnd(`screenshots for ${entities.length} entities`)
        timer.end({ status: 'success' })
        resolve(results)
      })
    })
  }

  async function generateImages(entities: string[]): Promise<AvatarGenerationResult[]> {
    return await run(entities, {
      outputPath: 'output',
      width: 256,
      height: 512,
      faceWidth: 256,
      faceHeight: 256
    })
  }

  return {
    generateImages
  }
}
