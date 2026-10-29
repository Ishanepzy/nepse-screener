import { PRESETS, type Preset } from '../../shared/presets.ts';
import type { OverviewItem } from '../api.ts';

interface Props {
  active: string | null;
  overview: OverviewItem[];
  onPick: (id: string) => void;
}

const GROUPS: { label: string; match: (p: Preset) => boolean }[] = [
  { label: 'Bullish', match: (p) => p.bias === 'bull' },
  { label: 'Bearish', match: (p) => p.bias === 'bear' },
  { label: 'Activity', match: (p) => p.bias === 'neutral' },
];

export function PresetStrip({ active, overview, onPick }: Props) {
  const byId = new Map(overview.map((o) => [o.id, o]));
  return (
    <section className="card presets" aria-label="Preset scans">
      <h2 className="section-title">Quick scans</h2>
      {GROUPS.map((g) => (
        <div key={g.label} className="preset-row">
          <span className="preset-label">{g.label}</span>
          <div className="preset-chips">
            {PRESETS.filter(g.match).map((p) => {
              const o = byId.get(p.id);
              const tip = `${p.description}${o?.top.length ? `\nMost liquid: ${o.top.join(', ')}` : ''}`;
              return (
                <button
                  key={p.id}
                  className={`preset ${p.bias} ${active === p.id ? 'on' : ''} ${o?.count === 0 ? 'empty' : ''}`}
                  title={tip}
                  aria-pressed={active === p.id}
                  onClick={() => onPick(p.id)}
                >
                  <span className="dot" aria-hidden />
                  <span className="preset-name">{p.name}</span>
                  <span className="badge">{o ? o.count : '·'}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
