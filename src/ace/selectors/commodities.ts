/**
 * Step 3: Commodities -> Line Details - ACE selectors.
 *
 * These resolve inside the open Line Details container (see
 * PAGE_SIGNATURES.lineContainerSelectors), so a write can never land on a
 * different commodity line.
 *
 * SELECTOR STATUS: placeholders only. See docs/ACE-MAPPING.md.
 */

import { byFrameworkName, byIdSuffix, byLabel, byNearby, placeholder, type SelectorTable } from './types.js';

const LINE = "[data-section='commodityLine']";

export const COMMODITY_SELECTORS: SelectorTable = {
  ExportInformationCode: {
    candidates: [
      placeholder('id', '#exportInformationCode'),
      placeholder('name', "select[name='exportInformationCode']"),
      byFrameworkName('exportInformationCode'),
      byIdSuffix('exportInformationCode'),
      byLabel(['Export Information Code', 'Export Info Code', 'Export Information']),
    ],
    devtoolsHint:
      'Line Details -> inspect the Export Information Code dropdown; capture the <select> and a sample <option>.',
  },

  ScheduleB: {
    candidates: [
      placeholder('id', '#scheduleBNumber'),
      placeholder('name', "input[name='scheduleBNumber']"),
      placeholder('attribute', "input[data-field='scheduleBNumber']"),
      byFrameworkName('scheduleBNumber'),
      byIdSuffix('scheduleBNumber'),
      byLabel([
        'Schedule B/HTS Number',
        'Schedule B / HTS Number',
        'Schedule B Number',
        'Schedule B',
        'Commodity Classification Number',
      ]),
      byNearby(LINE, "input[name*='scheduleB' i]"),
    ],
    devtoolsHint:
      'Commodities tab -> open a line -> inspect the Schedule B box. IMPORTANT: also check whether ACE accepts the dotted form 0802.12.0000 or only 10 digits. If only digits, change transforms to ["scheduleBDigits"].',
  },

  CommodityDescription: {
    candidates: [
      placeholder('id', '#commodityDescription'),
      placeholder('name', "textarea[name='commodityDescription']"),
      placeholder('name', "input[name='commodityDescription']"),
      byFrameworkName('commodityDescription'),
      byIdSuffix('commodityDescription'),
      byLabel(['Commodity Description', 'Description of Goods', 'Description']),
    ],
    devtoolsHint:
      'Line Details -> inspect the Commodity Description box. Note whether it is an <input> or <textarea> and read its maxlength attribute (ACE truncates long descriptions).',
  },

  Quantity1: {
    candidates: [
      placeholder('id', '#quantity1'),
      placeholder('name', "input[name='quantity1']"),
      byFrameworkName('quantity1'),
      byIdSuffix('quantity1'),
      byLabel(['Quantity 1', 'Quantity1', 'First Quantity']),
    ],
    devtoolsHint: 'Line Details -> inspect the Quantity 1 box. Confirm it rejects commas (it normally does).',
  },

  UOM1: {
    candidates: [
      placeholder('id', '#unitOfMeasure1'),
      placeholder('name', "select[name='unitOfMeasure1']"),
      byFrameworkName('unitOfMeasure1'),
      byIdSuffix('unitOfMeasure1'),
      byLabel(['Unit of Measure 1', 'UOM 1', 'Unit of Measure']),
    ],
    devtoolsHint:
      'Line Details -> inspect the UOM 1 dropdown. Capture two <option> tags: the writer needs to know whether option values are codes ("KG") or descriptions ("Kilograms").',
  },

  Quantity2: {
    candidates: [
      placeholder('id', '#quantity2'),
      placeholder('name', "input[name='quantity2']"),
      byFrameworkName('quantity2'),
      byIdSuffix('quantity2'),
      byLabel(['Quantity 2', 'Quantity2', 'Second Quantity']),
    ],
    devtoolsHint:
      'Line Details -> inspect the Quantity 2 box (only present for Schedule B numbers with a second unit).',
  },

  UOM2: {
    candidates: [
      placeholder('id', '#unitOfMeasure2'),
      placeholder('name', "select[name='unitOfMeasure2']"),
      byFrameworkName('unitOfMeasure2'),
      byIdSuffix('unitOfMeasure2'),
      byLabel(['Unit of Measure 2', 'UOM 2']),
    ],
    devtoolsHint: 'Line Details -> inspect the UOM 2 dropdown.',
  },

  Origin: {
    candidates: [
      placeholder('id', '#originOfGoods'),
      placeholder('name', "select[name='originOfGoods']"),
      byFrameworkName('originOfGoods'),
      byIdSuffix('originOfGoods'),
      byLabel(['Origin of Goods', 'Domestic/Foreign', 'Origin', 'Domestic or Foreign']),
    ],
    devtoolsHint:
      'Line Details -> inspect the Origin of Goods control. Capture its options: ACE commonly uses D / F values with "Domestic" / "Foreign" labels.',
  },

  ValueOfGoods: {
    candidates: [
      placeholder('id', '#valueOfGoods'),
      placeholder('name', "input[name='valueOfGoods']"),
      placeholder('attribute', "input[data-field='valueOfGoods']"),
      byFrameworkName('valueOfGoods'),
      byIdSuffix('valueOfGoods'),
      byLabel(['Value of Goods', 'Value', 'Commodity Value']),
      byNearby(LINE, "input[name*='value' i]"),
    ],
    devtoolsHint:
      'Line Details -> inspect the Value of Goods box. Confirm whether ACE wants whole dollars or dollars-and-cents; if whole dollars, change transforms to ["integer"].',
  },

  ShippingWeight: {
    candidates: [
      placeholder('id', '#shippingWeight'),
      placeholder('name', "input[name='shippingWeight']"),
      byFrameworkName('shippingWeight'),
      byIdSuffix('shippingWeight'),
      byLabel(['Shipping Weight', 'Gross Weight', 'Shipping Weight (Kilograms)', 'Shipping Weight (KG)']),
    ],
    devtoolsHint:
      'Line Details -> inspect the Shipping Weight box. Confirm the unit in the label: the importer converts pounds to kilograms and assumes ACE wants kilograms.',
  },

  ECCN: {
    candidates: [
      placeholder('id', '#eccn'),
      placeholder('name', "input[name='eccn']"),
      byFrameworkName('eccn'),
      byIdSuffix('eccn'),
      byLabel(['ECCN', 'Export Control Classification Number']),
    ],
    devtoolsHint:
      'Line Details -> inspect the ECCN box (may only appear once a licence code requiring it is selected).',
  },

  LicenseCode: {
    candidates: [
      placeholder('id', '#licenseCode'),
      placeholder('name', "select[name='licenseCode']"),
      byFrameworkName('licenseCode'),
      byIdSuffix('licenseCode'),
      byLabel(['License Code', 'License Code/License Exemption', 'License Type Code', 'Licence Code']),
    ],
    devtoolsHint:
      'Line Details -> inspect the License Code dropdown. Capture a sample <option>: values are usually the code ("C33") with a descriptive label.',
  },
};
