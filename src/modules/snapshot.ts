import sharp from 'sharp'
import { Browser } from './browser'

export class Snapshot {
  private browser = new Browser()
  constructor() {}
  async getBody(address: string) {
    const url = `https://wearable-preview.decentraland.org/?profile=${address}&disableBackground&disableAutoRotate&disableFadeEffect`
    const screenshot = await this.browser.takeScreenshot(url, '.is-loaded', {
      width: 512,
      height: 1024
    })
    return screenshot
  }
  async getFace(address: string) {
    const url = `https://wearable-preview.decentraland.org/?profile=${address}&disableBackground&disableAutoRotate&disableAutoCenter&disableFadeEffect&disableDefaultEmotes&zoom=60&offsetY=1.25`
    const screenshot = await this.browser.takeScreenshot(url, '.is-loaded', {
      width: 512,
      height: 1024 + 512
    })
    return sharp(screenshot).extract({ top: 0, left: 0, width: 1024, height: 1024 }).toBuffer()
  }
}
