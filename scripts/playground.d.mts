/** Types for playground.mjs, so the tests and the build can import it under strict typechecking. */
export interface AceStep {
  step: number;
  fixture: string;
  file: string;
  title: string;
}
/** Which helper a playground folder is built for: the card name, the banner, the README, the host permissions. */
export interface PlaygroundHelper {
  id: 'quickfill' | 'ace';
  card: string;
  banner: string;
  bannerHow: string;
  description: string;
  hostPermissions: string[] | null;
}
export const ACE_STEPS: AceStep[];
export const WORKBOOK_FILE: string;
export const PLAYGROUND_MATCHES: string[];
export const HELPERS: { quickfill: PlaygroundHelper; ace: PlaygroundHelper };
export function playgroundManifest(manifest: Record<string, unknown>, helper: PlaygroundHelper): Record<string, unknown>;
export function wrapAceScreen(fragment: string, step: AceStep, helper: PlaygroundHelper): string;
export function exampleWorkbook(): Buffer;
export function playgroundReadme(stamp: string, helper: PlaygroundHelper): string;
export function writePlayground(dir: string, options: { fixtures: string; stamp: string; helper: PlaygroundHelper }): string[];
