import puppeteer, { Browser as PuppeteerBrowser } from 'puppeteer'
import { Browser } from '../types'

export type ViewPort = {
  width: number
  height: number
}

export function createBrowser(): Browser {
  let browser: PuppeteerBrowser | undefined

  async function getBrowser() {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: 'new'
      })
    }
    return browser!
  }

  async function takeScreenshot(url: string, selector: string, viewport: ViewPort) {
    const start = new Date().getTime()
    const browser = await getBrowser()
    const page = await browser.newPage()
    await page.setViewport({
      deviceScaleFactor: 2,
      ...viewport
    })
    await page.goto(url)
    const container = await page.waitForSelector(selector)
    if (!container) {
      throw new Error(`Could not generate screenshot`)
    }
    const buffer = await container.screenshot({
      encoding: 'binary',
      omitBackground: true
    })
    await page.close()
    const end = new Date().getTime()
    console.log(`Screenshot for ${url} took ${end - start}ms`)
    return buffer as Buffer
  }

  return { takeScreenshot }
}
