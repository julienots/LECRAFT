// Captures multi-résolutions : 16:9, 20:9, petit écran, tablette, portrait (HUD, menu, inventaire).
import { chromium } from 'playwright';
const sizes = [['16x9', 640, 360], ['20x9', 800, 360], ['small', 568, 320], ['tablet', 1280, 800], ['portrait', 412, 915]];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, w, h] of sizes) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true })).newPage();
  await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'LOW', renderDistance: 2, autoQuality: false })));
  await page.goto('http://localhost:4173/');
  await page.waitForFunction(() => window.__lecraft?.state === 'menu');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `screenshots/res-${name}-menu.png` });
  await page.getByText('Nouveau monde').first().click();
  await page.getByText('Créer le monde').click();
  await page.waitForFunction(() => window.__lecraft?.state === 'playing', null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `screenshots/res-${name}-hud.png` });
  await page.evaluate(() => window.__lecraft.openInventory('hand'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `screenshots/res-${name}-inv.png` });
  await page.close();
  console.log('ok', name);
}
await browser.close();
