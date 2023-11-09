const puppeteer = require('puppeteer')

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/google-chrome-stable',
    args: [
      // '--disable-gpu',
      // '--disable-dev-shm-usage',
      // '--disable-setuid-sandbox',
      '--no-sandbox'
    ],
    env: {
      DISPLAY: ":10.0"
    }
  })
  console.log('browser')
  const page = await browser.newPage()
  console.log('page')
  await page.goto('https://google.com')
  console.log('google')
}

void main()