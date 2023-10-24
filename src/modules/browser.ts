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
    const start = new Date().getTime();
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
    const end = new Date().getTime();
    console.log(`Screenshot for ${url} took ${end - start}ms`)
    return buffer as Buffer;
  }
}
