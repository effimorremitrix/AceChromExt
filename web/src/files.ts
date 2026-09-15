/**
 * Files in and out of the browser, and nothing else.
 *
 * A chosen file is read with File.arrayBuffer(); a download is a Blob URL on
 * an anchor. Both stay inside the page: there is no fetch, no upload, and the
 * page's CSP (connect-src 'none') would refuse one. The URL is revoked after
 * the save so the bytes do not sit around.
 */

import { el } from '../../src/ui/dom.js';

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export function downloadBytes(bytes: Uint8Array, fileName: string, mediaType: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mediaType });
  const url = URL.createObjectURL(blob);
  const anchor = el('a', { attrs: { href: url, download: fileName } });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, fileName: string): void {
  downloadBytes(new TextEncoder().encode(text), fileName, 'application/json;charset=utf-8');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
