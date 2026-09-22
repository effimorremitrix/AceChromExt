/**
 * Side panel entry point: page status, the line picker, Fill, the last report.
 *
 * This was `popup.ts` until the toolbar icon stopped opening a popup. Chrome
 * destroys an action popup the moment it loses focus, and on a form being
 * filled that is every click into the form, so the operator had to reopen the
 * helper after each one. The side panel is docked beside the page and stays
 * where it is put. Same code, same bundle, a surface that survives a click.
 */

import { startApp } from './app.js';

void startApp('side');
