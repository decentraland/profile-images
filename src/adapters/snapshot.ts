import { AppComponents, Snapshot } from '../types'
import puppeteer, { Browser as PuppeteerBrowser, Page } from 'puppeteer'

export async function createSnapshotComponent({
  config,
  metrics
}: Pick<AppComponents, 'config' | 'metrics'>): Promise<Snapshot> {
  const host = await config.requireString('HTTP_SERVER_HOST')
  const port = await config.requireString('HTTP_SERVER_PORT')
  const browserExecutablePath = await config.requireString('BROWSER_EXECUTABLE_PATH')
  const baseUrl = `http://${host}:${port}/index.html`

  let browser: PuppeteerBrowser | undefined
  let page: Page | undefined

  async function getPage(): Promise<Page> {
    if (!browser) {
      console.log('Launching browser')
      browser = await puppeteer.launch({
        headless: 'new',
        executablePath: browserExecutablePath,
        args: ['--disable-dev-shm-usage', '--disable-setuid-sandbox']
      })
      page = await browser.newPage()
      // NOTE: enable this to print console messages
      // page.on('console', (msg) => console.log('PAGE LOG:', msg.text()))
      console.log('Launching browser: ok')
    }
    return page!
  }

  async function reset() {
    try {
      if (browser) {
        await page?.close()
        await browser.close()
      }
    } catch (error) {
      console.error(`Could not close browser`, error)
    }
    page = undefined
    browser = undefined
  }

  async function getBody(address: string) {
    const timer = metrics.startTimer('snapshot_generation_duration_seconds', { image: 'body' })
    let status = 'success'
    try {
      const page = await getPage()
      await page.setViewport({
        deviceScaleFactor: 2,
        width: 512,
        height: 1024
      })
      await page.goto(
        `${baseUrl}?profile=${address}&disableBackground&disableAutoRotate&disableFadeEffect&disableDefaultEmotes`
      )
      const container = await page.waitForSelector('.is-loaded', { timeout: 30_000 })
      if (!container) {
        throw new Error('Cannot resolve selected element')
      }
      const buffer = await page.screenshot({
        encoding: 'binary',
        omitBackground: true
      })

      return buffer as Buffer
    } catch (error) {
      console.error(error)
      status = 'error'
      await reset()
      throw error
    } finally {
      timer.end({ status })
    }
  }

  async function getFace(address: string) {
    const timer = metrics.startTimer('snapshot_generation_duration_seconds', { image: 'face' })
    let status = 'success'
    try {
      const page = await getPage()
      await page.setViewport({
        deviceScaleFactor: 2,
        width: 512,
        height: 1024 + 512
      })

      await page.goto(
        `${baseUrl}?profile=${address}&disableBackground&disableAutoRotate&disableAutoCenter&disableFadeEffect&disableDefaultEmotes&zoom=60&offsetY=1.25`
      )
      const container = await page.waitForSelector('.is-loaded', { timeout: 30_000 })
      if (!container) {
        throw new Error('Cannot resolve selected element')
      }
      const buffer = await page.screenshot({
        encoding: 'binary',
        omitBackground: true,
        clip: {
          x: 0,
          y: 0,
          width: 512,
          height: 512
        }
      })

      return buffer as Buffer
    } catch (e: any) {
      console.log(e)
      status = 'error'
      await reset()
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
