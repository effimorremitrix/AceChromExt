/** Console logging, silent unless debug mode is on. */

const PREFIX = '[INTTRA Helper]';
let debugEnabled = false;

export function setDebugLogging(enabled: boolean): void {
  debugEnabled = enabled;
}

export function debug(...args: unknown[]): void {
  if (debugEnabled) console.debug(PREFIX, ...args);
}

export function warn(...args: unknown[]): void {
  console.warn(PREFIX, ...args);
}
