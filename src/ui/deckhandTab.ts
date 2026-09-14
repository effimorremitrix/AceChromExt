/**
 * The Deckhand tab: paste or load a document, extract, review, approve.
 *
 * Shared by the ACE Helper panel and the INTTRA Helper panel, which is why it
 * takes its state and its side effects through a context object rather than
 * owning either. It renders the review model from deckhand/src/review, so the
 * marks on screen are the marks the companion prints.
 *
 * Nothing extracted goes anywhere until Approve is pressed, and Approve is
 * disabled while the review has a blocking problem (a failed check digit, a
 * contradicted seal, an unpaired container). Missing values do not block:
 * they are filled by hand.
 */

import {
  approveShipment,
  buildReview,
  deckhandFileName,
  extractShipment,
  formatBlock,
  formatTsv,
  serializeDeckhandShipment,
  DOCUMENT_READERS,
  type DeckhandShipment,
  type ReviewMark,
  type ReviewRow,
} from '../../deckhand/src/index.js';
import { el } from './dom.js';

export interface DeckhandState {
  shipment: DeckhandShipment;
  approvedAt: string | null;
}

export interface DeckhandTabContext {
  current: DeckhandState | null;
  /** The text in the paste box, kept by the caller across re-renders. */
  draft: string;
  onDraftChange(text: string): void;
  onExtracted(shipment: DeckhandShipment): Promise<void>;
  onApproved(approvedAt: string): Promise<void>;
  onCleared(): Promise<void>;
  setStatus(text: string, tone: 'info' | 'ok' | 'warn' | 'error'): void;
  copyToClipboard(text: string, what: string): void;
  downloadText(text: string, fileName: string): void;
  /** "ACE" or "INTTRA": names the destination in the copy. */
  destination: string;
}

function markPill(mark: ReviewMark): HTMLElement {
  const tone = mark === 'ok' ? 'green' : mark === 'check' ? 'yellow' : 'red';
  const glyph = mark === 'ok' ? '✓' : mark === 'check' ? '?' : '⚠';
  return el('span', { className: `pill pill-${tone} dh-mark`, text: glyph, attrs: { 'aria-label': mark === 'ok' ? 'read with confidence' : mark === 'check' ? 'check against the source' : 'attention' } });
}

function reviewRow(row: ReviewRow, ctx: DeckhandTabContext): HTMLElement {
  const copy = el('button', { className: 'link-button', text: 'copy', attrs: { type: 'button' } });
  copy.addEventListener('click', () => ctx.copyToClipboard(row.value, row.label));
  return el('div', { className: `dh-row dh-${row.mark}` }, [
    markPill(row.mark),
    el('span', { className: 'dh-label', text: row.label }),
    el('span', { className: `dh-value mono${row.value ? '' : ' muted'}`, text: row.value || '(missing)' }),
    el('span', { className: 'dh-note small muted', text: row.evidence ? `${row.note} - ${row.evidence}` : row.note }),
    row.value ? copy : null,
  ]);
}

