/**
 * The ONE entry point: every screen, in the side panel.
 *
 * Two surfaces used to share `app.ts`: this one, compact, and a wide
 * `panel.html` opened as a browser tab that carried Import, Preview, Mapping,
 * the Calculator, Settings and Diagnostics. Both reasons for the split were
 * about the surface this one used to be - an action popup, which Chrome closed
 * when a file picker opened and would not let the operator resize. A side
 * panel is neither. So the wide panel is gone and the Excel importer is
 * injected here, which is what made this bundle grow from ~155 kB to ~505 kB:
 * SheetJS now rides along. It is bundled, local, and read once when the panel
 * opens; nothing is fetched.
 */

import { startApp } from './app.js';
import { createExcelImporter } from './importer.js';

void startApp(createExcelImporter());
