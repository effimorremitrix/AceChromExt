/**
 * Noticing the browser move, for a surface that stays open.
 *
 * A popup never had to. It is born looking at one tab, and Chrome destroys it
 * the moment it loses focus, which on a form being filled is the first click
 * into the form. It cannot be wrong about the page, because it is not there
 * when the page changes.
 *
 * The side panel and the pop-out window are there. They are still on the
 * screen when the operator switches to the second draft, reloads the portal,
 * or moves to another browser window. A surface that outlives a tab switch and
 * still describes the tab it was born on is WORSE than one that closed: a
 * stale "Create Shipping Instruction, 7 containers" reads as current, and the
 * operator fills from it.
 *
 * So every surface that stays open subscribes here and re-probes. Three
 * events, none of which needs a permission this build does not have:
 *
 *   - `tabs.onActivated`      the operator switched tab;
 *   - `tabs.onUpdated`        that tab navigated or finished loading;
 *   - `windows.onFocusChanged` they switched browser window, which changes
 *                             which portal tab is in front.
 *
 * `tabs.onUpdated` carries a `url` only for a tab this build has host
 * permission for, and nothing here reads one: which tabs may be addressed is
 * still Chrome's answer to a pattern query in `resolveAceTab` /
 * `resolveInttraTab`, never a URL test written here.
 */

/** Re-probe now. Returned so a caller can force one the same way an event would. */
export type Reprobe = () => void;

/**
 * A burst of events is one probe.
 *
 * Loading a portal page fires `onUpdated` several times and `onActivated`
 * alongside it; probing per event would send four round trips to a content
 * script that is still parsing. A probe already running is not interrupted
 * either: it finishes, and one more runs after it if anything arrived while
 * it was out. So the last event always wins, and two probes never overlap.
 */
export function watchBrowser(probe: () => Promise<void> | void, delayMs = 150): Reprobe {
  let timer = 0;
  let running = false;
  let queued = false;

  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), delayMs) as unknown as number;
  };

  const run = async (): Promise<void> => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      await probe();
    } finally {
      running = false;
      if (queued) {
        queued = false;
        schedule();
      }
    }
  };

  // Each event is subscribed only where it exists. Missing one costs a probe,
  // never a thrown error in a surface that is otherwise working: the panel
  // still has its own Refresh, and the playground build runs with a far
  // smaller chrome than a portal does.
  if (typeof chrome === 'undefined') return schedule;

  chrome.tabs?.onActivated?.addListener(() => schedule());
  chrome.tabs?.onUpdated?.addListener((_tabId, changeInfo) => {
    // A navigation is what changes the answer. Everything else Chrome reports
    // on a tab - muted, pinned, audible, a favicon - changes nothing here.
    if (changeInfo.status === 'complete' || changeInfo.url !== undefined) schedule();
  });
  chrome.windows?.onFocusChanged?.addListener(() => schedule());

  return schedule;
}

/**
 * True while the operator is typing into THIS surface.
 *
 * `tabs.onUpdated` fires for every tab in the browser, not only the portal, so
 * a background tab finishing its load is enough to trigger a probe. A probe is
 * harmless; the re-render after it is not, because rebuilding the DOM takes
 * the caret out of whatever box the operator was in the middle of - the
 * Deckhand paste box, the selector-override editor, the reference number.
 *
 * So a repaint driven by the BROWSER waits. Nothing is lost by waiting: the
 * state behind it was refreshed either way, the next click on a button or a
 * tab renders it, and the next browser event repaints on its own. A repaint
 * the operator asked for is never affected; this is only ever consulted by
 * `watchBrowser` callers.
 */
export function isEditing(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active as HTMLElement).isContentEditable === true;
}
