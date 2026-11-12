import { useState } from 'react';
import type { Condition, Universe } from '../../shared/types.ts';
import type { SavedScan, Scan } from '../scan.ts';
import { ConditionRow } from './ConditionRow.tsx';
import { defaultOperand } from './OperandPicker.tsx';
import { NumberField } from './NumberField.tsx';
import { usePopover } from '../usePopover.ts';

const RS_OPTIONS = [
  { label: 'Any', value: 0 },
  { label: '50 or more', value: 50 },
  { label: '70 or more', value: 70 },
  { label: '80 or more', value: 80 },
  { label: '90 or more', value: 90 },
];

const TURNOVER_OPTIONS = [
  { label: 'Any amount', value: 0 },
  { label: 'At least Rs 10 lakh', value: 1e6 },
  { label: 'At least Rs 50 lakh', value: 5e6 },
  { label: 'At least Rs 1 crore', value: 1e7 },
  { label: 'At least Rs 5 crore', value: 5e7 },
];

interface Props {
  scan: Scan;
  onChange: (s: Scan) => void;
  saved: SavedScan[];
  onSave: (name: string) => void;
  onLoadSaved: (s: SavedScan) => void;
  onDeleteSaved: (name: string) => void;
}

export function ScanBuilder({ scan, onChange, saved, onSave, onLoadSaved, onDeleteSaved }: Props) {
  const setConditions = (conditions: Condition[]) => onChange({ ...scan, conditions });
  const setUniverse = (patch: Partial<Universe>) => onChange({ ...scan, universe: { ...scan.universe, ...patch } });
  const u = scan.universe;

  const addCondition = () =>
    setConditions([...scan.conditions, { left: defaultOperand('close'), op: 'above', right: { id: 'ema', params: [200], line: 'value' }, within: 1, holds: true }]);

  return (
    <section className="card builder" aria-label="Scan conditions">
      <div className="builder-head">
        <h2 className="section-title">Your scan</h2>
        <SavedMenu saved={saved} onSave={onSave} onLoad={onLoadSaved} onDelete={onDeleteSaved} />
      </div>

      <div className="match-line">
        <span>Show stocks that meet</span>
        <div className="seg" role="group" aria-label="How conditions combine">
          {(['all', 'any'] as const).map((m) => (
            <button key={m} className={scan.match === m ? 'on' : ''} aria-pressed={scan.match === m} onClick={() => onChange({ ...scan, match: m })}>
              {m === 'all' ? 'all' : 'any'}
            </button>
          ))}
        </div>
        <span>of these conditions:</span>
      </div>

      <div className="conds">
        {scan.conditions.map((c, i) => (
          <ConditionRow
            key={i}
            index={i}
            cond={c}
            onChange={(nc) => setConditions(scan.conditions.map((x, j) => (j === i ? nc : x)))}
            onRemove={() => setConditions(scan.conditions.filter((_, j) => j !== i))}
          />
        ))}
        {scan.conditions.length === 0 && (
          <p className="muted empty-conds">No conditions, so every stock that passes the filters below is listed. Pick a quick scan above, or add your own.</p>
        )}
        <button className="btn add" onClick={addCondition} disabled={scan.conditions.length >= 12}>
          + Add condition
        </button>
      </div>

      <div className="universe">
        <span className="filters-label">Filters</span>
        <label className="check" title="Hide mutual funds, debentures, bonds and promoter shares">
          <input type="checkbox" checked={u.equityOnly !== false} onChange={(e) => setUniverse({ equityOnly: e.target.checked })} />
          Company shares only <span className="muted">(no mutual funds or debentures)</span>
        </label>
        <span className="field">
          <span>Price from</span>
          <NumberField value={u.minPrice ?? null} label="Lowest price" placeholder="any" width="6ch" onChange={(v) => setUniverse({ minPrice: v ?? undefined })} />
          <span>to</span>
          <NumberField value={u.maxPrice ?? null} label="Highest price" placeholder="any" width="6ch" onChange={(v) => setUniverse({ maxPrice: v ?? undefined })} />
        </span>
        <label
          className="check"
          title="Mark Minervini's 8 rules: price above a rising 200-day average, 50 > 150 > 200-day averages, at least 30% above the 52-week low, within 25% of the 52-week high, RS rating 70+"
        >
          <input type="checkbox" checked={!!u.trendTemplate} onChange={(e) => setUniverse({ trendTemplate: e.target.checked || undefined })} />
          Meets the trend template
        </label>
        <label className="field" title="Relative strength rating: how the stock's last 12 months (the latest 3 counted double) rank against every other company share. 99 = stronger than 99% of them.">
          <span>RS rating</span>
          <select value={u.minRs ?? 0} onChange={(e) => setUniverse({ minRs: Number(e.target.value) || undefined })}>
            {RS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" title="Average value traded per day over the last 20 trading days. Use it to skip thinly traded stocks.">
          <span>Daily turnover</span>
          <select value={u.minTurnover ?? 0} onChange={(e) => setUniverse({ minTurnover: Number(e.target.value) || undefined })}>
            {TURNOVER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function SavedMenu({
  saved,
  onSave,
  onLoad,
  onDelete,
}: {
  saved: SavedScan[];
  onSave: (name: string) => void;
  onLoad: (s: SavedScan) => void;
  onDelete: (name: string) => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const [name, setName] = useState('');
  return (
    <div className="popover-wrap" ref={ref}>
      <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)} title="Save this scan, or open one you saved before">
        ☆ Saved scans{saved.length ? ` (${saved.length})` : ''} <span className="caret">▾</span>
      </button>
      {open && (
        <div className="popover saved-pop">
          <p className="pop-help">Save these conditions and filters under a name, then reopen them any time. They're kept in this browser only.</p>
          <form
            className="save-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              onSave(name.trim());
              setName('');
            }}
          >
            <input placeholder="e.g. Banks breaking out" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Name for this scan" />
            <button className="btn primary" type="submit" disabled={!name.trim()}>
              Save
            </button>
          </form>
          {saved.length > 0 && <div className="pop-sub">Your saved scans</div>}
          {saved.map((s) => (
            <div key={s.name} className="saved-item">
              <button
                className="link"
                onClick={() => {
                  onLoad(s);
                  setOpen(false);
                }}
              >
                {s.name}
              </button>
              <button className="icon-btn" aria-label={`Delete ${s.name}`} title="Delete" onClick={() => onDelete(s.name)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
