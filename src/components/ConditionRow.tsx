import { useState } from 'react';
import type { Condition, Op } from '../../shared/types.ts';
import { isCross, isUnary } from '../../shared/screener.ts';
import { OperandPicker } from './OperandPicker.tsx';
import { NumInput } from './NumInput.tsx';

const OPS: { value: Op; label: string }[] = [
  { value: 'crossAbove', label: 'crosses above' },
  { value: 'crossBelow', label: 'crosses below' },
  { value: 'above', label: 'is above' },
  { value: 'below', label: 'is below' },
  { value: 'rising', label: 'is rising' },
  { value: 'falling', label: 'is falling' },
];

interface Props {
  index: number;
  cond: Condition;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}

export function ConditionRow({ index, cond, onChange, onRemove }: Props) {
  const cross = isCross(cond.op);
  const unary = isUnary(cond.op);
  const set = (patch: Partial<Condition>) => onChange({ ...cond, ...patch });
  const factor = cond.factor ?? 1;
  const [showFactor, setShowFactor] = useState(false);

  return (
    <div className="cond">
      <span className="cond-index" aria-hidden>
        {index + 1}
      </span>
      <div className="cond-body">
        <OperandPicker label={`Condition ${index + 1} left side`} value={cond.left} onChange={(left) => set({ left })} />
        <select aria-label="Comparison" className="op" value={cond.op} onChange={(e) => set({ op: e.target.value as Op })}>
          {OPS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {!unary && (
          <>
            {cond.right.id !== 'value' &&
              (showFactor || factor !== 1 ? (
                <span className="factor" title="Multiply the right side, e.g. 2 × Avg Volume, or 0.95 × 52W High">
                  <NumInput value={factor} float min={0.01} max={100} width="3ch" title="Multiplier" onChange={(v) => set({ factor: v })} />
                  <span className="muted">×</span>
                </span>
              ) : (
                <button className="btn ghost tiny" title="Multiply the right side, e.g. 2 × Avg Volume, or 0.95 × 52W High" onClick={() => setShowFactor(true)}>
                  k×
                </button>
              ))}
            <OperandPicker label={`Condition ${index + 1} right side`} value={cond.right} onChange={(right) => set({ right })} />
          </>
        )}
        <span className="within">
          <span className="muted">{cross ? 'within last' : 'for'}</span>
          <NumInput value={cond.within ?? 1} min={1} max={250} width="3ch" title={cross ? 'Look-back window (bars)' : 'Consecutive bars'} onChange={(v) => set({ within: v })} />
          <span className="muted">{(cond.within ?? 1) === 1 ? 'bar' : 'bars'}</span>
        </span>
        {cross && (
          <label className="check" title="Drop stocks where the cross has already reversed">
            <input type="checkbox" checked={cond.holds !== false} onChange={(e) => set({ holds: e.target.checked })} />
            still {cond.op === 'crossAbove' ? 'above' : 'below'}
          </label>
        )}
      </div>
      <button className="icon-btn" aria-label={`Remove condition ${index + 1}`} title="Remove" onClick={onRemove}>
        ×
      </button>
    </div>
  );
}
