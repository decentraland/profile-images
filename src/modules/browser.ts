import puppeteer, { Browser as PuppeteerBrowser } from "puppeteer";

export type ViewPort = {
  width: number;
  height: number;
};

export type Clip = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export class Browser {
  private browser?: PuppeteerBrowser;
  constructor() {}
  private async getBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: "new",
      });
    }
    return this.browser!;
  }
  async takeScreenshot(url: string, selector: string, viewport: ViewPort) {
    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      await page.setViewport({
        deviceScaleFactor: 2,
        ...viewport,
      });
      await page.goto(url);
      const container = await page.waitForSelector(selector);
      if (!container) {
        throw new Error(`Could not generate screenshot`);
      }
      const buffer = await container.screenshot({
        encoding: "binary",
        omitBackground: true,
      });
      await page.close();
      return buffer as Buffer;
    } catch (error) {
      await this.reset();
      throw error;
    }
  }

  async close() {
    const browser = await this.getBrowser();
    return browser.close();
  }

  async reset() {
    try {
      await this.close();
    } catch (error) {
      console.error(`Could not close browser`, error);
    }
    delete this.browser;
  }
}
