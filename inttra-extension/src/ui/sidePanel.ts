/**
 * Side panel entry point: page status, Fill, Containers, the last report.
 *
 * This was `popup.ts` until the toolbar icon stopped opening a popup. Chrome
 * destroys an action popup the moment it loses focus, and on the Create
 * Shipping Instruction page that is every click into the form, so the operator
 * had to reopen the helper after each one. The side panel is docked beside the
 * page and stays where it is put.
 */
import { startApp } from './app.js';

void startApp('side');
