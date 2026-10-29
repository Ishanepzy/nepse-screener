import { useEffect, useRef, useState } from 'react';
import type { Condition, Universe } from '../../shared/types.ts';
import type { SectorCount } from '../api.ts';
import type { SavedScan, Scan } from '../scan.ts';
import { ConditionRow } from './ConditionRow.tsx';
import { defaultOperand } from './OperandPicker.tsx';
import { NumInput } from './NumInput.tsx';

const TURNOVER_OPTIONS = [
  { label: 'Any', value: 0 },
  { label: '≥ 10 L', value: 1e6 },
  { label: '≥ 50 L', value: 5e6 },
  { label: '≥ 1 Cr', value: 1e7 },
  { label: '≥ 5 Cr', value: 5e7 },
];

interface Props {
  scan: Scan;
  onChange: (s: Scan) => void;
  sectors: SectorCount[];
  saved: SavedScan[];
  onSave: (name: string) => void;
  onLoadSaved: (s: SavedScan) => void;
  onDeleteSaved: (name: string) => void;
}

export function ScanBuilder({ scan, onChange, sectors, saved, onSave, onLoadSaved, onDeleteSaved }: Props) {
  const setConditions = (conditions: Condition[]) => onChange({ ...scan, conditions });
  const setUniverse = (patch: Partial<Universe>) => onChange({ ...scan, universe: { ...scan.universe, ...patch } });
  const u = scan.universe;
  const [copied, setCopied] = useState(false);

  const addCondition = () =>
    setConditions([...scan.conditions, { left: defaultOperand('close'), op: 'above', right: { id: 'ema', params: [200], line: 'value' }, within: 1, holds: true }]);

  return (
    <section className="card builder" aria-label="Scan conditions">
      <div className="builder-head">
        <h2 className="section-title">Conditions</h2>
        <div className="seg" role="group" aria-label="Match">
          <span className="muted">Match</span>
          {(['all', 'any'] as const).map((m) => (
            <button key={m} className={scan.match === m ? 'on' : ''} aria-pressed={scan.match === m} onClick={() => onChange({ ...scan, match: m })}>
              {m === 'all' ? 'All' : 'Any'}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <SavedMenu saved={saved} onSave={onSave} onLoad={onLoadSaved} onDelete={onDeleteSaved} />
        <button
          className="btn ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard blocked; the URL bar has the same link */
            }
          }}
          title="Copy a link to this scan"
        >
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
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
        {scan.conditions.length === 0 && <p className="muted empty-conds">No conditions yet. Pick a preset above or add one.</p>}
        <button className="btn add" onClick={addCondition} disabled={scan.conditions.length >= 12}>
          + Add condition
        </button>
      </div>

      <div className="universe">
        <SectorPicker sectors={sectors} selected={u.sectors ?? []} onChange={(s) => setUniverse({ sectors: s })} />
        <label className="check">
          <input type="checkbox" checked={u.equityOnly !== false} onChange={(e) => setUniverse({ equityOnly: e.target.checked })} />
          Equities only
        </label>
        <label className="field">
          <span className="muted">Price</span>
          <NumInput value={u.minPrice ?? 0} min={0} float width="5ch" title="Minimum price" onChange={(v) => setUniverse({ minPrice: v || undefined })} />
          <span className="muted">–</span>
          <NumInput value={u.maxPrice ?? 0} min={0} float width="5ch" title="Maximum price (0 = no limit)" onChange={(v) => setUniverse({ maxPrice: v || undefined })} />
        </label>
        <label className="field">
          <span className="muted">Avg turnover</span>
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

function usePopover() {
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
  return { open, setOpen, ref };
}

function SectorPicker({ sectors, selected, onChange }: { sectors: SectorCount[]; selected: string[]; onChange: (s: string[]) => void }) {
  const { open, setOpen, ref } = usePopover();
  const label = selected.length === 0 ? 'All sectors' : selected.length === 1 ? selected[0] : `${selected.length} sectors`;
  const toggle = (name: string) => onChange(selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);
  return (
    <div className="popover-wrap" ref={ref}>
      <button className="btn select-like" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label} <span className="caret">▾</span>
      </button>
      {open && (
        <div className="popover sector-pop">
          <div className="pop-actions">
            <button className="link" onClick={() => onChange([])}>
              All sectors
            </button>
          </div>
          {sectors.map((s) => (
            <label key={s.name} className="check pop-item">
              <input type="checkbox" checked={selected.includes(s.name)} onChange={() => toggle(s.name)} />
              <span>{s.name}</span>
              <span className="muted count">{s.count}</span>
            </label>
          ))}
        </div>
      )}
    </div>
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
      <button className="btn ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        My scans{saved.length ? ` (${saved.length})` : ''} <span className="caret">▾</span>
      </button>
      {open && (
        <div className="popover saved-pop">
          <form
            className="save-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              onSave(name.trim());
              setName('');
            }}
          >
            <input placeholder="Name this scan" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            <button className="btn primary" type="submit" disabled={!name.trim()}>
              Save
            </button>
          </form>
          {saved.length === 0 && <p className="muted small">Saved scans live in this browser.</p>}
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
              <button className="icon-btn" aria-label={`Delete ${s.name}`} onClick={() => onDelete(s.name)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
