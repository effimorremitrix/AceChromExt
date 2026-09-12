/** Weight conversion. ACE shipping weight is filed in whole kilograms. */

import { roundHalfUp } from './numbers.js';

/** Exact international-pound definition. */
export const LB_TO_KG = 0.45359237;

export interface WeightConversion {
  kg: number;
  /** Human-readable description shown in the preview. */
  description: string;
}

export function poundsToKilograms(pounds: number, decimals = 0): WeightConversion {
  const kg = roundHalfUp(pounds * LB_TO_KG, decimals);
  return { kg, description: `lb x ${LB_TO_KG}` };
}

export function kilogramsToPounds(kilograms: number, decimals = 0): number {
  return roundHalfUp(kilograms / LB_TO_KG, decimals);
}

export type WeightUnit = 'kg' | 'lb' | 'unknown';

const KG_ALIASES = new Set(['kg', 'kgs', 'kgm', 'kilo', 'kilos', 'kilogram', 'kilograms']);
const LB_ALIASES = new Set(['lb', 'lbs', 'pound', 'pounds', '#']);

export function detectWeightUnit(unit: string): WeightUnit {
  const normalized = unit.trim().toLowerCase().replace(/[.\s]/g, '');
  if (normalized === '') return 'unknown';
  if (KG_ALIASES.has(normalized)) return 'kg';
  if (LB_ALIASES.has(normalized)) return 'lb';
  return 'unknown';
}

export interface NormalizedWeight {
  /** Weight in kilograms, rounded to whole kg for ACE. */
  kg: number | null;
  /** Null when the value was already in kg (or the unit was unknown). */
  transform: string | null;
  notes: string[];
}

/**
 * Normalize a weight to kilograms.
 *
 * A value with no unit is assumed to already be kilograms (ACE files in kg);
 * that assumption is reported back as a note so the preview can flag it yellow.
 */
export function normalizeWeightToKg(value: number, unit: string, decimals = 0): NormalizedWeight {
  const detected = detectWeightUnit(unit);

  if (detected === 'lb') {
    const converted = poundsToKilograms(value, decimals);
    return { kg: converted.kg, transform: converted.description, notes: [] };
  }

  if (detected === 'kg') {
    return { kg: roundHalfUp(value, decimals), transform: null, notes: [] };
  }

  return {
    kg: roundHalfUp(value, decimals),
    transform: null,
    notes: unit.trim() === ''
      ? ['No weight unit given; assumed kilograms.']
      : [`Unrecognised weight unit "${unit}"; value used as kilograms.`],
  };
}
