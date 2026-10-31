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

/** An indicator's number inputs, each with its words around it: `[20] days`, `fast [12]`, `× [2] std dev`. */
export function ParamInputs({ id, params, onChange }: { id: string; params: number[]; onChange: (params: number[]) => void }) {
  const def = getDef(id);
  const isValue = id === 'value';
  return (
    <>
      {def.params.map((p, i) => (
        <span key={i} className="param">
          {p.before && <span className="param-word">{p.before}</span>}
          <NumInput
            title={`${def.label}: ${p.label}`}
            value={params[i] ?? p.default}
            min={p.min}
            max={p.max}
            float={p.float}
            width={isValue ? '6ch' : '3.6ch'}
            onChange={(v) => {
              const next = [...params];
              next[i] = v;
              onChange(next);
            }}
          />
          {p.after && <span className="param-word">{p.after}</span>}
        </span>
      ))}
    </>
  );
}

export function OperandPicker({ value, onChange, label }: { value: Operand; onChange: (o: Operand) => void; label: string }) {
  const def = getDef(value.id);
  return (
    <span className="operand">
      <select
        aria-label={label}
        value={value.id}
        onChange={(e) => {
          const next = defaultOperand(e.target.value);
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
      {def.lines.length > 1 && (
        <select aria-label={`${def.label} line`} value={value.line} onChange={(e) => onChange({ ...value, line: e.target.value })}>
          {def.lines.map((l) => (
            <option key={l.key} value={l.key}>
              {l.label}
            </option>
          ))}
        </select>
      )}
      <ParamInputs id={value.id} params={value.params} onChange={(params) => onChange({ ...value, params })} />
    </span>
  );
}
