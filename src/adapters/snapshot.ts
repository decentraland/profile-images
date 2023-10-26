import sharp from 'sharp'
import { AppComponents, Snapshot } from '../types'

export function createSnapshotComponent({ config, browser }: Pick<AppComponents, 'browser' | 'config'>): Snapshot {
  async function getBaseUrl() {
    const host = await config.requireString('HTTP_SERVER_HOST')
    const port = await config.requireString('HTTP_SERVER_PORT')
    return `http://${host}:${port}/index.html`
  }

  async function getBody(address: string) {
    const baseUrl = await getBaseUrl()
    const url = `${baseUrl}?profile=${address}&disableBackground&disableAutoRotate&disableFadeEffect`
    return await browser.takeScreenshot(url, '.is-loaded', {
      width: 512,
      height: 1024
    })
  }

  async function getFace(address: string) {
    const baseUrl = await getBaseUrl()
    const url = `${baseUrl}?profile=${address}&disableBackground&disableAutoRotate&disableAutoCenter&disableFadeEffect&disableDefaultEmotes&zoom=60&offsetY=1.25`
    const screenshot = await browser.takeScreenshot(url, '.is-loaded', {
      width: 512,
      height: 1024 + 512
    })
    return sharp(screenshot).extract({ top: 0, left: 0, width: 1024, height: 1024 }).toBuffer()
  }

  return {
    getBody,
    getFace
  }
}
