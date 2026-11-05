import type { CostRates } from '../../shared/costs.ts';
import { DEFAULT_RATES } from '../../shared/costs.ts';
import { SLABS } from '../costsStore.ts';
import { NumInput } from './NumInput.tsx';

/** Broker commission slabs, SEBON fee, DP charge and capital gains tax, editable. */
export function RatesEditor({ rates, onChange }: { rates: CostRates; onChange: (r: CostRates) => void }) {
  const isDefault = JSON.stringify(rates) === JSON.stringify(DEFAULT_RATES);
  return (
    <details className="rates">
      <summary>Fees and tax rates{isDefault ? ' (SEBON defaults)' : ' (edited)'}</summary>
      <p className="pop-help">
        Broker commission is charged on the whole order at its slab's rate. Check your broker's contract note: rates change, and some brokers differ.
      </p>
      <div className="rates-grid">
        {SLABS.map((label, i) => (
          <label key={label} className="field">
            <span>{label}</span>
            <NumInput
              float
              min={0}
              max={5}
              width="4ch"
              value={rates.tiers[i].pct}
              title={`Commission, ${label} (%)`}
              onChange={(v) => onChange({ ...rates, tiers: rates.tiers.map((t, j) => (j === i ? { ...t, pct: v } : t)) })}
            />
            <span className="param-word">%</span>
          </label>
        ))}
        <label className="field">
          <span>SEBON fee</span>
          <NumInput float min={0} max={1} width="4ch" value={rates.sebonPct} title="SEBON fee (%)" onChange={(v) => onChange({ ...rates, sebonPct: v })} />
          <span className="param-word">%</span>
        </label>
        <label className="field">
          <span>DP charge per sale</span>
          <span className="param-word">Rs</span>
          <NumInput float min={0} max={1000} width="4ch" value={rates.dpCharge} title="DP charge per stock sold (Rs)" onChange={(v) => onChange({ ...rates, dpCharge: v })} />
        </label>
        <label className="field">
          <span>Capital gains tax, held ≤ 1 year</span>
          <NumInput float min={0} max={50} width="4ch" value={rates.cgtShortPct} title="CGT, held 365 days or less (%)" onChange={(v) => onChange({ ...rates, cgtShortPct: v })} />
          <span className="param-word">%</span>
        </label>
        <label className="field">
          <span>Capital gains tax, held over 1 year</span>
          <NumInput float min={0} max={50} width="4ch" value={rates.cgtLongPct} title="CGT, held over 365 days (%)" onChange={(v) => onChange({ ...rates, cgtLongPct: v })} />
          <span className="param-word">%</span>
        </label>
      </div>
      {!isDefault && (
        <button className="link" onClick={() => onChange(DEFAULT_RATES)}>
          Reset to SEBON defaults
        </button>
      )}
    </details>
  );
}
