/**
 * Step 3: Commodities -> Line Details - ACE selectors.
 *
 * The Commodities step opens on a Line Summary table (Add New Line, and
 * Edit | Delete per line). The fields below exist only once a line is open in
 * the Line Details form, whose heading reads "Line N Details". They resolve
 * inside that container (see PAGE_SIGNATURES.lineContainerHeadings), so a
 * write can never land on a different commodity line.
 *
 * SELECTOR STATUS: label wording captured from the live AESDirect Line
 * Details screen on 2026-09-14; DOM ids not yet captured. See
 * docs/ACE-MAPPING.md.
 */

import { byFrameworkName, byIdSuffix, byLabel, byNearby, capturedLabel, placeholder, type SelectorTable } from './types.js';

const LINE = "[data-section='commodityLine']";

export const COMMODITY_SELECTORS: SelectorTable = {
  ExportInformationCode: {
    candidates: [
      placeholder('id', '#exportInformationCode'),
      placeholder('name', "select[name='exportInformationCode']"),
      byFrameworkName('exportInformationCode'),
      byIdSuffix('exportInformationCode'),
      capturedLabel(['Export Information Code']),
      byLabel(['Export Info Code', 'Export Information']),
    ],
    devtoolsHint:
      'Line Details -> inspect the Export Information Code control ("OS - ALL OTHER EXPORTS"); capture the underlying <select> and a sample <option>.',
  },

  ScheduleB: {
    candidates: [
      placeholder('id', '#scheduleBNumber'),
      placeholder('name', "input[name='scheduleBNumber']"),
      placeholder('attribute', "input[data-field='scheduleBNumber']"),
      byFrameworkName('scheduleBNumber'),
      byIdSuffix('scheduleBNumber'),
      capturedLabel(['Schedule B or HTS Number', 'Schedule B or HTS Number [Schedule B Search Engine]']),
      byLabel(['Schedule B/HTS Number', 'Schedule B Number', 'Schedule B', 'Commodity Classification Number']),
      byNearby(LINE, "input[name*='scheduleB' i]"),
    ],
    devtoolsHint:
      'Line Details -> inspect the Schedule B or HTS Number box. The live screen shows the dotted form 0802.12.0000 in the box, so the dotted transform stays; confirm ACE keeps it after Save Line.',
  },

  CommodityDescription: {
    candidates: [
      placeholder('id', '#commodityDescription'),
      placeholder('name', "textarea[name='commodityDescription']"),
      placeholder('name', "input[name='commodityDescription']"),
      byFrameworkName('commodityDescription'),
      byIdSuffix('commodityDescription'),
      capturedLabel(['Commodity Description']),
      byLabel(['Description of Goods', 'Description']),
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
      capturedLabel(['1st Quantity']),
      byLabel(['Quantity 1', 'Quantity1', 'First Quantity']),
    ],
    devtoolsHint: 'Line Details -> inspect the 1st Quantity box. Confirm it rejects commas (it normally does).',
  },

  UOM1: {
    candidates: [
      placeholder('id', '#unitOfMeasure1'),
      placeholder('name', "select[name='unitOfMeasure1']"),
      byFrameworkName('unitOfMeasure1'),
      byIdSuffix('unitOfMeasure1'),
      capturedLabel(['1st UOM']),
      byLabel(['Unit of Measure 1', 'UOM 1', 'Unit of Measure']),
    ],
    devtoolsHint:
      'Line Details -> inspect the 1st UOM box. On the live screen it is read-only (ACE derives it from the Schedule B number, e.g. KG); capture the element so the derived value can be read back and compared.',
  },

  Quantity2: {
    candidates: [
      placeholder('id', '#quantity2'),
      placeholder('name', "input[name='quantity2']"),
      byFrameworkName('quantity2'),
      byIdSuffix('quantity2'),
      capturedLabel(['2nd Quantity']),
      byLabel(['Quantity 2', 'Quantity2', 'Second Quantity']),
    ],
    devtoolsHint:
      'Line Details -> inspect the 2nd Quantity box. It is disabled unless the Schedule B number carries a second unit.',
  },

  UOM2: {
    candidates: [
      placeholder('id', '#unitOfMeasure2'),
      placeholder('name', "select[name='unitOfMeasure2']"),
      byFrameworkName('unitOfMeasure2'),
      byIdSuffix('unitOfMeasure2'),
      capturedLabel(['2nd UOM']),
      byLabel(['Unit of Measure 2', 'UOM 2']),
    ],
    devtoolsHint: 'Line Details -> inspect the 2nd UOM box (read-only, derived from the Schedule B number like the 1st UOM).',
  },

  Origin: {
    candidates: [
      placeholder('id', '#originOfGoods'),
      placeholder('name', "select[name='originOfGoods']"),
      byFrameworkName('originOfGoods'),
      byIdSuffix('originOfGoods'),
      capturedLabel(['Origin of Goods']),
      byLabel(['Domestic/Foreign', 'Origin', 'Domestic or Foreign']),
    ],
    devtoolsHint:
      'Line Details -> inspect the Origin of Goods control ("D - DOMESTIC"). Capture the underlying <select> and its options.',
  },

  ValueOfGoods: {
    candidates: [
      placeholder('id', '#valueOfGoods'),
      placeholder('name', "input[name='valueOfGoods']"),
      placeholder('attribute', "input[data-field='valueOfGoods']"),
      byFrameworkName('valueOfGoods'),
      byIdSuffix('valueOfGoods'),
      capturedLabel(['Value of Goods (whole US Dollars)']),
      byLabel(['Value of Goods', 'Value', 'Commodity Value']),
      byNearby(LINE, "input[name*='value' i]"),
    ],
    devtoolsHint:
      'Line Details -> inspect the Value of Goods box. The label says whole US dollars, so the mapping files a whole number; confirm ACE keeps it.',
  },

  ShippingWeight: {
    candidates: [
      placeholder('id', '#shippingWeight'),
      placeholder('name', "input[name='shippingWeight']"),
      byFrameworkName('shippingWeight'),
      byIdSuffix('shippingWeight'),
      capturedLabel(['Shipping Weight (whole Kilograms)']),
      byLabel(['Shipping Weight', 'Gross Weight', 'Shipping Weight (Kilograms)', 'Shipping Weight (KG)']),
    ],
    devtoolsHint:
      'Line Details -> inspect the Shipping Weight box. The label says whole kilograms, which is what the importer produces.',
  },

  ECCN: {
    candidates: [
      placeholder('id', '#eccn'),
      placeholder('name', "input[name='eccn']"),
      byFrameworkName('eccn'),
      byIdSuffix('eccn'),
      capturedLabel(['ECCN']),
      byLabel(['Export Control Classification Number']),
    ],
    devtoolsHint: 'Line Details -> inspect the ECCN box.',
  },

  LicenseCode: {
    candidates: [
      placeholder('id', '#licenseCode'),
      placeholder('name', "select[name='licenseCode']"),
      byFrameworkName('licenseCode'),
      byIdSuffix('licenseCode'),
      capturedLabel(['License Type Code/License Exemption Code']),
      byLabel(['License Code', 'License Code/License Exemption', 'License Type Code', 'Licence Code']),
    ],
    devtoolsHint:
      'Line Details -> inspect the License Type Code/License Exemption Code control ("C33 - NLR NO LICENSE REQUIRED, ..."). Capture the underlying <select> and a sample <option>: values are usually the code ("C33") with a descriptive label.',
  },
};
