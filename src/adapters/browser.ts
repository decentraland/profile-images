import puppeteer, { Browser as PuppeteerBrowser, Page } from 'puppeteer'
import { AppComponents, Browser } from '../types'

export type ViewPort = {
  width: number
  height: number
}

export async function createBrowser(_: Pick<AppComponents, 'config'>): Promise<Browser> {
  let browser: PuppeteerBrowser | undefined
  let page: Page | undefined

  async function getBrowser() {
    if (!browser) {
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

  async function takeScreenshot(url: string, selector: string, viewport: ViewPort) {
    // page.on('console', (msg) => console.log('PAGE LOG:', msg.text()))

    try {
      await getBrowser()

      await page!.setViewport({
        deviceScaleFactor: 2,
        ...viewport
      })
      await page!.goto(url)
      // await page.waitForNetworkIdle({ timeout: 20_000 })
      // await sleep({ timeout: 20_000 })
      const container = await page!.waitForSelector(selector, { timeout: 30_000 })
      if (!container) {
        throw new Error('Cannot resolve selected element')
      }
      // if (!container) {
      //   throw new Error(`Could not generate screenshot`)
      // }
      const buffer = await page!.screenshot({
        encoding: 'binary',
        omitBackground: true
      })

      return buffer as Buffer
    } catch (error) {
      console.error(error)
      await reset()
      throw error
    }
  }

  async function close() {
    if (browser) {
      await page?.close()
      await browser.close()
    }
    page = undefined
    browser = undefined
  }

  async function reset() {
    try {
      await close()
    } catch (error) {
      console.error(`Could not close browser`, error)
    }
    browser = undefined
  }

  return { takeScreenshot }
}
