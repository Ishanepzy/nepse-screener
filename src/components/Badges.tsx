import type { CSSProperties } from 'react';
import { CANSLIM, STAGE_NAMES, TREND_TEMPLATE, type Stage } from '../../shared/analysis.ts';

// --sec for a .sector-chip; sectors without a colour of their own (funds, debentures) fall back to grey
export const sectorStyle = (name: string) => ({ '--sec': `var(--sec-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}, var(--muted))` }) as CSSProperties;

export const STAGE_HELP =
  "Stan Weinstein's stages, from the 30-week average of weekly closes: 1 Basing (flat after a fall), 2 Advancing (above a rising average), 3 Topping (flat after a rise), 4 Declining (below a falling average).";

export function StageBadge({ stage, weeks }: { stage: Stage | null; weeks: number }) {
  if (!stage) return <span className="muted" title="Not enough history (needs about 8 months)">—</span>;
  return (
    <span className={`stage s${stage}`} title={`Stage ${stage}, ${STAGE_NAMES[stage]}, for ${weeks} ${weeks === 1 ? 'week' : 'weeks'}.\n${STAGE_HELP}`}>
      {stage}
      <span className="stage-wk">{weeks}w</span>
    </span>
  );
}

export function RsBadge({ rs }: { rs: number | null }) {
  if (rs == null) return <span className="muted">—</span>;
  const tier = rs >= 80 ? 'hi' : rs >= 50 ? 'mid' : 'lo';
  return (
    <span className={`rs ${tier}`} title={`RS rating ${rs}: stronger than ${rs}% of company shares over the last 12 months (latest 3 counted double)`}>
      {rs}
    </span>
  );
}

export function TrendTemplateBadge({ tt, checks }: { tt: number; checks?: boolean[] }) {
  const missed = checks?.length ? TREND_TEMPLATE.filter((_, i) => !checks[i]) : [];
  const title = tt === 8 ? 'Meets all 8 trend template rules' : `Meets ${tt} of 8 trend template rules.${missed.length ? `\nMissing:\n• ${missed.join('\n• ')}` : ''}`;
  return (
    <span className={`tt ${tt === 8 ? 'pass' : tt >= 6 ? 'near' : ''}`} title={title}>
      {tt === 8 ? '✓ 8/8' : `${tt}/8`}
    </span>
  );
}

// The seven CAN SLIM letters: green = met, dim = not met, faint = no data (C, A, I; M before the index has history).
export function CanSlimLetters({ c, m }: { c: { n: boolean; s: boolean; l: boolean }; m: boolean | null }) {
  const state = (x: boolean | null) => (x == null ? 'na' : x ? 'on' : 'off');
  const letters: [string, boolean | null][] = [
    ['C', null],
    ['A', null],
    ['N', c.n],
    ['S', c.s],
    ['L', c.l],
    ['I', null],
    ['M', m],
  ];
  const line = (ok: boolean | null, text: string) => `${ok == null ? '–' : ok ? '✓' : '✗'} ${text}`;
  const title = [line(c.n, CANSLIM.n), line(c.s, CANSLIM.s), line(c.l, CANSLIM.l), line(m, CANSLIM.m), `– ${CANSLIM.missing}`].join('\n');
  return (
    <span className="canslim" title={title}>
      {letters.map(([l, ok]) => (
        <b key={l} className={state(ok)}>
          {l}
        </b>
      ))}
    </span>
  );
}
