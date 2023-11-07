import sharp from 'sharp'
import { AppComponents, Snapshot } from '../types'
import puppeteer, { Browser as PuppeteerBrowser, Page } from 'puppeteer'

export async function createSnapshotComponent({
  config,
  metrics
}: Pick<AppComponents, 'config' | 'metrics'>): Promise<Snapshot> {
  const host = await config.requireString('HTTP_SERVER_HOST')
  const port = await config.requireString('HTTP_SERVER_PORT')
  const baseUrl = `http://${host}:${port}/index.html`

  let browser: PuppeteerBrowser | undefined
  let page: Page | undefined

  async function getBrowser() {
    if (!browser) {
      console.log('Launching browser')
      browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--webgl',
          '--disable-dev-shm-usage',
          '--disable-setuid-sandbox',
          '--no-sandbox',
          '--enable-webgl-draft-extensions'
        ]
      })
      page = await browser.newPage()
    }
    return browser!
  }

  async function closeBrowser() {
    if (browser) {
      console.log('Closing browser')
      await page?.close()
      await browser.close()
    }
    page = undefined
    browser = undefined
  }

  async function takeScreenshots(address: string): Promise<[Buffer, Buffer]> {
    const timer = metrics.startTimer('snapshot_generation_duration_seconds', { image: 'body' })
    let status = 'success'
    await getBrowser()
    try {
      // body
      console.time('body')
      await page!.setViewport({
        deviceScaleFactor: 2,
        width: 512,
        height: 1024
      })
      await page!.goto(`${baseUrl}?profile=${address}&disableBackground&disableAutoRotate&disableFadeEffect`)
      let container = await page!.waitForSelector('.is-loaded')
      if (!container) {
        throw new Error(`Could not generate screenshot`)
      }
      const body = (await container.screenshot({
        encoding: 'binary',
        omitBackground: true
      })) as Buffer
      console.timeEnd('body')

      console.time('face')
      await page!.setViewport({
        deviceScaleFactor: 2,
        width: 512,
        height: 512 + 1024
      })
      await page!.goto(
        `${baseUrl}?profile=${address}&disableBackground&disableAutoRotate&disableAutoCenter&disableFadeEffect&disableDefaultEmotes&zoom=60&offsetY=1.25`
      )
      container = await page!.waitForSelector('.is-loaded')
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
      console.timeEnd('face')

      return [body, face]
    } catch (e: any) {
      console.log(e)
      await closeBrowser()
      status = 'error'
      throw e
    } finally {
      timer.end({ status })
    }
  }

  return {
    takeScreenshots
  }
}
