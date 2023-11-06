import puppeteer, { Browser } from 'puppeteer'
import sharp from 'sharp'
import { AppComponents, Snapshot } from '../types'

export function createSnapshotComponent({ config }: Pick<AppComponents, 'config'>): Snapshot {
  let browser: Browser | null = null
  async function getBrowser() {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: false
      })
    }
    return browser!
  }
  async function close() {
    if (browser) {
      await browser.close()
    }
    browser = null
  }

  async function getBaseUrl() {
    const host = await config.requireString('HTTP_SERVER_HOST')
    const port = await config.requireString('HTTP_SERVER_PORT')
    return `http://${host}:${port}/index.html`
  }

  async function takeScreenshots(address: string): Promise<[Buffer, Buffer]> {
    const browser = await getBrowser()
    const page = await browser.newPage()
    try {
      // body
      await page.setViewport({
        deviceScaleFactor: 2,
        width: 512,
        height: 1024
      })
      const baseUrl = await getBaseUrl()
      const url = `${baseUrl}?profile=${address}&disableBackground&disableAutoRotate&disableFadeEffect`
      await page.goto(url)
      let container = await page.waitForSelector('.is-loaded')
      if (!container) {
        throw new Error(`Could not generate screenshot`)
      }
      const body = (await container.screenshot({
        encoding: 'binary',
        omitBackground: true
      })) as Buffer

      // face
      await page.setViewport({
        deviceScaleFactor: 2,
        width: 512,
        height: 512 + 1024
      })
      await page.evaluate(() => {
        window.postMessage(
          {
            type: 'update',
            payload: { options: { disableAutoCenter: true, disableDefaultEmotes: true, zoom: 60, offsetY: 1.25 } }
          },
          '*'
        )
      })
      container = await page.waitForSelector('.is-loaded')
      if (!container) {
        throw new Error(`Could not generate screenshot`)
      }
      const face = await sharp(
        await container.screenshot({
          encoding: 'binary',
          omitBackground: true
        })
      )
        .extract({ top: 0, left: 0, width: 1024, height: 1024 })
        .toBuffer()

      // close browser
      await page.close()

      // screenshots
      return [body, face]
    } catch (e) {
      await close()
      throw e
    }
  }

  return {
    takeScreenshots
  }
}
