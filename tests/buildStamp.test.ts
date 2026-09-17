/**
 * The build stamp: what chrome://extensions and the helpers' headers show, so
 * the build that is loaded can be told apart from the one just built.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildVersionName } from '../scripts/buildStamp.mjs';

const ROOT = join(__dirname, '..');

describe('buildVersionName', () => {
  it('stamps the version with the short commit, a dirty mark when the tree has changes, and the UTC build time', () => {
    const stamp = buildVersionName('0.1.0', ROOT, new Date('2026-09-17T15:04:33.123Z'));
    expect(stamp).toMatch(/^0\.1\.0\+([0-9a-f]{7,40}(-dirty)?|nogit)\.2026-09-17T15:04:33Z$/);
  });

  it('says nogit outside a checkout rather than failing the build', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ace-stamp-'));
    try {
      expect(buildVersionName('0.1.0', dir, new Date('2026-09-17T15:04:33Z'))).toBe('0.1.0+nogit.2026-09-17T15:04:33Z');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
