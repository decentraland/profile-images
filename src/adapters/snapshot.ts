import sharp from 'sharp'
import { AppComponents, Snapshot } from '../types'

export function createSnapshotComponent({ browser }: Pick<AppComponents, 'browser'>): Snapshot {
  async function getBody(address: string) {
    const url = `https://wearable-preview.decentraland.org/?profile=${address}&disableBackground&disableAutoRotate&disableFadeEffect`
    return await browser.takeScreenshot(url, '.is-loaded', {
      width: 512,
      height: 1024
    })
  }

  async function getFace(address: string) {
    const url = `https://wearable-preview.decentraland.org/?profile=${address}&disableBackground&disableAutoRotate&disableAutoCenter&disableFadeEffect&disableDefaultEmotes&zoom=60&offsetY=1.25`
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
