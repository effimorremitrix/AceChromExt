/**
 * The guides shown in the Help tab: the repository's own docs, bundled at
 * build time. Edit docs/USER-GUIDE.md and docs/SETUP-GUIDE.md; the page
 * follows on the next build. Nothing is fetched at runtime, which the page's
 * CSP would refuse anyway.
 */

import userGuide from '../../docs/USER-GUIDE.md?raw';
import setupGuide from '../../docs/SETUP-GUIDE.md?raw';

export type GuideId = 'user' | 'setup';

export interface Guide {
  id: GuideId;
  /** The file name, which is how the guides link to each other. */
  file: string;
  label: string;
  text: string;
}

export const GUIDES: Guide[] = [
  { id: 'user', file: 'USER-GUIDE.md', label: 'User guide', text: userGuide },
  { id: 'setup', file: 'SETUP-GUIDE.md', label: 'Setup guide', text: setupGuide },
];

export function guideById(id: GuideId): Guide {
  return GUIDES.find((guide) => guide.id === id) ?? (GUIDES[0] as Guide);
}

export function guideByFile(file: string): Guide | null {
  return GUIDES.find((guide) => guide.file.toLowerCase() === file.toLowerCase()) ?? null;
}
