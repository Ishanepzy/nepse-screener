import { useEffect, useRef, useState } from 'react';
import { getDef } from '../../shared/registry.ts';
import { CHARTABLE, addIndicator, defaultIndicators, indicatorLabel, type ChartIndicator } from '../chart/indicators.ts';
import { ParamInputs } from './OperandPicker.tsx';

interface Props {
  indicators: ChartIndicator[];
  onChange: (list: ChartIndicator[]) => void;
  colorOf: (ind: ChartIndicator) => string;
  showVolume: boolean;
  onShowVolume: (v: boolean) => void;
}

export function IndicatorMenu({ indicators, onChange, colorOf, showVolume, onShowVolume }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className="popover-wrap" ref={ref}>
      <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden>ƒx</span> Indicators <span className="badge">{indicators.length}</span> <span className="caret">▾</span>
      </button>
      {open && (
        <div className="popover ind-pop">
          <div className="pop-sub">On this chart</div>
          {indicators.length === 0 && <p className="pop-help">None yet. Add one below.</p>}
          {indicators.map((ind) => (
            <div key={ind.uid} className="ind-row">
              <i className="swatch" style={{ background: colorOf(ind) }} aria-hidden />
              <span className="ind-name">{getDef(ind.id).label}</span>
              <span className="ind-params">
                <ParamInputs id={ind.id} params={ind.params} onChange={(params) => onChange(indicators.map((i) => (i.uid === ind.uid ? { ...i, params } : i)))} />
              </span>
              <button className="icon-btn" aria-label={`Remove ${indicatorLabel(ind)}`} title="Remove" onClick={() => onChange(indicators.filter((i) => i.uid !== ind.uid))}>
                ×
              </button>
            </div>
          ))}
          <label className="check ind-row">
            <input type="checkbox" checked={showVolume} onChange={(e) => onShowVolume(e.target.checked)} />
            Volume bars
          </label>

          <div className="pop-sub">Add an indicator</div>
          {CHARTABLE.map((g) => (
            <div key={g.group} className="ind-group">
              <span className="ind-group-name">{g.group}</span>
              <div className="ind-add">
                {g.ids.map((id) => (
                  <button key={id} className="chip" onClick={() => onChange(addIndicator(indicators, id, undefined, false))}>
                    + {getDef(id).label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="pop-actions end">
            <button className="link" onClick={() => onChange(defaultIndicators())}>
              Reset to EMA 20 + EMA 50
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
