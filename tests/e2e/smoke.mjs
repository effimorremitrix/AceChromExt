/**
 * End-to-end smoke test against a MOCKED ACE host.
 *
 *   npm run build && npm run smoke
 *
 * What it proves, in a real Chromium with the built extension loaded:
 *   1. the manifest loads and the service worker starts;
 *   2. the content script is injected on https://ace.cbp.dhs.gov/* exactly as
 *      the manifest declares - the mock screens are served *from that host*
 *      via request interception, so no manifest change is needed to test;
 *   3. F2 opens the calculator, Enter inserts only the result, Escape does not
 *      touch the field, and an invalid expression is refused;
 *   4. a messy workbook imports, normalizes, and previews correctly;
 *   5. Fill Current Commodity Line and Fill Current Page write the right
 *      values into the right fields, and tint them;
 *   6. the extension page CSP blocks eval, inline script, and outbound fetch;
 *   7. Clear Imported Data empties session storage.
 *
 * It never touches the real ACE portal: every request to the ACE host is
 * fulfilled locally from tests/fixtures/.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const dist = join(root, 'dist');
const fixtures = join(root, 'tests', 'fixtures');

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('playwright-core is not installed. Run: npm install');
  process.exit(1);
}

if (!existsSync(join(dist, 'manifest.json'))) {
  console.error('dist/ is missing. Run: npm run build');
  process.exit(1);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browsers && existsSync(join(browsers, 'chromium', 'chrome-linux', 'chrome'))) {
    return join(browsers, 'chromium', 'chrome-linux', 'chrome');
  }
  return null;
}

const executablePath = findChrome();
if (!executablePath) {
  console.error('No Chrome/Chromium found. Set CHROME_PATH to a Chrome binary.');
  process.exit(1);
}

// ---------------------------------------------------------------- assertions

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}
function checkTrue(label, actual) {
  check(label, actual === true, true);
}

// ------------------------------------------------------------------- fixture

/** A deliberately messy workbook: every value needs normalizing. */
function writeMessyWorkbook(path) {
  const rows = [
    ['Line', 'ScheduleB', 'CommodityDescription', 'Quantity1', 'UOM1', 'Origin', 'ValueOfGoods', 'ShippingWeight', 'ECCN', 'LicenseCode', 'InvoiceNumber', 'InvoiceDate', 'CustomerName', 'Destination', 'PONumber', 'FreightTerms'],
    [1, '0802120000', 'SHELLED ALMONDS', 79833, 'kilograms', 'USA', '$633,600.00', '176,000 lb', 'EAR99', 'c33', 'INV-20451', '3/12/2026', 'MEDITERRANEAN FOODS LTD', 'Israel', 'PO-88213', 'CIF'],
    [2, '0813.20.0000', 'DRIED PRUNES', 12400, 'KG', 'D', 48360, 12850, 'EAR99', 'C33', '', '', '', '', '', ''],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Shipment');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

const workbookPath = join(mkdtempSync(join(tmpdir(), 'ace-smoke-')), 'messy.xlsx');
writeMessyWorkbook(workbookPath);

// ---------------------------------------------------------------------- run

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ace-profile-')), {
  executablePath,
  headless: true,
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    // Branded Chrome 137+ ignores --load-extension unless this feature is
    // switched off. Chrome for Testing does not need it, and an unknown
    // feature name is harmless, so it is always passed.
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--no-sandbox',
  ],
});

