/** Panel entry point: full-page import, preview, diagnostics, and settings. */

import { startApp } from './app.js';
import { createExcelImporter } from './importer.js';

void startApp('panel', createExcelImporter());
