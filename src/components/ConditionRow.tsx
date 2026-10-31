import { useState } from 'react';
import type { Condition, Op } from '../../shared/types.ts';
import { isCross, isUnary } from '../../shared/screener.ts';
import { OperandPicker } from './OperandPicker.tsx';
import { NumInput } from './NumInput.tsx';
import { describeCondition } from '../describe.ts';

const OPS: { value: Op; label: string }[] = [
  { value: 'crossAbove', label: 'crosses above' },
  { value: 'crossBelow', label: 'crosses below' },
  { value: 'above', label: 'is above' },
  { value: 'below', label: 'is below' },
  { value: 'rising', label: 'is rising' },
  { value: 'falling', label: 'is falling' },
];

const MULTIPLY_HELP = 'Compare against a multiple of the right side, e.g. "Volume is above 2 times Avg Volume" or "Close is above 0.95 times Highest high".';

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
  const within = cond.within ?? 1;
  const [multiplying, setMultiplying] = useState(factor !== 1);
  const showFactor = !unary && cond.right.id !== 'value' && (multiplying || factor !== 1);

  return (
    <div className="cond">
      <span className="cond-index" aria-hidden>
        {index + 1}
      </span>
      <div className="cond-main">
        <div className="cond-body">
          <OperandPicker label={`Condition ${index + 1}: what to check`} value={cond.left} onChange={(left) => set({ left })} />
          <select aria-label="Comparison" className="op" value={cond.op} onChange={(e) => set({ op: e.target.value as Op })}>
            {OPS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {!unary && (
            <>
              {showFactor && (
                <span className="factor" title={MULTIPLY_HELP}>
                  <NumInput value={factor} float min={0.01} max={100} width="3.5ch" title="Multiplier" onChange={(v) => set({ factor: v })} />
                  <span className="param-word">times</span>
                </span>
              )}
              <OperandPicker label={`Condition ${index + 1}: compared with`} value={cond.right} onChange={(right) => set({ right })} />
              {cond.right.id !== 'value' &&
                (showFactor ? (
                  <button
                    className="btn ghost tiny"
                    title="Remove the multiplier"
                    onClick={() => {
                      setMultiplying(false);
                      set({ factor: 1 });
                    }}
                  >
                    − multiplier
                  </button>
                ) : (
                  <button className="btn ghost tiny" title={MULTIPLY_HELP} onClick={() => setMultiplying(true)}>
                    + multiplier
                  </button>
                ))}
            </>
          )}
          <span className="within">
            <span className="param-word">{cross ? 'within the last' : 'for'}</span>
            <NumInput value={within} min={1} max={250} width="3ch" title={cross ? 'How many trading days back to look for the cross' : 'How many trading days in a row'} onChange={(v) => set({ within: v })} />
            <span className="param-word">{cross ? (within === 1 ? 'trading day' : 'trading days') : within === 1 ? 'day' : 'days in a row'}</span>
          </span>
          {cross && (
            <label className="check" title="Leave out stocks where the cross has already reversed">
              <input type="checkbox" checked={cond.holds !== false} onChange={(e) => set({ holds: e.target.checked })} />
              and still {cond.op === 'crossAbove' ? 'above' : 'below'} today
            </label>
          )}
        </div>
        <p className="cond-say">{describeCondition(cond)}</p>
      </div>
      <button className="icon-btn" aria-label={`Remove condition ${index + 1}`} title="Remove this condition" onClick={onRemove}>
        ×
      </button>
    </div>
  );
}
