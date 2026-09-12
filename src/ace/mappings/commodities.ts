/**
 * Step 3: Commodities -> Line Details.
 *
 * These are the fields that "Fill Current Commodity Line" writes. Scope is
 * 'commodityLine': values come from one canonical commodity, not the invoice.
 *
 * SELECTOR STATUS: placeholders only. See docs/ACE-MAPPING.md.
 */

import type { AceFieldMapping } from '../../models/AceField.js';
import { byLabel, byNearby, defineField, placeholder } from './types.js';

export const COMMODITY_FIELDS: AceFieldMapping[] = [
  defineField({
    key: 'ExportInformationCode',
    label: 'Export Information Code',
    page: 'commodities',
    scope: 'commodityLine',
    source: 'commodity.exportInformationCode',
    type: 'select',
    transforms: ['code'],
    maxLength: 2,
    candidates: [
      placeholder('id', '#exportInformationCode'),
      placeholder('name', "select[name='exportInformationCode']"),
      byLabel(['Export Information Code', 'Export Info Code']),
    ],
    devtoolsHint: 'Line Details -> inspect the Export Information Code dropdown; capture the <select> and a sample <option>.',
  }),

  defineField({
    key: 'ScheduleB',
    label: 'Schedule B / HTS Number',
    page: 'commodities',
    scope: 'commodityLine',
    source: 'commodity.scheduleB',
    type: 'code',
    transforms: ['scheduleB'],
    maxLength: 12,
    expected: true,
    candidates: [
      placeholder('id', '#scheduleBNumber'),
      placeholder('name', "input[name='scheduleBNumber']"),
      placeholder('attribute', "input[data-field='scheduleBNumber']"),
      byLabel(['Schedule B/HTS Number', 'Schedule B / HTS Number', 'Schedule B Number', 'Commodity Classification Number']),
      byNearby("[data-section='commodityLine']", "input[name*='scheduleB' i]"),
    ],
    devtoolsHint:
      'Commodities tab -> open a line -> inspect the Schedule B box. IMPORTANT: also check whether ACE accepts the dotted form 0802.12.0000 or only 10 digits. If only digits, change transforms to ["scheduleBDigits"].',
  }),

  defineField({
    key: 'CommodityDescription',
    label: 'Commodity Description',
    page: 'commodities',
    scope: 'commodityLine',
    source: 'commodity.description',
    type: 'text',
    transforms: ['text'],
    maxLength: 45,
    expected: true,
    candidates: [
      placeholder('id', '#commodityDescription'),
      placeholder('name', "textarea[name='commodityDescription']"),
      placeholder('name', "input[name='commodityDescription']"),
      byLabel(['Commodity Description', 'Description of Goods', 'Description']),
    ],
    devtoolsHint:
      'Line Details -> inspect the Commodity Description box. Note whether it is an <input> or <textarea> and read its maxlength attribute (ACE truncates long descriptions).',
  }),

  defineField({
    key: 'Quantity1',
    label: 'Quantity 1',
    page: 'commodities',
    scope: 'commodityLine',
    source: 'commodity.quantity1',
    type: 'number',
    transforms: ['quantity'],
    expected: true,
    candidates: [
      placeholder('id', '#quantity1'),
      placeholder('name', "input[name='quantity1']"),
      byLabel(['Quantity 1', 'Quantity1', 'First Quantity']),
    ],
    devtoolsHint: 'Line Details -> inspect the Quantity 1 box. Confirm it rejects commas (it normally does).',
  }),

  defineField({
    key: 'UOM1',
    label: 'Unit of Measure 1',
    page: 'commodities',
    scope: 'commodityLine',
    source: 'commodity.uom1',
    type: 'select',
    transforms: ['uom'],
    expected: true,
    candidates: [
      placeholder('id', '#unitOfMeasure1'),
      placeholder('name', "select[name='unitOfMeasure1']"),
      byLabel(['Unit of Measure 1', 'UOM 1', 'Unit of Measure']),
    ],
    devtoolsHint:
      'Line Details -> inspect the UOM 1 dropdown. Capture two <option> tags: the writer needs to know whether option values are codes ("KG") or descriptions ("Kilograms").',
  }),

  defineField({
    key: 'Quantity2',
    label: 'Quantity 2',
    page: 'commodities',
    scope: 'commodityLine',
    source: 'commodity.quantity2',
    type: 'number',
    transforms: ['quantity'],
    candidates: [
      placeholder('id', '#quantity2'),
      placeholder('name', "input[name='quantity2']"),
      byLabel(['Quantity 2', 'Quantity2', 'Second Quantity']),
    ],
    devtoolsHint: 'Line Details -> inspect the Quantity 2 box (only present for Schedule B numbers with a second unit).',
  }),

  defineField({
    key: 'UOM2',
    label: 'Unit of Measure 2',
    page: 'commodities',
    scope: 'commodityLine',
    source: 'commodity.uom2',
    type: 'select',
    transforms: ['uom'],
    candidates: [
      placeholder('id', '#unitOfMeasure2'),
      placeholder('name', "select[name='unitOfMeasure2']"),
      byLabel(['Unit of Measure 2', 'UOM 2']),
    ],
    devtoolsHint: 'Line Details -> inspect the UOM 2 dropdown.',
  }),

  defineField({
    key: 'Origin',
    label: 'Origin of Goods',
    page: 'commodities',
    scope: 'commodityLine',
    source: 'commodity.origin',
    type: 'select',
    transforms: ['origin'],
    maxLength: 1,
    expected: true,
    candidates: [
      placeholder('id', '#originOfGoods'),
      placeholder('name', "select[name='originOfGoods']"),
      byLabel(['Origin of Goods', 'Domestic/Foreign', 'Origin']),
    ],
    devtoolsHint:
      'Line Details -> inspect the Origin of Goods control. Capture its options: ACE commonly uses D / F values with "Domestic" / "Foreign" labels.',
  }),

  defineField({
    key: 'ValueOfGoods',
    label: 'Value of Goods',
    page: 'commodities',
    scope: 'commodityLine',
    source: 'commodity.valueOfGoods',
    type: 'number',
    transforms: ['money'],
    expected: true,
    candidates: [
      placeholder('id', '#valueOfGoods'),
      placeholder('name', "input[name='valueOfGoods']"),
      placeholder('attribute', "input[data-field='valueOfGoods']"),
      byLabel(['Value of Goods', 'Value', 'Commodity Value']),
      byNearby("[data-section='commodityLine']", "input[name*='value' i]"),
    ],
    devtoolsHint:
      'Line Details -> inspect the Value of Goods box. Confirm whether ACE wants whole dollars or dollars-and-cents; if whole dollars, change transforms to ["integer"].',
  }),

  defineField({
    key: 'ShippingWeight',
    label: 'Shipping Weight (kg)',
    page: 'commodities',
    scope: 'commodityLine',
    source: 'commodity.shippingWeight',
    type: 'number',
    transforms: ['weight'],
    expected: true,
    candidates: [
      placeholder('id', '#shippingWeight'),
      placeholder('name', "input[name='shippingWeight']"),
      byLabel(['Shipping Weight', 'Gross Weight', 'Shipping Weight (Kilograms)']),
    ],
    devtoolsHint:
      'Line Details -> inspect the Shipping Weight box. Confirm the unit in the label: the importer converts pounds to kilograms and assumes ACE wants kilograms.',
  }),

  defineField({
    key: 'ECCN',
    label: 'ECCN',
    page: 'commodities',
    scope: 'commodityLine',
    source: 'commodity.eccn',
    type: 'code',
    transforms: ['eccn'],
    maxLength: 12,
    candidates: [
      placeholder('id', '#eccn'),
      placeholder('name', "input[name='eccn']"),
      byLabel(['ECCN', 'Export Control Classification Number']),
    ],
    devtoolsHint: 'Line Details -> inspect the ECCN box (may only appear once a licence code requiring it is selected).',
  }),

  defineField({
    key: 'LicenseCode',
    label: 'License Code / Exemption',
    page: 'commodities',
    scope: 'commodityLine',
    source: 'commodity.licenseCode',
    type: 'select',
    transforms: ['code'],
    maxLength: 3,
    expected: true,
    candidates: [
      placeholder('id', '#licenseCode'),
      placeholder('name', "select[name='licenseCode']"),
      byLabel(['License Code', 'License Code/License Exemption', 'License Type Code']),
    ],
    devtoolsHint:
      'Line Details -> inspect the License Code dropdown. Capture a sample <option>: values are usually the code ("C33") with a descriptive label.',
  }),
];
