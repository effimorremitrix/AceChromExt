/**
 * The ACE Export Helper page, as three string constants.
 *
 * Kept in one module so `server.ts` stays about HTTP. There are no external
 * resources of any kind - no CDN, no font, no analytics - which is what lets
 * the response CSP be `default-src 'none'`.
 */

export const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ACE Export Helper</title>
<link rel="stylesheet" href="app.css">
</head>
<body>
<header>
  <h1>ACE Export Helper</h1>
  <p id="source">Connecting...</p>
</header>

<main>
  <section class="panel">
    <h2>Invoice</h2>
    <div class="row">
      <label for="search">Search</label>
      <input id="search" type="search" placeholder="invoice number, or part of one" autocomplete="off">
      <button id="find" type="button">Find</button>
    </div>
    <div class="row">
      <label for="invoice">Invoice</label>
      <select id="invoice"><option value="">(none loaded)</option></select>
      <button id="load" type="button">Preview</button>
    </div>
  </section>

  <section class="panel" id="summary" hidden>
    <h2>Summary</h2>
    <dl>
      <dt>Customer</dt><dd id="customer"></dd>
      <dt>Invoice date</dt><dd id="date"></dd>
      <dt>Items</dt><dd id="items"></dd>
      <dt>Destination</dt><dd id="destination"></dd>
    </dl>
  </section>

  <section class="panel" id="supply" hidden>
    <h2>Supply what QuickBooks does not hold</h2>
    <p class="hint">Left blank, these stay blank. Nothing is guessed.</p>
    <div class="grid">
      <label>Vessel <input data-field="vessel" type="text" autocomplete="off"></label>
      <label>Booking <input data-field="bookingNumber" type="text" autocomplete="off"></label>
      <label>Container <input data-field="containerNumber" type="text" autocomplete="off"></label>
      <label>Seal <input data-field="sealNumber" type="text" autocomplete="off"></label>
      <label>Carrier <input data-field="carrier" type="text" autocomplete="off"></label>
      <label>Destination <input data-field="destination" type="text" autocomplete="off"></label>
    </div>
    <button id="refresh" type="button">Apply and preview</button>
  </section>

  <section class="panel" id="readiness" hidden>
    <h2>ACE readiness, line by line</h2>
    <p class="hint">QuickBooks has the invoice. It does not have the Schedule B
    number, the origin indicator or the licence code - those are customs facts,
    and they are yours. Fill them in here for this export, or put them in the
    item profile so they are right every time.</p>
    <div id="lines"></div>
    <button id="applyLines" type="button">Apply and preview</button>
  </section>

  <section class="panel" id="checks" hidden>
    <h2>Ready to export?</h2>
    <pre id="checklist"></pre>
    <button id="export" type="button" class="primary">Export ACE Excel</button>
    <p id="result"></p>
  </section>

  <section class="panel" id="detail" hidden>
    <h2>Every field, and where it came from</h2>
    <pre id="preview"></pre>
  </section>

  <section class="panel" id="bill" hidden>
    <h2>Vendor bill</h2>
    <p class="hint">Builds the supplier's Bill from this invoice: the vendor and
    expense account come from the item rules in the configuration, the
    commission from the vendor rule, the terms and dates from the invoice.
    Nothing is written until you press Write, and never twice for one number.</p>
    <pre id="billPreview">(not built yet)</pre>
    <div class="row">
      <button id="billBuild" type="button">Preview bill</button>
      <button id="billWrite" type="button" class="primary" disabled>Write bill to QuickBooks</button>
      <button id="billExcel" type="button" disabled>Save calculation (.xlsx)</button>
    </div>
    <p id="billResult"></p>
  </section>
</main>

<footer>
  <p>Everything stays on this machine. The extension never saves, submits or
  certifies a filing - review each field in ACE and submit it yourself. The
  only change this window can make in QuickBooks is a vendor Bill, and only
  when you press Write.</p>
</footer>

