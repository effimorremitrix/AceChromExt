/**
 * The companion's side of the filing package: QuickBooks invoice + an email
 * on disk -> filing-package-<ref>.json.
 *
 * The file is the hand-off to the browser extensions. It carries the Deckhand
 * extraction as *pending*: the review and the Approve click happen in the
 * extension, in front of the form, which is where the person is when it
 * matters. Nothing here writes to QuickBooks, and nothing here contacts the
 * network.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { extractShipment, type DeckhandShipment } from '../../../deckhand/src/index.js';
import {
  buildFilingPackage,
  filingPackageFileName,
  serializeFilingPackage,
  type CommercialSource,
  type FilingPackage,
} from '../../../shared/src/index.js';
import type { CanonicalMapping } from '../mapping/types.js';

export class PackageExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageExportError';
  }
}

/** Read an email or document from disk and extract it. .eml and text files are read; anything else is refused with the reason. */
export function extractFromFile(path: string): DeckhandShipment {
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  if (!existsSync(absolute)) throw new PackageExportError(`No such file: "${absolute}".`);
  const bytes = new Uint8Array(readFileSync(absolute));
  return extractShipment({ kind: 'file', name: basename(absolute), mediaType: '', bytes });
}

export interface PackageBuildOptions {
  mapping: CanonicalMapping;
  shipment: DeckhandShipment | null;
  generatedBy: string;
  now?: Date;
}

export function packageFromMapping(options: PackageBuildOptions): FilingPackage {
  const commercialSource: CommercialSource = {
    id: 'quickbooks-export',
    label: 'QuickBooks export',
    detail: `${options.generatedBy} - invoice ${options.mapping.shipment.invoice.invoiceNumber || '(no number)'}`,
  };
  return buildFilingPackage({
    invoice: options.mapping.shipment,
    commercialSource,
    shipment: options.shipment,
    deckhandApproved: false,
    ...(options.now ? { now: options.now } : {}),
  });
}

export interface WritePackageOptions {
  directory: string;
  fileName?: string | null;
  failIfExists?: boolean;
}

export interface WrittenPackage {
  path: string;
  fileName: string;
  bytes: number;
}

export function writeFilingPackage(pkg: FilingPackage, options: WritePackageOptions): WrittenPackage {
  const directory = isAbsolute(options.directory) ? options.directory : resolve(process.cwd(), options.directory);
  mkdirSync(directory, { recursive: true });
  const fileName = options.fileName || filingPackageFileName(pkg);
  const path = join(directory, fileName);
  if (options.failIfExists !== false && existsSync(path)) {
    throw new PackageExportError(`"${path}" already exists. Move it, or pass --force to replace it.`);
  }
  const text = serializeFilingPackage(pkg);
  writeFileSync(path, text);
  return { path, fileName, bytes: Buffer.byteLength(text) };
}

export function writeDeckhandJson(text: string, directory: string, fileName: string, failIfExists = true): WrittenPackage {
  const absolute = isAbsolute(directory) ? directory : resolve(process.cwd(), directory);
  mkdirSync(absolute, { recursive: true });
  const path = join(absolute, fileName);
  if (failIfExists && existsSync(path)) throw new PackageExportError(`"${path}" already exists. Pass --force to replace it.`);
  writeFileSync(path, text);
  return { path, fileName, bytes: Buffer.byteLength(text) };
}
