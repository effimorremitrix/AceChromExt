/**
 * A future hosted hand-off: a web application pushing a canonical shipment
 * straight into the extension, with no file in between.
 *
 * It is declared and unavailable, on purpose. The extension has no network
 * permission and its CSP forbids outbound connections (see the manifest and
 * scripts/check-bundle.mjs), so building this means changing the security
 * posture of the whole tool, which is a decision, not a code change.
 *
 * Declaring it keeps the seam honest: `InvoiceDataSource` has three
 * implementations, one of which says plainly that it does not work yet, rather
 * than the interface having one implementation and an aspiration.
 */

import type { InvoiceDataSource, SourceLoadOptions, SourceLoadResult } from './InvoiceDataSource.js';
import { SourceError } from './InvoiceDataSource.js';

export class WebSource implements InvoiceDataSource<never> {
  readonly id = 'web' as const;
  readonly label = 'Web application (not available)';
  readonly available = false;

  load(_input: never, _options: SourceLoadOptions): SourceLoadResult {
    void _input;
    void _options;
    throw new SourceError(
      'The web source is not built. ACE Helper has no network permission by design; ' +
        'import an .xlsx file instead.',
    );
  }
}
