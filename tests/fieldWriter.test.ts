import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isVisible, isWritable, readAceFieldValue, setAceFieldValue } from '../src/content/fieldWriter.js';

function mount(html: string): void {
  document.body.innerHTML = html;
}

describe('setAceFieldValue', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('writes through the native value setter, so a framework-patched setter cannot swallow it', () => {
    mount('<input id="f" />');
    const input = document.getElementById('f') as HTMLInputElement;
    const nativeGetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.get as () => string;

    // Simulate a framework that has replaced the instance-level accessors and
    // drops assignments made through them.
    let shadow = '';
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => shadow,
      set: () => {
        /* a patched setter that ignores the assignment */
      },
    });

    const result = setAceFieldValue(input, '79832');

    // The real DOM value was set even though the patched setter ignored it.
    expect(nativeGetter.call(input)).toBe('79832');
    expect(shadow).toBe('');
    // ...and the read-back through the page's own accessor disagreed, so the
    // write is reported as not having stuck rather than as a silent success.
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/did not keep the value/i);
  });

  it('dispatches input and change (and blur when asked)', () => {
    mount('<input id="f" />');
    const input = document.getElementById('f') as HTMLInputElement;
    const seen: string[] = [];
    for (const type of ['input', 'change', 'blur', 'focusout']) {
      input.addEventListener(type, () => seen.push(type));
    }

    setAceFieldValue(input, '80', { blur: true });
    expect(seen).toEqual(['input', 'change', 'blur', 'focusout']);
  });

  it('does not dispatch blur when blur is off', () => {
    mount('<input id="f" />');
    const input = document.getElementById('f') as HTMLInputElement;
    const seen: string[] = [];
    for (const type of ['input', 'change', 'blur', 'focusout']) {
      input.addEventListener(type, () => seen.push(type));
    }

    setAceFieldValue(input, '80', { blur: false });
    expect(seen).toEqual(['input', 'change']);
  });

  it('bubbles input and change so delegated handlers see them', () => {
    mount('<form id="wrap"><input id="f" /></form>');
    const input = document.getElementById('f') as HTMLInputElement;
    const handler = vi.fn();
    (document.getElementById('wrap') as HTMLElement).addEventListener('input', handler);

    setAceFieldValue(input, '80');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('writes the value and reads it back', () => {
    mount('<input id="f" />');
    const input = document.getElementById('f') as HTMLInputElement;
    expect(setAceFieldValue(input, '633600.00')).toMatchObject({ ok: true, readBack: '633600.00' });
    expect(readAceFieldValue(input)).toBe('633600.00');
  });

  it('writes into a textarea', () => {
    mount('<textarea id="f"></textarea>');
    const area = document.getElementById('f') as HTMLTextAreaElement;
    expect(setAceFieldValue(area, 'SHELLED ALMONDS').ok).toBe(true);
    expect(area.value).toBe('SHELLED ALMONDS');
  });

  it('accepts a reformatted value as success', () => {
    mount('<input id="f" />');
    const input = document.getElementById('f') as HTMLInputElement;
    input.addEventListener('change', () => {
      // ACE-style input mask that re-formats on change.
      input.value = '03/12/2026';
    });

    const result = setAceFieldValue(input, '03122026');
    expect(result.ok).toBe(true);
    expect(result.reason).toMatch(/reformatted/i);
  });

  it('reports a value the page rejected', () => {
    mount('<input id="f" />');
    const input = document.getElementById('f') as HTMLInputElement;
    input.addEventListener('change', () => {
      input.value = '';
    });

    const result = setAceFieldValue(input, '79832');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/did not keep the value/i);
  });

  it('refuses disabled, read-only, and missing fields', () => {
    mount('<input id="a" disabled /><input id="b" readonly /><input id="c" aria-disabled="true" />');
    for (const id of ['a', 'b', 'c']) {
      const result = setAceFieldValue(document.getElementById(id), '1');
      expect(result.ok, id).toBe(false);
      expect(result.reason, id).toMatch(/missing, disabled, or read-only/i);
    }
    expect(setAceFieldValue(null, '1').ok).toBe(false);
  });

  it('never throws', () => {
    mount('<div id="d"></div>');
    expect(() => setAceFieldValue(document.getElementById('d'), '1')).not.toThrow();
    expect(setAceFieldValue(document.getElementById('d'), '1').ok).toBe(false);
  });
});

describe('setAceFieldValue on <select>', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="uom">
        <option value="">-- select --</option>
        <option value="KG">KG - Kilograms</option>
        <option value="NO">NO - Number</option>
      </select>
      <select id="license">
        <option value=""></option>
        <option value="c33x">C33 - License Exception</option>
      </select>`;
  });

  it('selects by option value', () => {
    const select = document.getElementById('uom') as HTMLSelectElement;
    const result = setAceFieldValue(select, 'KG');
    expect(result).toMatchObject({ ok: true, readBack: 'KG' });
    expect(select.value).toBe('KG');
  });

  it('selects by the visible option text', () => {
    const select = document.getElementById('uom') as HTMLSelectElement;
    expect(setAceFieldValue(select, 'NO - Number')).toMatchObject({ ok: true, readBack: 'NO' });
  });

  it('selects by a code prefix in the option label', () => {
    const select = document.getElementById('license') as HTMLSelectElement;
    const result = setAceFieldValue(select, 'C33');
    expect(result.ok).toBe(true);
    expect(select.value).toBe('c33x');
    expect(result.selectedText).toBe('C33 - License Exception');
  });

  it('refuses to guess when no option matches', () => {
    const select = document.getElementById('uom') as HTMLSelectElement;
    const result = setAceFieldValue(select, 'DOZ');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/No dropdown option matches/i);
    expect(select.value).toBe('');
  });

  it('dispatches change on a select', () => {
    const select = document.getElementById('uom') as HTMLSelectElement;
    const handler = vi.fn();
    select.addEventListener('change', handler);
    setAceFieldValue(select, 'KG');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('writability and visibility helpers', () => {
  it('recognises writable controls', () => {
    document.body.innerHTML = '<input id="a" /><select id="b"></select><textarea id="c"></textarea><div id="d"></div>';
    expect(isWritable(document.getElementById('a'))).toBe(true);
    expect(isWritable(document.getElementById('b'))).toBe(true);
    expect(isWritable(document.getElementById('c'))).toBe(true);
    expect(isWritable(document.getElementById('d'))).toBe(false);
    expect(isWritable(null)).toBe(false);
  });

  it('treats display:none and hidden as invisible', () => {
    document.body.innerHTML = '<input id="a" style="display:none" /><input id="b" hidden /><input id="c" />';
    expect(isVisible(document.getElementById('a') as Element)).toBe(false);
    expect(isVisible(document.getElementById('b') as Element)).toBe(false);
    expect(isVisible(document.getElementById('c') as Element)).toBe(true);
  });
});
