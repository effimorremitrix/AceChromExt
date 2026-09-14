/**
 * What ACE Helper is allowed to click. Nothing.
 *
 * The extension types values into fields the user is already looking at. It
 * does not press Save Line, does not press Add New Line, does not submit, does
 * not certify, and does not dismiss an ACE warning. The last click on a filing
 * is the filer's, because the filing is the filer's legal declaration.
 *
 * "Save Line" and "Add New Line" are the two that keep getting asked for, and
 * they are the two that would turn a data-entry aid into something that files
 * on someone's behalf. They are therefore written down here as explicitly
 * disabled rather than simply absent, so that:
 *
 *   - enabling one is a deliberate edit to a file called automationPolicy, not
 *     a quiet addition to the filler;
 *   - `tests/invariants.test.ts` can assert both are false, and assert that no
 *     content script calls .click(), .submit() or .requestSubmit() at all;
 *   - a future maintainer reads the reason before finding the switch.
 *
 * If that decision is ever revisited it needs a conversation with the filer,
 * not a pull request.
 */

export interface AutomationPolicy {
  /** Press ACE's own "Save Line" after filling a commodity line. */
  clickSaveLine: boolean;
  /** Press ACE's own "Add New Line" to open the next line. */
  clickAddLine: boolean;
  /** Press Submit / Certify. Not a setting; it is never true. */
  submitFiling: false;
}

export const AUTOMATION_POLICY: Readonly<AutomationPolicy> = Object.freeze({
  clickSaveLine: false,
  clickAddLine: false,
  submitFiling: false,
});

/**
 * Guard for any future code path that would press an ACE control.
 *
 * It throws rather than returning false: a caller that reaches it has already
 * decided to click something, and the safe outcome is a visible failure in the
 * fill report, not a silent no-op that reads as success.
 */
export function assertAutomationAllowed(action: keyof AutomationPolicy): void {
  if (AUTOMATION_POLICY[action] !== true) {
    throw new Error(
      `ACE Helper does not press ACE controls ("${action}" is disabled in src/content/automationPolicy.ts). ` +
        'Save, submit and certify remain the filer’s own actions.',
    );
  }
}
