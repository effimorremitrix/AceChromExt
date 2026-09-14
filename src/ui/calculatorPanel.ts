/**
 * The calculator, in the panel.
 *
 * The F2 overlay inside ACE is the one that matters and it is untouched: it
 * still opens on the focused numeric field, still inserts only the result, and
 * still works with nothing imported. This is the same calculator with nowhere
 * to insert to, for the times the operator is in the panel and wants to check
 * a number before trusting a line - "is 176,000 lb really 79,832 kg?".
 *
 * It calls `calculate` from src/calculator, exactly as the overlay does. There
 * is one parser and one rounding rule in this codebase, not two.
 */

import { calculate, type CalcResult } from '../calculator/calculator.js';
import type { AceHelperSettings } from '../core/settings.js';
import { clear, el } from './dom.js';

export interface CalculatorPanelOptions {
  settings: AceHelperSettings;
  /** Called with the result string so the caller can log or copy it. */
  onResult?: (expression: string, result: CalcResult) => void;
}

export function renderCalculatorPanel(options: CalculatorPanelOptions): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(
    el('h2', { text: 'Calculator' }),
    el('p', { className: 'small muted' }, [
      el('span', { text: 'ACE numeric fields reject * and /. Inside ACE press ' }),
      el('kbd', { text: 'F2' }),
      el('span', { text: ' beside any numeric field and only the result is typed in. This copy is for checking a number here; it writes nothing to ACE.' }),
    ]),
  );

  const input = el('input', {
    className: 'input mono',
    attrs: { type: 'text', id: 'calc-input', placeholder: '176000 * 0.45359237', autocomplete: 'off', spellcheck: 'false' },
  }) as HTMLInputElement;

  const output = el('div', { className: 'calc-output small', text: ' ' });

  const evaluate = (): void => {
    const expression = input.value;
    clear(output);
    if (expression.trim() === '') {
      output.className = 'calc-output small muted';
      output.append(el('span', { text: 'Type an expression and press Enter.' }));
      return;
    }
    const result = calculate(expression, options.settings.rounding);
    if (result.ok) {
      output.className = 'calc-output small ok';
      output.append(
        el('strong', { text: result.display }),
        el('span', { className: 'muted', text: `  (inserted as ${result.insert})` }),
      );
    } else {
      output.className = 'calc-output small error';
      output.append(el('span', { text: result.message }));
    }
    options.onResult?.(expression, result);
  };

  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    evaluate();
  });

  const go = el('button', { className: 'button', text: 'Calculate', attrs: { type: 'button' } });
  go.addEventListener('click', evaluate);

  section.append(el('label', { className: 'field' }, [el('span', { text: 'Expression' }), input]), el('div', { className: 'actions' }, [go]), output);

  section.append(
    el('div', { className: 'notice notice-muted small' }, [
      el('strong', { text: 'No eval. ' }),
      el('span', {
        text: 'Expressions go through a hand-written parser that can only produce a number. The extension bundle is checked for dynamic code execution on every build.',
      }),
    ]),
  );

  return section;
}
