/**
 * The F2 calculator overlay: opening, inserting only the result, cancelling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeCalculator,
  configureCalculator,
  isCalculatorOpen,
  isCalculatorTarget,
  openCalculator,
  repositionCalculator,
} from '../src/calculator/calculatorUI.js';

const HOST_SELECTOR = '#ace-helper-calculator-host';

function panelInput(): HTMLInputElement {
  const host = document.querySelector(HOST_SELECTOR) as HTMLElement;
  const root = host.shadowRoot as ShadowRoot;
  return root.querySelector('input.expr') as HTMLInputElement;
}

function panelResult(): HTMLElement {
  const host = document.querySelector(HOST_SELECTOR) as HTMLElement;
  return (host.shadowRoot as ShadowRoot).querySelector('.result') as HTMLElement;
}

function type(text: string): void {
  const input = panelInput();
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function press(key: string): void {
  panelInput().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function target(): HTMLInputElement {
  return document.getElementById('valueOfGoods') as HTMLInputElement;
}

describe('calculator overlay', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <label for="valueOfGoods">Value of Goods</label>
      <input type="text" id="valueOfGoods" />`;
    configureCalculator({ rounding: () => ({ mode: 'decimals', decimals: 2 }), dispatchBlur: true });
  });

  afterEach(() => {
    closeCalculator();
  });

  it('opens beside the focused field', () => {
    openCalculator(target());
    expect(isCalculatorOpen()).toBe(true);
    expect(document.querySelector(HOST_SELECTOR)).not.toBeNull();
    // The panel names the field it will write into.
    const host = document.querySelector(HOST_SELECTOR) as HTMLElement;
    expect((host.shadowRoot as ShadowRoot).textContent).toContain('Value of Goods');
  });

  it('shows the running result as the expression is typed', () => {
    openCalculator(target());
    type('20 * 4');
    expect(panelResult().textContent).toBe('= 80');
    expect(panelResult().className).toContain('ok');
  });

  it('groups the displayed result for readability', () => {
    openCalculator(target());
    type('79833 * 7.94');
    expect(panelResult().textContent).toBe('= 633,874.02');
  });

  it('inserts only the result on Enter, with no separators', () => {
    openCalculator(target());
    type('79833 * 7.94');
    press('Enter');

    expect(target().value).toBe('633874.02');
    expect(isCalculatorOpen()).toBe(false);
    expect(document.querySelector(HOST_SELECTOR)).toBeNull();
  });

  it('dispatches input and change on the ACE field when inserting', () => {
    const events: string[] = [];
    target().addEventListener('input', () => events.push('input'));
    target().addEventListener('change', () => events.push('change'));

    openCalculator(target());
    type('(12000 + 3500) / 2');
    press('Enter');

    expect(target().value).toBe('7750');
    expect(events).toEqual(['input', 'change']);
  });

  it('closes on Escape without changing the field', () => {
    target().value = '100';
    openCalculator(target());
    type('20 * 4');
    press('Escape');

    expect(target().value).toBe('100');
    expect(isCalculatorOpen()).toBe(false);
  });

  it('shows an error and refuses to insert an invalid expression', () => {
    openCalculator(target());
    type('20 * / 4');
    expect(panelResult().className).toContain('err');

    press('Enter');
    expect(target().value).toBe('');
    expect(isCalculatorOpen()).toBe(true);
  });

  it('refuses to insert a division by zero', () => {
    openCalculator(target());
    type('100 / 0');
    expect(panelResult().textContent).toMatch(/divide by zero/i);
    press('Enter');
    expect(target().value).toBe('');
  });

  it('applies the configured rounding', () => {
    configureCalculator({ rounding: () => ({ mode: 'integer', decimals: 0 }), dispatchBlur: false });
    openCalculator(target());
    type('176000 * 0.45359237');
    press('Enter');
    expect(target().value).toBe('79832');
  });

  it('seeds the expression from a numeric field value', () => {
    target().value = '1,200.50';
    openCalculator(target());
    expect(panelInput().value).toBe('1,200.50');
    expect(panelResult().textContent).toBe('= 1,200.5');
  });

  it('does not seed from a non-numeric field value', () => {
    target().value = 'SHELLED ALMONDS';
    openCalculator(target());
    expect(panelInput().value).toBe('');
  });

  it('re-opening moves the single panel rather than stacking panels', () => {
    openCalculator(target());
    openCalculator(target());
    expect(document.querySelectorAll(HOST_SELECTOR)).toHaveLength(1);
  });

  it('closes itself if its field leaves the DOM', () => {
    openCalculator(target());
    target().remove();
    repositionCalculator();
    expect(isCalculatorOpen()).toBe(false);
  });

  it('keeps keystrokes away from the ACE page', () => {
    const pageHandler = vi.fn();
    document.body.addEventListener('keydown', pageHandler);
    openCalculator(target());
    press('5');
    expect(pageHandler).not.toHaveBeenCalled();
  });
});

describe('isCalculatorTarget', () => {
  it('accepts text, number, and textarea controls', () => {
    document.body.innerHTML = `
      <input id="a" type="text" />
      <input id="b" type="number" />
      <input id="c" />
      <textarea id="d"></textarea>`;
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(isCalculatorTarget(document.getElementById(id)), id).toBe(true);
    }
  });

  it('rejects controls a calculator makes no sense for', () => {
    document.body.innerHTML = `
      <input id="a" type="checkbox" />
      <input id="b" type="date" />
      <input id="c" type="text" disabled />
      <input id="d" type="text" readonly />
      <select id="e"></select>
      <div id="f"></div>`;
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      expect(isCalculatorTarget(document.getElementById(id)), id).toBe(false);
    }
    expect(isCalculatorTarget(null)).toBe(false);
  });
});