try {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    try {
      worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
    } catch {
      console.error(
        [
          '',
          'The extension never started its service worker, which means Chrome did not load it.',
          `  Chrome:    ${executablePath}`,
          `  Extension: ${dist}`,
          '',
          'Most likely causes:',
          '  1. Branded Google Chrome 137 or newer, which disables the --load-extension',
          '     switch. Use Chrome for Testing instead - that is what CI pins:',
          '     https://googlechromelabs.github.io/chrome-for-testing/',
          '  2. dist/ is not a valid unpacked extension. Re-run: npm run build',
        ].join('\n'),
      );
      process.exit(1);
    }
  }
  const extensionId = new URL(worker.url()).host;
  console.log(`extension loaded: ${extensionId}\n`);

  let screen = 'ace-commodities.html';
  await context.route('https://ace.cbp.dhs.gov/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>ACE Filing</title></head><body>${readFileSync(join(fixtures, screen), 'utf8')}</body></html>`,
    }),
  );

  const pageErrors = [];
  const ace = await context.newPage();
  ace.on('pageerror', (error) => pageErrors.push(`ace: ${error.message}`));
  await ace.goto('https://ace.cbp.dhs.gov/ace/filing/commodities', { waitUntil: 'load' });
  await ace.waitForTimeout(1200);

  // --- 1. calculator ----------------------------------------------------
  console.log('--- F2 calculator ---');
  await ace.focus('#shippingWeight');
  await ace.keyboard.press('F2');
  await ace.waitForTimeout(300);
  checkTrue(
    'F2 opens the calculator beside the field',
    await ace.evaluate(() => !!document.querySelector('#ace-helper-calculator-host')?.shadowRoot?.querySelector('input.expr')),
  );

  await ace.keyboard.type('(12000 + 3500) / 2');
  await ace.waitForTimeout(200);
  check(
    'the result is shown as it is typed',
    await ace.evaluate(() => document.querySelector('#ace-helper-calculator-host').shadowRoot.querySelector('.result').textContent),
    '= 7,750',
  );

  await ace.keyboard.press('Enter');
  await ace.waitForTimeout(200);
  check('Enter inserts only the result, with no separators', await ace.inputValue('#shippingWeight'), '7750');
  checkTrue('the calculator closes after inserting', await ace.evaluate(() => !document.querySelector('#ace-helper-calculator-host')));

  await ace.fill('#valueOfGoods', '999');
  await ace.focus('#valueOfGoods');
  await ace.keyboard.press('F2');
  await ace.keyboard.type('+ 1');
  await ace.keyboard.press('Escape');
  await ace.waitForTimeout(200);
  check('Escape leaves the field untouched', await ace.inputValue('#valueOfGoods'), '999');

  await ace.focus('#quantity1');
  await ace.keyboard.press('F2');
  await ace.keyboard.type('10 / 0');
  await ace.waitForTimeout(200);
  check(
    'division by zero is reported',
    await ace.evaluate(() => document.querySelector('#ace-helper-calculator-host').shadowRoot.querySelector('.result').textContent),
    'Cannot divide by zero.',
  );
  await ace.keyboard.press('Enter');
  await ace.waitForTimeout(200);
  check('Enter does not insert an invalid result', await ace.inputValue('#quantity1'), '');
  await ace.keyboard.press('Escape');
  await ace.fill('#valueOfGoods', '');
  await ace.fill('#shippingWeight', '');

  // --- 2. import --------------------------------------------------------
  console.log('\n--- Excel import ---');
  const panel = await context.newPage();
  panel.on('pageerror', (error) => pageErrors.push(`panel: ${error.message}`));
  panel.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(`panel console: ${message.text()}`);
  });
  await panel.goto(`chrome-extension://${extensionId}/panel.html`, { waitUntil: 'load' });
  await panel.waitForTimeout(600);

  // The panel opens on Import when nothing is loaded. If a previous run left
  // data in the session, it opens on Overview instead - so go to Import.
  if (!(await panel.locator('#file-input').count())) {
    await panel.click('text=Import');
    await panel.waitForTimeout(300);
  }

  await panel.setInputFiles('#file-input', workbookPath);
  await panel.waitForTimeout(1200);

  const status = (await panel.textContent('#status'))?.trim() ?? '';
  checkTrue('two lines are imported', status.includes('Imported 2 line(s)'));
  checkTrue('the status says nothing has been written yet', status.includes('Nothing has been written to ACE yet'));

  const preview = (await panel.textContent('body')) ?? '';
  checkTrue('the preview maps rows to ACE commodity lines', preview.includes('ACE Commodity Line 1') && preview.includes('ACE Commodity Line 2'));
  checkTrue('the preview shows the lb -> kg transformation', preview.includes('lb x 0.45359237'));
  checkTrue('the preview shows the converted weight', preview.includes('79,832 kg'));
  checkTrue('the preview shows the original alongside it', preview.includes('176,000 lb'));
  checkTrue('Schedule B is reformatted', preview.includes('0802.12.0000'));
  checkTrue('"USA" becomes the D origin indicator', preview.includes('-> D (domestic)'));
  checkTrue('"Israel" becomes IL', preview.includes('-> IL'));

  // --- 3. fill a commodity line ----------------------------------------
  console.log('\n--- Fill Current Commodity Line ---');
  await panel.click('text=Fill ACE');
  await panel.waitForTimeout(500);
  checkTrue('the panel finds the ACE tab', ((await panel.textContent('body')) ?? '').includes('ACE tab:'));

  // Trip-wire: if anything ever clicks ACE's Save Line, this records it.
  await ace.evaluate(() => {
    window.__aceHelperClickedSave = false;
    document.getElementById('saveLine')?.addEventListener('click', () => {
      window.__aceHelperClickedSave = true;
    });
  });

  await panel.click('button:has-text("Fill Current Commodity Line")');
  await panel.waitForTimeout(1000);

  check(
    'the ACE line details form is populated',
    await ace.evaluate(() => ({
      scheduleB: document.getElementById('scheduleBNumber').value,
      description: document.getElementById('commodityDescription').value,
      quantity1: document.getElementById('quantity1').value,
      uom1: document.getElementById('unitOfMeasure1').value,
      origin: document.getElementById('originOfGoods').value,
      value: document.getElementById('valueOfGoods').value,
      weight: document.getElementById('shippingWeight').value,
      eccn: document.getElementById('eccn').value,
      license: document.getElementById('licenseCode').value,
    })),
    {
      scheduleB: '0802.12.0000',
      description: 'SHELLED ALMONDS',
      quantity1: '79833',
      uom1: 'KG',
      origin: 'D',
      value: '633600.00',
      weight: '79832',
      eccn: 'EAR99',
      license: 'C33',
    },
  );

  const tints = await ace.evaluate(() => ({
    transformed: document.getElementById('shippingWeight').style.backgroundColor,
    plain: document.getElementById('commodityDescription').style.backgroundColor,
  }));
  checkTrue('a transformed field is tinted yellow', tints.transformed === 'rgb(255, 247, 224)');
  checkTrue('a plainly copied field is tinted green', tints.plain === 'rgb(230, 246, 230)');

  check('ACE Save Line was not clicked', await ace.evaluate(() => window.__aceHelperClickedSave), false);

  // --- 4. fill the shipment step ---------------------------------------
  console.log('\n--- Fill Current Page (shipment step) ---');
  screen = 'ace-shipment.html';
  await ace.goto('https://ace.cbp.dhs.gov/ace/filing/shipment', { waitUntil: 'load' });
  await ace.waitForTimeout(1000);
  await panel.click('.link-button');
  await panel.waitForTimeout(600);
  checkTrue('the shipment step is detected', ((await panel.textContent('.page-chip')) ?? '').includes('Step 1: Shipment'));

  await panel.click('button:has-text("Fill Current Page")');
  await panel.waitForTimeout(900);
  check(
    'the shipment form is populated',
    await ace.evaluate(() => ({
      reference: document.getElementById('shipmentReferenceNumber').value,
      exportDate: document.getElementById('estimatedExportDate').value,
      po: document.getElementById('poNumber').value,
      destination: document.getElementById('countryOfUltimateDestination').value,
      incoTerms: document.getElementById('inCoTerms').value,
    })),
    { reference: 'INV-20451', exportDate: '03/12/2026', po: 'PO-88213', destination: 'IL', incoTerms: 'CIF' },
  );

  // --- 4b. Phase 3 screens ---------------------------------------------
  console.log('\n--- overview, mapping status, diagnostics, calculator ---');

  await panel.click('text=Overview');
  await panel.waitForTimeout(400);
  const overview = (await panel.textContent('body')) ?? '';
  checkTrue('the overview names the invoice', overview.includes('INV-20451'));
  checkTrue('the overview names the customer', overview.includes('MEDITERRANEAN FOODS LTD'));
  checkTrue('the overview reports how many ACE fields are mapped', /of \d+ ACE fields mapped/.test(overview));
  checkTrue('the overview offers the five actions', overview.includes('Fill Current Page') && overview.includes('Clear Data'));

  await panel.click('text=Mapping');
  await panel.waitForTimeout(400);
  await panel.click('button:has-text("Check against the open ACE page")');
  await panel.waitForTimeout(1200);
  const mapping = (await panel.textContent('body')) ?? '';
  checkTrue('the mapping screen shows the source', mapping.includes('Source'));
  checkTrue('the mapping screen shows the ACE selector', mapping.includes('ACE selector'));
  checkTrue('the mapping screen shows the transformation', mapping.includes('0.45359237'));
  checkTrue('the mapping screen marks a resolved field READY', mapping.includes('READY'));
  checkTrue('checking the page writes nothing', ((await panel.textContent('#status')) ?? '').includes('Nothing was written'));

  await panel.click('text=Calculator');
  await panel.waitForTimeout(300);
  await panel.fill('#calc-input', '20 * 4');
  await panel.click('button:has-text("Calculate")');
  await panel.waitForTimeout(300);
  checkTrue('the panel calculator works on its own', ((await panel.textContent('.calc-output')) ?? '').includes('80'));

  await panel.click('text=Diagnostics');
  await panel.waitForTimeout(400);
  const diagnostics = (await panel.textContent('body')) ?? '';
  checkTrue('the session log recorded the import', diagnostics.includes('Session log') && diagnostics.includes('import'));
  checkTrue('the session log recorded a fill', diagnostics.includes('fill'));
  checkTrue('the selector editor is available', diagnostics.includes('ACE selectors'));
  checkTrue('diagnostics can be copied and exported', diagnostics.includes('Copy diagnostics') && diagnostics.includes('Export diagnostics'));
  checkTrue('the log says it is not uploaded', diagnostics.includes('Nothing here is uploaded'));

  // --- 5. CSP -----------------------------------------------------------
  // Everything up to here must have run without a single page error. The CSP
  // probes below deliberately trip violations, which Chrome logs as errors, so
  // the clean-run assertion is made here rather than at the end.
  check('no page errors during normal use', pageErrors, []);

  console.log('\n--- extension page CSP ---');
  const csp = await panel.evaluate(async () => {
    const result = {};
    try {
      await fetch('https://example.com/');
      result.externalFetch = 'allowed';
    } catch {
      result.externalFetch = 'blocked';
    }
    // Inline script injection is the reliable in-page probe for script-src.
    // (eval is not probed here: an automation driver may evaluate in an
    // isolated world where the page CSP does not apply. That script-src
    // carries no 'unsafe-eval' is asserted against the manifest instead, and
    // tests/invariants.test.ts asserts no eval exists in the source at all.)
    const script = document.createElement('script');
    script.textContent = 'window.__injected = true';
    document.head.appendChild(script);
    result.inlineScript = window.__injected ? 'executed' : 'blocked';
    return result;
  });
  check('outbound fetch is blocked', csp.externalFetch, 'blocked');
  check('inline script injection is blocked', csp.inlineScript, 'blocked');

  const manifestCsp = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')).content_security_policy.extension_pages;
  checkTrue("the manifest CSP has no 'unsafe-eval'", !manifestCsp.includes('unsafe-eval'));
  checkTrue("the manifest CSP pins connect-src to 'none'", manifestCsp.includes("connect-src 'none'"));

  // --- 6. clear ---------------------------------------------------------
  console.log('\n--- Clear Imported Data ---');
  await panel.click('text=Import');
  await panel.waitForTimeout(400);
  await panel.click('button:has-text("Clear Imported Data")');
  await panel.waitForTimeout(600);
  check('session storage is empty afterwards', await panel.evaluate(async () => Object.keys(await chrome.storage.session.get(null))), []);
} finally {
  await context.close();
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
