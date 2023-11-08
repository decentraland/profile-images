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
        args: [
          '--autoplay-policy=user-gesture-required',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-client-side-phishing-detection',
          '--disable-component-update',
          '--disable-default-apps',
          '--disable-dev-shm-usage',
          '--disable-domain-reliability',
          '--disable-extensions',
          '--disable-features=AudioServiceOutOfProcess',
          '--disable-hang-monitor',
          '--disable-ipc-flooding-protection',
          '--disable-notifications',
          '--disable-offer-store-unmasked-wallet-cards',
          '--disable-popup-blocking',
          '--disable-print-preview',
          '--disable-prompt-on-repost',
          '--disable-renderer-backgrounding',
          '--disable-setuid-sandbox',
          '--disable-speech-api',
          '--disable-sync',
          '--hide-scrollbars',
          '--ignore-gpu-blacklist',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-default-browser-check',
          '--no-first-run',
          '--no-pings',
          '--no-sandbox',
          '--no-zygote',
          '--password-store=basic',
          '--use-mock-keychain'
        ]
      })
      page = await browser.newPage()
      // NOTE: enable this to print console messages
      // page.on('console', (msg) => console.log('PAGE LOG:', msg.text()))
      console.log('Launching browser: ok')
    }
    return page!
  }

  async function loadPreview(page: Page, url: string, which: string) {
    try {
      console.time(`Loading preview (${which})`)
      await page.goto(url)
      const container = await page.waitForSelector('.is-loaded:not(.has-error)', { timeout: 30_000 })
      if (!container) {
        throw new Error('Cannot resolve selected element')
      }
    } finally {
      console.timeEnd(`Loading preview (${which})`)
    }
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
        width: 256,
        height: 512
      })
      await loadPreview(
        page,
        `${baseUrl}?profile=${address}&disableBackground&disableAutoRotate&disableFadeEffect`,
        'body'
      )
      console.time('screenshot for body')
      try {
        const buffer = await page.screenshot({
          encoding: 'binary',
          omitBackground: true
        })
        return buffer as Buffer
      } finally {
        console.timeEnd('screenshot for body')
      }
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
        width: 256,
        height: 256
      })

      await loadPreview(
        page,
        `${baseUrl}?profile=${address}&disableBackground&disableAutoRotate&disableAutoCenter&disableFadeEffect&disableDefaultEmotes&cameraY=0&offsetY=1.73&zoom=100&zoomScale=2`,
        'face'
      )
      console.time('screenshot for face')
      try {
        const buffer = await page.screenshot({
          encoding: 'binary',
          omitBackground: true
        })
        return buffer as Buffer
      } finally {
        console.timeEnd('screenshot for face')
      }
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
