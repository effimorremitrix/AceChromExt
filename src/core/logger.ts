/** Console logging, silent unless debug mode is on. */

const PREFIX = '[ACE Helper]';

let debugEnabled = false;

export function setDebugLogging(enabled: boolean): void {
  debugEnabled = enabled;
}

export function isDebugLogging(): boolean {
  return debugEnabled;
}

export function debug(...args: unknown[]): void {
  if (debugEnabled) console.debug(PREFIX, ...args);
}

export function info(...args: unknown[]): void {
  if (debugEnabled) console.info(PREFIX, ...args);
}

export function warn(...args: unknown[]): void {
  console.warn(PREFIX, ...args);
}

export function error(...args: unknown[]): void {
  console.error(PREFIX, ...args);
}
