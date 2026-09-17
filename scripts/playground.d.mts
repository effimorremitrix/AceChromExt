/** Types for playground.mjs, so the tests and the build can import it under strict typechecking. */
export interface AceStep {
  step: number;
  fixture: string;
  file: string;
  title: string;
}
export const ACE_STEPS: AceStep[];
export const WORKBOOK_FILE: string;
export const PLAYGROUND_MATCHES: string[];
export function wrapAceScreen(fragment: string, step: AceStep): string;
export function exampleWorkbook(): Buffer;
export function playgroundReadme(stamp: string): string;
export function writePlayground(dir: string, options: { fixtures: string; stamp: string }): string[];