function renderReview(state: DeckhandState, ctx: DeckhandTabContext): HTMLElement {
  const review = buildReview(state.shipment);
  const approved = state.approvedAt !== null;
  const card = el('div', { className: 'card' });

  card.append(
    el('div', { className: 'dh-head' }, [
      el('strong', { text: 'Deckhand - Shipment Extraction' }),
      el('span', {
        className: `pill pill-${approved ? 'green' : review.canApprove ? 'yellow' : 'red'}`,
        text: approved ? `approved ${new Date(state.approvedAt as string).toLocaleString()}` : review.canApprove ? 'awaiting your review' : 'blocked',
      }),
    ]),
    el('p', { className: 'small muted', text: `${state.shipment.source.name} - ${review.summary}.` }),
  );

  card.append(el('div', { className: 'dh-rows' }, review.headerRows.map((row) => reviewRow(row, ctx))));

  card.append(el('h3', { className: 'dh-subhead', text: `Containers (${review.containers.length})` }));
  if (!review.containers.length) {
    card.append(el('p', { className: 'small warn', text: 'No container numbers were recognised.' }));
  }
  for (const container of review.containers) {
    card.append(
      el('div', { className: `dh-container dh-${container.mark}` }, [
        el('div', { className: 'dh-container-head' }, [el('strong', { text: `${container.index + 1}.` }), markPill(container.mark)]),
        el('div', { className: 'dh-rows' }, [reviewRow(container.number, ctx), reviewRow(container.carrierSeal, ctx), reviewRow(container.shipperSeal, ctx)]),
      ]),
    );
  }

  if (review.unassignedSeals.length) {
    card.append(
      el('div', { className: 'notice notice-warn small' }, [
        el('strong', { text: 'Not paired. ' }),
        el('span', { text: `The document did not show these seals beside a container, so Deckhand will not guess which container they belong to: ${review.unassignedSeals.join(', ')}. Match them from the source yourself.` }),
      ]),
    );
  }

  if (review.uncertainties.length) {
    card.append(
      el('details', { className: 'card dh-uncertain', attrs: review.blocking.length ? { open: 'open' } : {} }, [
        el('summary', { text: `Anything I am unsure of (${review.uncertainties.length})` }),
        el(
          'ul',
          { className: 'small note-list' },
          review.uncertainties.map((item) => el('li', { className: `note note-${item.severity}`, text: item.message })),
        ),
      ]),
    );
  }

  const approve = el('button', {
    className: 'button button-primary',
    text: approved ? 'Approved' : 'Approve Shipment Data',
    attrs: { type: 'button', ...(approved || !review.canApprove ? { disabled: 'disabled' } : {}) },
  });
  approve.addEventListener('click', () => {
    void (async () => {
      try {
        const result = approveShipment(state.shipment);
        await ctx.onApproved(result.approvedAt);
        ctx.setStatus(`Shipment data approved. It can now be combined with the invoice into a filing package for ${ctx.destination}.`, 'ok');
      } catch (error) {
        ctx.setStatus((error as Error).message, 'error');
      }
    })();
  });

  const copyBlock = el('button', { className: 'button button-small', text: 'Copy review block', attrs: { type: 'button' } });
  copyBlock.addEventListener('click', () => ctx.copyToClipboard(formatBlock(state.shipment), 'Review block'));

  const copyRows = el('button', { className: 'button button-small', text: 'Copy container rows (TSV)', attrs: { type: 'button' } });
  copyRows.addEventListener('click', () => ctx.copyToClipboard(formatTsv(state.shipment), 'Container rows'));

  const save = el('button', { className: 'button button-small', text: 'Save as JSON', attrs: { type: 'button' } });
  save.addEventListener('click', () => ctx.downloadText(serializeDeckhandShipment(state.shipment), deckhandFileName(state.shipment, 'json')));

  const clear = el('button', { className: 'button button-small button-danger', text: 'Discard', attrs: { type: 'button' } });
  clear.addEventListener('click', () => void ctx.onCleared());

  card.append(el('div', { className: 'actions' }, [approve, copyBlock, copyRows, save, clear]));
  if (!review.canApprove && !approved) {
    card.append(el('p', { className: 'small error', text: 'Approval is blocked until the problems above are fixed in the source and the text is extracted again. Deckhand never corrects a container or seal number.' }));
  }
  card.append(
    el('p', { className: 'small muted', text: 'Container numbers are checked against ISO 6346. Seal numbers have no standard format and no check digit, so nothing about them is validated; read them against the source.' }),
  );
  return card;
}

export function renderDeckhandTab(ctx: DeckhandTabContext): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(
    el('h2', { text: 'Deckhand' }),
    el('p', { className: 'small muted', text: 'Paste the email that carries the booking, containers and seals, or load a saved .eml or .txt. Deckhand reads out the identifiers; you check them and approve. Nothing is uploaded and nothing is kept past this browser session.' }),
  );

  const textarea = el('textarea', {
    className: 'input mono textarea',
    attrs: { rows: '10', spellcheck: 'false', placeholder: 'Paste the email here, including any container and seal list...' },
  }) as HTMLTextAreaElement;
  textarea.value = ctx.draft;
  textarea.addEventListener('input', () => ctx.onDraftChange(textarea.value));

  const extract = el('button', { className: 'button button-primary', text: 'Extract', attrs: { type: 'button' } });
  extract.addEventListener('click', () => {
    const text = textarea.value;
    if (text.trim() === '') {
      ctx.setStatus('Paste the email text first.', 'warn');
      return;
    }
    const shipment = extractShipment({ kind: 'text', text, name: 'pasted text' });
    void ctx.onExtracted(shipment).then(() => {
      const review = buildReview(shipment);
      ctx.setStatus(`Extracted: ${review.summary}. Read it against the source, then approve.`, review.blocking.length ? 'warn' : 'ok');
    });
  });

  const accept = DOCUMENT_READERS.filter((reader) => reader.available).map((reader) => (reader.id === 'eml' ? '.eml' : '.txt,.text,.md,.csv')).join(',');
  const fileInput = el('input', { className: 'file-input', attrs: { type: 'file', accept } }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void file.arrayBuffer().then((buffer) => {
      const shipment = extractShipment({ kind: 'file', name: file.name, mediaType: file.type, bytes: new Uint8Array(buffer) });
      fileInput.value = '';
      void ctx.onExtracted(shipment).then(() => {
        const review = buildReview(shipment);
        ctx.setStatus(`Extracted from ${file.name}: ${review.summary}.`, review.blocking.length ? 'warn' : 'ok');
      });
    });
  });

  section.append(
    el('label', { className: 'field' }, [el('span', { text: 'Email or document text' }), textarea]),
    el('div', { className: 'actions' }, [extract]),
    el('label', { className: 'field' }, [el('span', { text: 'or load a saved email (.eml) or text file' }), fileInput]),
    el('p', { className: 'small muted', text: 'PDF and image attachments are not read by this version: open the attachment, select the text, and paste it. A future reader plugs into the same seam without changing anything else.' }),
  );

  if (ctx.current) section.append(renderReview(ctx.current, ctx));

  return section;
}
