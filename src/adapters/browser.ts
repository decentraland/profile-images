import puppeteer, { Browser as PuppeteerBrowser } from 'puppeteer'
import { AppComponents, Browser } from '../types'

export type ViewPort = {
  width: number
  height: number
}

export async function createBrowser({ config }: Pick<AppComponents, 'config'>): Promise<Browser> {
  const chromeExecutable = await config.getString('CHROME_EXECUTABLE')
  let browser: PuppeteerBrowser | undefined
  console.log(`Using chrome executable: ${chromeExecutable}`)

  async function getBrowser() {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: 'new',
        executablePath: '/usr/bin/google-chrome-stable',
        args: [
          // '--disable-gpu',
          // '--disable-dev-shm-usage',
          // '--disable-setuid-sandbox',
          '--no-sandbox'
        ],
        env: {
          DISPLAY: ':10.0'
        }
      })
    }
    return browser!
  }

  async function takeScreenshot(url: string, selector: string, viewport: ViewPort) {
    try {
      const browser = await getBrowser()
      const page = await browser.newPage()
      await page.setViewport({
        deviceScaleFactor: 2,
        ...viewport
      })
      await page.goto(url)
      // const container: any = await Promise.race([
      //   page.waitForSelector('body'),
      //   new Promise<void>((resolve) => setTimeout(resolve, 10_000))
      // ])
      // if (!container) {
      //   throw new Error(`Could not generate screenshot`)
      // }
      await page.waitForNetworkIdle()
      const buffer = await page.screenshot({
        encoding: 'binary',
        omitBackground: true
      })
      await page.close()

      return buffer as Buffer
    } catch (error) {
      await reset()
      throw error
    }
  }

  async function close() {
    const browser = await getBrowser()
    return browser.close()
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
