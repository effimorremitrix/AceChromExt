/**
 * Step 3: Commodities -> Line Details.
 *
 * These are the fields that "Fill Current Commodity Line" writes. Scope is
 * 'commodityLine': values come from one canonical commodity, not the invoice.
 *
 * Selectors: src/ace/selectors/commodities.ts.
 */

import type { AceFieldMapping } from '../../models/AceField.js';
import { COMMODITY_SELECTORS } from '../selectors/commodities.js';
import { defineField } from './types.js';

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
    selectors: COMMODITY_SELECTORS,
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
    selectors: COMMODITY_SELECTORS,
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
    selectors: COMMODITY_SELECTORS,
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
    selectors: COMMODITY_SELECTORS,
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
    selectors: COMMODITY_SELECTORS,
  }),

  defineField({
    key: 'Quantity2',
    label: 'Quantity 2',
    page: 'commodities',
    scope: 'commodityLine',
    source: 'commodity.quantity2',
    type: 'number',
    transforms: ['quantity'],
    selectors: COMMODITY_SELECTORS,
  }),

  defineField({
    key: 'UOM2',
    label: 'Unit of Measure 2',
    page: 'commodities',
    scope: 'commodityLine',
    source: 'commodity.uom2',
    type: 'select',
    transforms: ['uom'],
    selectors: COMMODITY_SELECTORS,
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
    selectors: COMMODITY_SELECTORS,
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
    selectors: COMMODITY_SELECTORS,
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
    selectors: COMMODITY_SELECTORS,
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
    selectors: COMMODITY_SELECTORS,
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
    selectors: COMMODITY_SELECTORS,
  }),
];
