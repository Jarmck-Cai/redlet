import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const folder = dirname(fileURLToPath(import.meta.url));
await mkdir(join(folder, 'images'), {recursive:true});
const browser = await chromium.launch({headless:true, ...(process.platform === 'win32' ? {channel:'chrome'} : {})});
try {
  const page = await browser.newPage({viewport:{width:1080,height:1440},deviceScaleFactor:1});
  await page.goto(pathToFileURL(join(folder,'cards.html')).href);
  await page.evaluate(()=>document.fonts.ready);
  for (const [id, name] of [['cover','01.png'], ['order','02.png']]) {
    await page.locator('#'+id).screenshot({path:join(folder,'images',name)});
  }
} finally { await browser.close(); }
console.log('Rendered two 1080 x 1440 sample cards.');
