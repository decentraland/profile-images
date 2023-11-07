import sharp from 'sharp'
import { AppComponents, Snapshot } from '../types'

export async function createSnapshotComponent({
  browser,
  config,
  metrics
}: Pick<AppComponents, 'browser' | 'config' | 'metrics'>): Promise<Snapshot> {
  const host = await config.requireString('HTTP_SERVER_HOST')
  const port = await config.requireString('HTTP_SERVER_PORT')
  const baseUrl = `http://${host}:${port}/index.html`

  async function getBody(address: string) {
    const timer = metrics.startTimer('snapshot_generation_duration_seconds', { image: 'body' })
    let status = 'success'
    try {
      const url = `${baseUrl}?profile=${address}&disableBackground&disableAutoRotate&disableFadeEffect`
      return await browser.takeScreenshot(url, '.is-loaded', {
        width: 512,
        height: 1024
      })
    } catch (e: any) {
      console.log(e)
      status = 'error'
      throw e
    } finally {
      timer.end({ status })
    }
  }

  async function getFace(address: string) {
    const timer = metrics.startTimer('snapshot_generation_duration_seconds', { image: 'face' })
    let status = 'success'
    try {
      const url = `${baseUrl}?profile=${address}&disableBackground&disableAutoRotate&disableAutoCenter&disableFadeEffect&disableDefaultEmotes&zoom=60&offsetY=1.25`
      const screenshot = await browser.takeScreenshot(url, '.is-loaded', {
        width: 512,
        height: 1024 + 512
      })
      return sharp(screenshot).extract({ top: 0, left: 0, width: 1024, height: 1024 }).toBuffer()
    } catch (e: any) {
      console.log(e)
      status = 'error'
      throw e
    } finally {
      timer.end({ status })
    }
  }

  return {
    getBody,
    getFace
  }
}
