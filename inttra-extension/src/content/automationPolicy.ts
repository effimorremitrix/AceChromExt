/**
 * What INTTRA Helper is allowed to click. Nothing.
 *
 * It types values into fields the operator is already looking at. It does not
 * press Save, Continue, Next, Add Row, Submit, or accept a legal declaration,
 * and it never performs a login or touches MFA. The last click on a Shipping
 * Instruction is the operator's, because the SI is the shipper's legal
 * instruction to the carrier.
 *
 * "Add Row" on the container grid is the one that will be asked for. It is
 * written down here as disabled rather than merely absent: enabling it is a
 * deliberate edit to this file after a conversation with the operator, and
 * tests/inttraInvariants.test.ts asserts it is false and that no content
 * script calls .click() at all. Until then the operator adds the rows and
 * the helper fills them.
 */

export interface InttraAutomationPolicy {
  /** Press the grid's own "Add Row" to make room for another container. */
  clickAddRow: boolean;
  /** Press Save / Continue / Next between screens. */
  clickContinue: boolean;
  /** Press Submit, or accept a declaration. Not a setting; never true. */
  submitShippingInstruction: false;
  /** Perform or assist a login, or handle MFA. Never true. */
  performLogin: false;
}

export const INTTRA_AUTOMATION_POLICY: Readonly<InttraAutomationPolicy> = Object.freeze({
  clickAddRow: false,
  clickContinue: false,
  submitShippingInstruction: false,
  performLogin: false,
});

export function assertInttraAutomationAllowed(action: keyof InttraAutomationPolicy): void {
  if (INTTRA_AUTOMATION_POLICY[action] !== true) {
    throw new Error(
      `INTTRA Helper does not press INTTRA controls ("${action}" is disabled in inttra-extension/src/content/automationPolicy.ts). ` +
        'Save, continue and submit remain the operator’s own actions.',
    );
  }
}
