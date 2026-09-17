/**
 * The build stamp: version, git commit and build time, written into each dist
 * manifest as `version_name`, which chrome://extensions shows in place of the
 * version and which the helpers' own headers show as "build ...".
 *
 * It exists because an unpacked extension has no other way to say which build
 * it is: every manifest says 0.1.0, dist/ is not committed, and on
 * 2026-09-17 a screenshot could not settle whether the INTTRA Helper in the
 * browser predated that day's captured selectors.
 *
 *   0.1.0+d49c839.2026-09-17T13:08:29Z        a clean checkout at d49c839
 *   0.1.0+d49c839-dirty.2026-09-17T13:08:29Z  with uncommitted changes
 *   0.1.0+nogit.2026-09-17T13:08:29Z          built outside a git checkout
 *
 * In --watch mode the stamp is the time the watch started.
 */

import { execSync } from 'node:child_process';

function git(args, cwd) {
  try {
    return execSync(`git ${args}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** `<version>+<short sha>[-dirty].<UTC time>`, or `<version>+nogit.<UTC time>` outside a checkout. */
export function buildVersionName(version, cwd, now = new Date()) {
  const sha = git('rev-parse --short HEAD', cwd) || 'nogit';
  const dirty = sha !== 'nogit' && git('status --porcelain --untracked-files=no', cwd) !== '' ? '-dirty' : '';
  const time = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `${version}+${sha}${dirty}.${time}`;
}
