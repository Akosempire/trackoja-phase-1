// Register acceptance checks against the preview harness (port 4231).
// node tests/register-acceptance/acceptance.cjs [outDir]
const { chromium } = require('playwright');
const out = process.argv[2] || 'register-shots';
const base = 'http://localhost:4231/tests/visual/app.html?path=/sales/checkout';
const fs = require('fs'); fs.mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' – ' + detail : ''}`); };

async function scan(page, code) { for (const ch of code) await page.keyboard.press(ch, { delay: 0 }); await page.keyboard.press('Enter'); }

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  // ---- desktop: zero mouse ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('desktop: ' + e.message));
    let clicks = 0; await page.exposeFunction('__click', () => { clicks++; });
    await page.addInitScript(() => window.addEventListener('mousedown', () => window.__click(), true));
    await page.goto(base); await page.waitForSelector('input[aria-label^="Scan or search"]');
    await page.waitForTimeout(300);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || '');
    check('desktop: search focused on load', focused.startsWith('Scan or search'), focused);
    await page.screenshot({ path: `${out}/desktop-empty.png` });
    const codes = ['5449000000996', '6151100030017', '6151100120015', '8712100850032', '6008679000123'];
    for (const c of codes) { await scan(page, c); await page.waitForTimeout(60); }
    const lines = await page.locator('ul[aria-label="Items in this sale"] > li').count();
    check('desktop: 5 scans → 5 lines', lines === 5, `${lines} lines`);
    const searchVal = await page.inputValue('input[aria-label^="Scan or search"]');
    check('desktop: search cleared after scan', searchVal === '', JSON.stringify(searchVal));
    await page.screenshot({ path: `${out}/desktop-cart.png` });
    await page.keyboard.press('F4');
    await page.waitForTimeout(100);
    const cashFocused = await page.evaluate(() => document.activeElement?.id);
    check('desktop: F4 focuses cash field', cashFocused === 'amount-tendered', cashFocused);
    await page.keyboard.type('5000');
    await page.waitForTimeout(100);
    const shortTxt = await page.locator('text=/short$/').first().textContent().catch(() => '');
    // total = 400+300+2500+3200+900 = 7300 → 5000 is short; type 10000 instead to complete
    check('desktop: ₦5,000 on ₦7,300 shows short', /2,300/.test(shortTxt || ''), shortTxt || 'none');
    await page.keyboard.press('F10'); await page.waitForTimeout(200);
    const stillCart = await page.locator('ul[aria-label="Items in this sale"] > li').count();
    check('desktop: F10 blocked while short', stillCart === 5);
    await page.keyboard.press('Control+a'); await page.keyboard.type('10000');
    await page.screenshot({ path: `${out}/desktop-change.png` });
    await page.keyboard.press('F10');
    await page.waitForSelector('text=Change due', { timeout: 3000 });
    const change = await page.locator('section[aria-label="Current sale"] [role="status"]').first().textContent();
    check('desktop: success panel with change ₦2,700', /2,700/.test(change || ''), (change || '').slice(0, 80));
    await page.screenshot({ path: `${out}/desktop-success.png` });
    // next scan starts a new sale
    await scan(page, '5449000000996'); await page.waitForTimeout(100);
    const after = await page.locator('ul[aria-label="Items in this sale"] > li').count();
    const success = await page.locator('text=Sale complete').count();
    check('desktop: next scan starts new sale', after === 1 && success === 0, `${after} line(s)`);
    // Enter-new-sale path
    await page.keyboard.press('F4'); await page.keyboard.press('F10'); await page.waitForSelector('text=New sale');
    await page.keyboard.press('Enter'); await page.waitForTimeout(150);
    const ready = await page.locator('text=Ready for the next customer').count();
    const foc2 = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || '');
    check('desktop: Enter → new sale ready, search focused', ready === 1 && foc2.startsWith('Scan or search'), foc2);
    check('desktop: zero mouse clicks', clicks === 0, `${clicks}`);
    // burst while focus is elsewhere (in the customer search)
    await page.keyboard.press('/');
    await scan(page, '6001087000555'); await page.waitForTimeout(80);
    await page.keyboard.press('Escape');
    // unknown code
    await scan(page, '9999999999999'); await page.waitForTimeout(80);
    const unknown = await page.locator('text=No product with code').count();
    check('desktop: unknown code → inline message', unknown === 1);
    await page.screenshot({ path: `${out}/desktop-unknown.png` });
    // global burst while a different field is focused
    await page.locator('button:has-text("+ Customer")').click();
    await page.waitForTimeout(80);
    await page.locator('input[aria-label="Search customers"]').fill('Bi');
    await scan(page, '5449000000996'); await page.waitForTimeout(120);
    const custVal = await page.inputValue('input[aria-label="Search customers"]');
    const cokeQty = await page.inputValue('input[aria-label="Coca-Cola 50cl quantity"]').catch(() => '');
    check('desktop: burst in another field adds item, field restored', custVal === 'Bi' && cokeQty !== '', `field=${custVal} qty=${cokeQty}`);
    // shortcuts dialog
    await page.keyboard.press('Escape');
    await page.locator('body').click({ position: { x: 600, y: 790 } });
    await page.keyboard.press('?'); await page.waitForTimeout(150);
    check('desktop: ? opens shortcuts', (await page.locator('dialog[open]').count()) === 1);
    await page.screenshot({ path: `${out}/desktop-shortcuts.png` });
    await page.keyboard.press('Escape');
    await ctx.close();
  }

  // ---- split payment ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('split: ' + e.message));
    await page.goto(base); await page.waitForSelector('input[aria-label^="Scan or search"]');
    await scan(page, '8712100850032'); await scan(page, '6151100120015'); // 3200 + 2500 = 5700
    // ₦3,200 + ₦2,500 − ₦200 discount = ₦5,500
    await page.locator('button:has-text("+ Discount")').click();
    await page.locator('label:has-text("Discount") input').fill('200');
    await page.locator('button:has-text("+ Add another payment")').click();
    await page.locator('input[aria-label="Payment 1 amount"]').fill('2000');
    await page.locator('select[aria-label="Payment 2 method"]').selectOption('transfer');
    await page.locator('input[aria-label="Payment 2 amount"]').fill('3000');
    const rem = await page.locator('text=Still to pay').count();
    check('split: shows remaining while short', rem >= 1 && /500/.test(await page.locator('[role=status]:has-text("Still to pay")').first().textContent()));
    await page.locator('input[aria-label="Payment 2 amount"]').fill('3500');
    await page.waitForTimeout(80);
    await page.screenshot({ path: `${out}/desktop-split.png` });
    const btn = page.locator('button:has-text("Complete sale")');
    check('split: complete enabled when covered', await btn.isEnabled());
    await btn.click(); await page.waitForSelector('text=Sale complete');
    const sent = await page.evaluate(() => window.__sales?.at(-1)?.req.payments);
    check('split: ₦2,000 cash + ₦3,500 transfer sent', JSON.stringify(sent) === JSON.stringify([{ method: 'cash', amount: 2000 }, { method: 'transfer', amount: 3500 }]), JSON.stringify(sent));
    await ctx.close();
  }

  // ---- phone 400px ----
  {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 820 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('phone: ' + e.message));
    await page.goto(base); await page.waitForSelector('input[aria-label^="Scan or search"]');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/phone-register.png` });
    for (const name of ['Coca-Cola 50cl', 'Peak Milk Tin 400g', 'Dettol Soap 110g']) await page.locator(`button[aria-label^="${name},"]`).first().tap();
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/phone-cart-bar.png` });
    await page.locator('button:has-text("Charge")').tap();
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/phone-sheet.png` });
    const small = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('button, a, input, select, [role="radio"], [role="tab"]')) {
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility === 'hidden' || el.closest('[aria-hidden="true"]') || el.closest('.hidden') || el.tabIndex === -1 && el.getAttribute('aria-hidden')) continue;
        if (r.bottom < 0 || r.top > innerHeight * 3) continue;
        if (r.height < 43.5 || r.width < 43.5) bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      return bad;
    });
    const chip = page.locator('button[title="Key 3"]');
    await chip.tap();
    await page.locator('button:has-text("Complete sale")').tap();
    await page.waitForSelector('text=Sale complete');
    await page.screenshot({ path: `${out}/phone-success.png` });
    check('phone: 3 items + quick chip + complete', (await page.locator('text=Change due').count()) === 1);
    check('phone: all tap targets ≥ 44px', small.length === 0, small.slice(0, 8).join('; '));
    // back to products: bottom nav visible, scan button not overlapped
    await ctx.close();
  }

  // ---- tablet + till closed ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await ctx.newPage();
    await page.goto(base); await page.waitForSelector('input[aria-label^="Scan or search"]');
    for (const c of ['5449000000996', '8712100850032']) await scan(page, c);
    await page.screenshot({ path: `${out}/tablet-register.png` });
    await page.goto(base + '&till=none'); await page.waitForSelector('text=Open till to start selling');
    check('till closed: inline open-till card', true);
    await page.screenshot({ path: `${out}/tablet-till-closed.png` });
    await ctx.close();
    const dark = await browser.newContext({ viewport: { width: 1366, height: 820 } });
    const p2 = await dark.newPage(); await p2.goto(base + '&theme=dark'); await p2.waitForSelector('input[aria-label^="Scan or search"]');
    for (const c of ['5449000000996', '8712100850032']) await scan(p2, c);
    await p2.screenshot({ path: `${out}/desktop-dark.png` }); await dark.close();
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
