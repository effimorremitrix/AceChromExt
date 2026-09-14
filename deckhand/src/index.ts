/**
 * Deckhand: shipment-document extraction.
 *
 *   email / document text  ->  DeckhandShipment  ->  review  ->  approved
 *
 * Deckhand is a source adapter. It knows nothing about ACE, INTTRA, QuickBooks
 * or a browser DOM, and nothing in this folder may import from src/content,
 * inttra-extension or companion. Both browser extensions and the companion
 * import from here; nothing here imports from them.
 */

export * from './model.js';
export * from './iso6346.js';
export * from './input.js';
export { readEml, EmlReader } from './readers/eml.js';
export { extractWithRules, RULES_EXTRACTOR_ID } from './extract/rulesExtractor.js';
export { scanLines, isTableRow, toContainerNumber } from './extract/containers.js';
export { assembleContainers, containerUncertainties } from './extract/assemble.js';
export { labelledField, findLabelled, vesselVoyageCombined, HEADER_LABELS } from './extract/labels.js';
export * from './extractor.js';
export * from './review/reviewModel.js';
export * from './review/format.js';
export * from './serialize.js';
