/**
 * Step 3: Commodities -> Line Details - ACE selectors.
 *
 * The Commodities step opens on a Line Summary table (Add New Line, and
 * Edit | Delete per line). The fields below exist only once a line is open in
 * the Line Details form, whose heading reads "Line N Details". They resolve
 * inside that container (see PAGE_SIGNATURES.lineContainerHeadings), so a
 * write can never land on a different commodity line.
 *
 * SELECTOR STATUS: all twelve labels were confirmed against a live Line 1
 * Details screenshot on 2026-09-16, and three of the ids were captured from
 * the DOM the same day (1st Quantity, Value of Goods, Shipping Weight). Those
 * three also carry a `title` attribute whose text is exactly the visible
 * label, which is why the label candidates have been resolving all along.
 * The remaining nine ids follow the same `commodityLines[n].<field>.stringField`
 * shape but have not been read off the screen, so they stay placeholders.
 * See docs/ACE-MAPPING.md.
 */

import {
  bindingPath,
  bindingSuffix,
  byFrameworkName,
  byIdSuffix,
  byLabel,
  byNearby,
  capturedLabel,
  placeholder,
  type SelectorTable,
} from './types.js';

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
      // Captured 2026-09-16:
      // <input id="commodityLines[0].quantity1.stringField"
      //        name="commodityLines[0].quantity1.stringField" title="1st Quantity"
      //        class="form-control nonNegativeIntegersOnly" type="text" maxlength="10">
      bindingPath('commodityLines[0].quantity1'),
      bindingSuffix('quantity1'),
      capturedLabel(['1st Quantity']),
      byLabel(['Quantity 1', 'Quantity1', 'First Quantity']),
    ],
    devtoolsHint:
      'Line Details -> inspect the 1st Quantity box. class="nonNegativeIntegersOnly" and maxlength=10, so it takes a whole number with no commas, no decimal point and no sign.',
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
      // Captured 2026-09-16: the ACE path is `goodsValue`, not `valueOfGoods`.
      // <input id="commodityLines[0].goodsValue.stringField"
      //        name="commodityLines[0].goodsValue.stringField"
      //        title="Value of Goods (whole US Dollars)"
      //        class="form-control nonNegativeIntegersOnly" maxlength="10">
      bindingPath('commodityLines[0].goodsValue'),
      bindingSuffix('goodsValue'),
      capturedLabel(['Value of Goods (whole US Dollars)']),
      byLabel(['Value of Goods', 'Value', 'Commodity Value']),
      byNearby(LINE, "input[name*='goodsValue' i]"),
    ],
    devtoolsHint:
      'Line Details -> inspect the Value of Goods box. class="nonNegativeIntegersOnly", maxlength=10: whole US dollars, no separators.',
  },

  ShippingWeight: {
    candidates: [
      // Captured 2026-09-16: the ACE path is `shipmentWeight` (shipment, not
      // shipping) while the visible label reads "Shipping Weight".
      // <input id="commodityLines[0].shipmentWeight.stringField"
      //        name="commodityLines[0].shipmentWeight.stringField"
      //        title="Shipping Weight (whole Kilograms)"
      //        class="form-control nonNegativeIntegersOnly" maxlength="10">
      bindingPath('commodityLines[0].shipmentWeight'),
      bindingSuffix('shipmentWeight'),
      capturedLabel(['Shipping Weight (whole Kilograms)']),
      byLabel(['Shipping Weight', 'Gross Weight', 'Shipping Weight (Kilograms)', 'Shipping Weight (KG)']),
    ],
    devtoolsHint:
      'Line Details -> inspect the Shipping Weight box. class="nonNegativeIntegersOnly", maxlength=10: whole kilograms, no separators.',
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