<script src="app.js"></script>
</body>
</html>
`;

export const PAGE_CSS = `:root { color-scheme: light dark; --line: #d5d8dd; --accent: #1b4f9c; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
header, main, footer { max-width: 62rem; margin: 0 auto; padding: 0 1rem; }
header { padding-top: 1.5rem; }
h1 { font-size: 1.35rem; margin: 0; }
h2 { font-size: 1rem; margin: 0 0 .75rem; text-transform: uppercase; letter-spacing: .04em; opacity: .7; }
#source { margin: .25rem 0 1rem; opacity: .75; }
.panel { border: 1px solid var(--line); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
.row { display: flex; gap: .5rem; align-items: center; margin-bottom: .5rem; flex-wrap: wrap; }
.row label { width: 5rem; opacity: .75; }
input[type=text], input[type=search], select { flex: 1 1 14rem; min-width: 10rem; padding: .4rem .5rem;
  border: 1px solid var(--line); border-radius: 5px; font: inherit; background: transparent; color: inherit; }
button { padding: .45rem .9rem; border: 1px solid var(--line); border-radius: 5px; background: transparent;
  color: inherit; font: inherit; cursor: pointer; }
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
button[disabled] { opacity: .5; cursor: default; }
dl { display: grid; grid-template-columns: 9rem 1fr; gap: .25rem .75rem; margin: 0; }
dt { opacity: .7; }
dd { margin: 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: .5rem 1rem; margin-bottom: .75rem; }
.grid label { display: flex; flex-direction: column; gap: .2rem; opacity: .85; }
.hint { margin: -.4rem 0 .75rem; opacity: .7; }
pre { white-space: pre-wrap; word-break: break-word; font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
  background: rgba(127,127,127,.08); padding: .75rem; border-radius: 6px; overflow-x: auto; }
#result { min-height: 1.2rem; }
.bad { color: #9c1b1b; }
.ok { color: #146c2e; }
footer p { opacity: .7; border-top: 1px solid var(--line); padding-top: .75rem; margin-bottom: 2rem; }
.line-card { border: 1px solid var(--line); border-radius: 6px; padding: .75rem; margin-bottom: .75rem; }
.line-card h3 { font-size: .95rem; margin: 0 0 .5rem; }
.line-card h3 .state { font-weight: normal; opacity: .8; margin-left: .5rem; }
.readiness { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: .3rem 1rem; margin-bottom: .6rem; }
.readiness .item { display: flex; gap: .5rem; align-items: baseline; }
.readiness .mark { width: 1rem; flex: 0 0 auto; font-weight: 700; }
.readiness .name { width: 9rem; flex: 0 0 auto; opacity: .75; }
.readiness .value { word-break: break-word; }
.line-inputs { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: .4rem .75rem; }
.line-inputs label { display: flex; flex-direction: column; gap: .2rem; opacity: .85; font-size: .9rem; }
`;

export const PAGE_JS = `(function () {
  'use strict';

  var token = new URLSearchParams(location.search).get('t') || '';
  var selected = '';

  function api(path, params) {
    var query = new URLSearchParams(params || {});
    query.set('t', token);
    return fetch(path + '?' + query.toString(), { headers: { accept: 'application/json' } }).then(read);
  }

  function post(path, payload) {
    var query = new URLSearchParams({ t: token });
    return fetch(path + '?' + query.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(read);
  }

  function read(response) {
    return response.json().then(function (data) {
      if (!response.ok) throw new Error(data && data.error ? data.error : 'Request failed.');
      return data;
    });
  }

  function $(id) { return document.getElementById(id); }

  function show(id, visible) { $(id).hidden = !visible; }

  function overrides() {
    var out = {};
    var inputs = document.querySelectorAll('#supply [data-field]');
    for (var i = 0; i < inputs.length; i += 1) {
      var value = inputs[i].value.trim();
      if (value !== '') out[inputs[i].getAttribute('data-field')] = value;
    }
    return out;
  }

  /** Per-line values the operator typed, keyed by line number. */
  function lineOverrides() {
    var out = {};
    var inputs = document.querySelectorAll('#lines [data-line]');
    for (var i = 0; i < inputs.length; i += 1) {
      var value = inputs[i].value.trim();
      if (value === '') continue;
      var line = inputs[i].getAttribute('data-line');
      if (!out[line]) out[line] = {};
      out[line][inputs[i].getAttribute('data-line-field')] = value;
    }
    return out;
  }

  /**
   * Redraw the readiness table.
   *
   * Values the operator has already typed are preserved across a redraw: the
   * preview round-trip must not wipe the Schedule B they just entered.
   */
  function renderLines(lines) {
    var kept = lineOverrides();
    var host = $('lines');
    host.textContent = '';

    lines.forEach(function (line) {
      var card = document.createElement('div');
      card.className = 'line-card';

      var title = document.createElement('h3');
      title.textContent = 'Line ' + line.line + ': ' + line.description;
      var state = document.createElement('span');
      state.className = 'state ' + (line.ready ? 'ok' : 'bad');
      state.textContent = line.ready ? 'ready' : 'needs attention';
      title.appendChild(state);
      card.appendChild(title);

      var grid = document.createElement('div');
      grid.className = 'readiness';
      line.items.forEach(function (item) {
        var row = document.createElement('div');
        row.className = 'item';
        var mark = document.createElement('span');
        mark.className = 'mark ' + (item.ok ? 'ok' : 'bad');
        mark.textContent = item.ok ? '\u2713' : '\u26a0';
        var name = document.createElement('span');
        name.className = 'name';
        name.textContent = item.label;
        var value = document.createElement('span');
        value.className = 'value';
        value.textContent = item.ok ? item.value : (item.value === '(blank)' ? 'missing' : item.value);
        row.appendChild(mark);
        row.appendChild(name);
        row.appendChild(value);
        grid.appendChild(row);
      });
      card.appendChild(grid);

      var inputs = document.createElement('div');
      inputs.className = 'line-inputs';
      line.items.filter(function (item) { return item.editable; }).forEach(function (item) {
        var label = document.createElement('label');
        label.appendChild(document.createTextNode(item.label));
        var input = document.createElement('input');
        input.type = 'text';
        input.setAttribute('data-line', String(line.line));
        input.setAttribute('data-line-field', item.field);
        input.autocomplete = 'off';
        var previous = kept[String(line.line)];
        if (previous && previous[item.field]) input.value = previous[item.field];
        label.appendChild(input);
        inputs.appendChild(label);
      });
      card.appendChild(inputs);

      host.appendChild(card);
    });
  }

  function fail(error) {
    var result = $('result');
    result.textContent = error.message;
    result.className = 'bad';
  }

  function loadInvoices() {
    var contains = $('search').value.trim();
    api('/api/invoices', contains === '' ? {} : { contains: contains }).then(function (data) {
      var select = $('invoice');
      select.textContent = '';
      if (!data.invoices.length) {
        select.appendChild(new Option('(no invoices matched)', ''));
        return;
      }
      data.invoices.forEach(function (invoice) {
        var label = (invoice.reference || '(no number)') + '  -  ' + invoice.date + '  -  ' + invoice.customerName;
        select.appendChild(new Option(label, invoice.id));
      });
      select.selectedIndex = 0;
    }).catch(fail);
  }

  function preview() {
    selected = $('invoice').value;
    if (!selected) { fail(new Error('Choose an invoice first.')); return; }
    $('result').textContent = '';
    api('/api/invoice', {
      id: selected,
      overrides: JSON.stringify(overrides()),
      lineOverrides: JSON.stringify(lineOverrides())
    }).then(function (data) {
      $('customer').textContent = data.invoice.customerName || '(blank)';
      $('date').textContent = data.invoice.invoiceDate || '(blank)';
      $('items').textContent = String(data.itemCount);
      $('destination').textContent = data.invoice.destination || '(blank)';
      $('checklist').textContent = data.checklist.join('\\n');
      $('preview').textContent = data.preview;
      renderLines(data.readiness || []);
      show('summary', true);
      show('supply', true);
      show('readiness', true);
      show('checks', true);
      show('detail', true);
      show('bill', true);
      billReady = false;
      $('billWrite').disabled = true;
      $('billExcel').disabled = true;
      $('billPreview').textContent = '(not built yet)';
      $('billResult').textContent = '';
    }).catch(fail);
  }

  var billReady = false;

  function billFail(error) {
    var result = $('billResult');
    result.textContent = error.message;
    result.className = 'bad';
  }

  function showBill(data) {
    billReady = !!data.ok && !data.written;
    $('billWrite').disabled = !billReady;
    $('billExcel').disabled = !data.plan;
    if (!data.ok && data.refusals && data.refusals.length && !data.plan) {
      $('billPreview').textContent = 'No bill was built from this invoice:\n' + data.refusals.map(function (r) { return '  \u2717 ' + r; }).join('\n');
      return;
    }
    $('billPreview').textContent = data.preview;
  }

  function previewBill() {
    if (!selected) { billFail(new Error('Preview an invoice first.')); return; }
    $('billResult').textContent = '';
    post('/api/bill', { id: selected }).then(function (data) {
      showBill(data);
      var result = $('billResult');
      result.textContent = data.ok ? 'Checks passed. Nothing was written.' : (data.plan ? 'A check failed; Write is disabled.' : '');
      result.className = data.ok ? 'ok' : 'bad';
    }).catch(billFail);
  }

  function writeBill() {
    if (!selected || !billReady) { billFail(new Error('Preview the bill first.')); return; }
    if (!confirm('Add this bill to QuickBooks? This cannot be undone from here.')) return;
    var button = $('billWrite');
    button.disabled = true;
    post('/api/bill', { id: selected, write: true }).then(function (data) {
      showBill(data);
      var result = $('billResult');
      result.textContent = data.written
        ? 'Added bill TxnID ' + data.written.txnId + ' for ' + data.written.vendor + '. Open it in QuickBooks and read it before it is paid.'
        : 'Nothing was written.';
      result.className = data.written ? 'ok' : 'bad';
    }).catch(function (error) {
      billFail(error);
      $('billWrite').disabled = !billReady;
    });
  }

  function saveBillWorkbook() {
    if (!selected) { billFail(new Error('Preview the bill first.')); return; }
    var button = $('billExcel');
    button.disabled = true;
    post('/api/bill', { id: selected, excel: true }).then(function (data) {
      showBill(data);
      var result = $('billResult');
      result.textContent = data.excel ? 'Wrote ' + data.excel.path + '.' : 'No workbook was written.';
      result.className = data.excel ? 'ok' : 'bad';
    }).catch(billFail).then(function () { button.disabled = false; });
  }

  function exportWorkbook() {
    if (!selected) { fail(new Error('Preview an invoice first.')); return; }
    var button = $('export');
    button.disabled = true;
    post('/api/export', { id: selected, overrides: overrides(), lineOverrides: lineOverrides() }).then(function (data) {
      var result = $('result');
      result.textContent = 'Wrote ' + data.path + '. Import it from the ACE Helper panel in Chrome.';
      result.className = 'ok';
    }).catch(fail).then(function () { button.disabled = false; });
  }

  $('find').addEventListener('click', loadInvoices);
  $('load').addEventListener('click', preview);
  $('refresh').addEventListener('click', preview);
  $('applyLines').addEventListener('click', preview);
  $('export').addEventListener('click', exportWorkbook);
  $('billBuild').addEventListener('click', previewBill);
  $('billWrite').addEventListener('click', writeBill);
  $('billExcel').addEventListener('click', saveBillWorkbook);
  $('search').addEventListener('keydown', function (event) { if (event.key === 'Enter') loadInvoices(); });

  api('/api/source').then(function (data) {
    $('source').textContent = data.label;
  }).catch(function (error) { $('source').textContent = error.message; });

  loadInvoices();
})();
`;
