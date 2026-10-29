import type { Operand } from '../../shared/types.ts';
import { getDef } from '../../shared/registry.ts';
import { NumInput } from './NumInput.tsx';

const GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Price', ids: ['close', 'open', 'high', 'low'] },
  { label: 'Moving averages', ids: ['ema', 'sma', 'wma'] },
  { label: 'Trend & bands', ids: ['supertrend', 'bb', 'hh', 'll'] },
  { label: 'Volume', ids: ['volume', 'volsma'] },
  { label: 'Oscillators', ids: ['rsi', 'macd', 'stoch', 'adx', 'atr', 'roc'] },
  { label: 'Fixed', ids: ['value'] },
];

export function defaultOperand(id: string): Operand {
  const d = getDef(id);
  return { id: d.id, params: d.params.map((p) => p.default), line: d.lines[0].key };
}

export function OperandPicker({ value, onChange, label }: { value: Operand; onChange: (o: Operand) => void; label: string }) {
  const def = getDef(value.id);
  const isValue = def.id === 'value';
  return (
    <span className="operand">
      <select
        aria-label={label}
        value={value.id}
        className={isValue ? 'narrow' : undefined}
        onChange={(e) => {
          const next = defaultOperand(e.target.value);
          // Picking "Number" keeps whatever number was there, so 30 -> RSI -> Number doesn't reset to 0.
          if (next.id === 'value' && value.id === 'value') next.params = value.params;
          onChange(next);
        }}
      >
        {GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.ids.map((id) => (
              <option key={id} value={id}>
                {getDef(id).label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {def.params.map((p, i) => (
        <NumInput
          key={i}
          title={`${def.label} ${p.label}`}
          value={value.params[i] ?? p.default}
          min={p.min}
          max={p.max}
          float={p.float}
          width={isValue ? '6ch' : '3.6ch'}
          onChange={(v) => {
            const params = [...value.params];
            params[i] = v;
            onChange({ ...value, params });
          }}
        />
      ))}
      {def.lines.length > 1 && (
        <select aria-label={`${def.label} line`} value={value.line} onChange={(e) => onChange({ ...value, line: e.target.value })}>
          {def.lines.map((l) => (
            <option key={l.key} value={l.key}>
              {l.label}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}
