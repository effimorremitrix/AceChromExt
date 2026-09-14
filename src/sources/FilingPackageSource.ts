/**
 * A filing-package.json, produced by the Package tab, the INTTRA Helper or
 * the companion's `ace-export package` command.
 *
 * The package composes the same canonical shipment a workbook produces, plus
 * an approved Deckhand extraction. This source turns it back into a
 * CanonicalShipment through `aceShipmentFromPackage`, so everything
 * downstream - preview, data quality checks, mapping status, fill - runs
 * unchanged. A package with no commercial half is refused: ACE needs the
 * invoice and its commodity lines, and Deckhand does not hold them.
 *
 * Like every source here it reads a local file only. No network, no server.
 */

import { validateShipment } from '../excel/validator.js';
import type { MapperNote } from '../excel/canonicalMapper.js';
import type { FilingPackage } from '../../shared/src/filingPackage.js';
import { aceShipmentFromPackage } from '../../shared/src/aceView.js';
import { FilingPackageParseError, parseFilingPackageJson } from '../../shared/src/serialize.js';
import type { InvoiceDataSource, SourceDescriptor, SourceLoadOptions, SourceLoadResult } from './InvoiceDataSource.js';
import { SourceError } from './InvoiceDataSource.js';

export interface FilingPackageLoadResult extends SourceLoadResult {
  package: FilingPackage;
}

export class FilingPackageSource implements InvoiceDataSource<FilingPackage> {
  readonly id = 'filing-package' as const;
  readonly label = 'Filing package';
  readonly available = true;

  describe(pkg: FilingPackage): SourceDescriptor {
    const parts = [pkg.commercialSource?.label ?? 'no commercial data'];
    if (pkg.shipment) parts.push(pkg.review.deckhand === 'approved' ? 'Deckhand approved' : 'Deckhand pending review');
    return { id: this.id, label: this.label, detail: `${pkg.packageId} - ${parts.join(', ')}` };
  }

  load(pkg: FilingPackage, _options: SourceLoadOptions): FilingPackageLoadResult {
    void _options;
    let view: ReturnType<typeof aceShipmentFromPackage>;
    try {
      view = aceShipmentFromPackage(pkg);
    } catch (error) {
      throw new SourceError((error as Error).message);
    }
    const shipment = view.shipment;
    const validation = validateShipment(shipment);
    const notes: MapperNote[] = [
      ...view.notes.map((note) => ({ severity: note.severity, message: note.message })),
      ...pkg.notes.map((note) => ({ severity: note.severity, message: `Package: ${note.message}` })),
    ];
    return {
      shipment,
      validation,
      notes,
      source: this.describe(pkg),
      selectedLine: shipment.commodities[0]?.line ?? 1,
      package: pkg,
    };
  }
}

/** Parse the file text and load it. Throws SourceError with a message the panel can show. */
export function loadFilingPackageText(text: string, options: SourceLoadOptions): FilingPackageLoadResult {
  let pkg: FilingPackage;
  try {
    pkg = parseFilingPackageJson(text);
  } catch (error) {
    if (error instanceof FilingPackageParseError) throw new SourceError(`Not a filing package: ${error.message}`);
    throw new SourceError(`The filing package could not be loaded: ${(error as Error).message}`);
  }
  return new FilingPackageSource().load(pkg, options);
}
