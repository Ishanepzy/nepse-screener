import { useState, type CSSProperties, type ReactNode } from 'react';
import { usePopover } from '../usePopover.ts';
import { load, save } from '../storage.ts';
import {
  COLOR_KEYS,
  TOOL_GROUPS,
  TOOLS,
  colorValue,
  styleOf,
  styleOptions,
  toolById,
  type ColorKey,
  type Dash,
  type Drawing,
  type Style,
  type ToolId,
} from './drawings.ts';

const GROUP_KEY = 'nepse.drawings.groupTool';

const I: Record<string, ReactNode> = {
  cursor: <path d="M5 3l11 6.5-4.6 1.2L9.5 15z" fill="currentColor" stroke="none" />,
  trend: (
    <>
      <path d="M4 15L15 4" />
      <circle cx="4" cy="15" r="1.8" />
      <circle cx="15" cy="4" r="1.8" />
    </>
  ),
  ray: (
    <>
      <path d="M3.5 14.5L16 4" />
      <circle cx="3.5" cy="14.5" r="1.8" />
      <path d="M12 4h4v4" />
    </>
  ),
  extended: (
    <>
      <path d="M2 16L17 3" />
      <circle cx="6.6" cy="12.1" r="1.8" />
      <circle cx="12.4" cy="7" r="1.8" />
    </>
  ),
  arrow: (
    <>
      <path d="M4 15L15 4" />
      <path d="M9 4h6v6" />
    </>
  ),
  hline: (
    <>
      <path d="M2 10h15" />
      <circle cx="9.5" cy="10" r="1.8" />
    </>
  ),
  hray: (
    <>
      <path d="M6 10h11" />
      <circle cx="4" cy="10" r="1.8" />
    </>
  ),
  vline: (
    <>
      <path d="M9.5 2v15" />
      <circle cx="9.5" cy="9.5" r="1.8" />
    </>
  ),
  channel: (
    <>
      <path d="M2 11.5L12 3.5M7 16.5l10-8" />
      <path d="M4.5 14l10-8" strokeDasharray="1.5 2.5" />
    </>
  ),
  fib: <path d="M3 4h13M3 8h13M3 11.5h13M3 15h13" />,
  info: (
    <>
      <path d="M3 16L12 7" />
      <circle cx="3" cy="16" r="1.6" />
      <circle cx="12" cy="7" r="1.6" />
      <rect x="10.5" y="1.8" width="7" height="3.4" rx="1" />
    </>
  ),
  cross: (
    <>
      <path d="M2 9.5h15M9.5 2v15" />
      <circle cx="9.5" cy="9.5" r="1.8" />
    </>
  ),
  pitchfork: <path d="M2.5 13L8 9.5M8 4.5v10M8 4.5l9 1.5M8 9.5h9M8 14.5l9-1.5" />,
  fibtz: <path d="M3 3v13M5.5 3v13M8 3v13M11.5 3v13M16.5 3v13" />,
  circle: <circle cx="9.5" cy="9.5" r="6.5" />,
  triangle: <path d="M9.5 3L17 16H2z" />,
  curve: <path d="M3 15Q9.5 0 16 15" />,
  dcurve: <path d="M2 14C6 1 13 18 17 5" />,
  arc: <path d="M3 14.5A7 7 0 0 1 16 14.5" />,
  path: (
    <>
      <path d="M2.5 15l4-6 4 3 6-8" />
      <circle cx="2.5" cy="15" r="1.4" />
      <circle cx="16.5" cy="4" r="1.4" />
    </>
  ),
  callout: (
    <>
      <rect x="6" y="2.5" width="11" height="8" rx="1.5" />
      <path d="M8.5 10.5L3 16" />
    </>
  ),
  pricelabel: <path d="M2.5 9.5l4-4h10.5v8H6.5z" />,
  markup: <path d="M9.5 3l5 5h-3v8.5h-4V8h-3z" />,
  markdown: <path d="M9.5 16.5l5-5h-3V3h-4v8.5h-3z" />,
  fibext: (
    <>
      <path d="M2 16l3.5-7 3 4" />
      <path d="M10.5 4h6.5M10.5 8h6.5M10.5 12h6.5" />
    </>
  ),
  rect: <rect x="3.5" y="5" width="12" height="9" rx="1" />,
  ellipse: <ellipse cx="9.5" cy="9.5" rx="7" ry="5" />,
  brush: <path d="M2.5 14c2-1 3-5.5 5-5.5s2 4 4 4 3-6.5 5-8.5" />,
  measure: <path d="M9.5 3v13M6.5 6l3-3 3 3M6.5 13l3 3 3-3" />,
  long: (
    <>
      <rect x="3" y="3" width="13" height="7" rx="1" fill="currentColor" fillOpacity="0.22" />
      <rect x="3" y="10" width="13" height="5.5" rx="1" />
    </>
  ),
  short: (
    <>
      <rect x="3" y="3.5" width="13" height="5.5" rx="1" />
      <rect x="3" y="9" width="13" height="7" rx="1" fill="currentColor" fillOpacity="0.22" />
    </>
  ),
  text: <path d="M4 5.5V3.5h11v2M9.5 3.5V16M7 16h5" />,
  magnet: (
    <>
      <path d="M5.5 3.5v5.5a4 4 0 0 0 8 0V3.5" />
      <path d="M3.8 3.5h3.4M11.8 3.5h3.4" strokeWidth="2.6" />
    </>
  ),
  stay: (
    <>
      <path d="M4 15.5l.8-3.6 8.4-8.4 2.8 2.8-8.4 8.4z" />
      <path d="M11.6 5.1l2.8 2.8" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="8.5" width="11" height="8" rx="1.5" />
      <path d="M6.5 8.5V6a3 3 0 0 1 6 0v2.5" />
    </>
  ),
  unlock: (
    <>
      <rect x="4" y="8.5" width="11" height="8" rx="1.5" />
      <path d="M6.5 8.5V6a3 3 0 0 1 5.8-1.1" />
    </>
  ),
  eye: (
    <>
      <path d="M1.8 9.5S5 4 9.5 4s7.7 5.5 7.7 5.5S14 15 9.5 15 1.8 9.5 1.8 9.5z" />
      <circle cx="9.5" cy="9.5" r="2.4" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M1.8 9.5S5 4 9.5 4s7.7 5.5 7.7 5.5S14 15 9.5 15 1.8 9.5 1.8 9.5z" />
      <path d="M3 3l13 13" />
    </>
  ),
  undo: (
    <>
      <path d="M6.5 4.5L3 8l3.5 3.5" />
      <path d="M3.5 8h7.5a4.5 4.5 0 0 1 0 9H8" />
    </>
  ),
  redo: (
    <>
      <path d="M12.5 4.5L16 8l-3.5 3.5" />
      <path d="M15.5 8H8a4.5 4.5 0 0 0 0 9h3" />
    </>
  ),
  trash: <path d="M4 6h11M8 6V4h3v2M6 6l1 10h5l1-10" />,
  clone: (
    <>
      <rect x="6.5" y="6.5" width="9.5" height="9.5" rx="1.5" />
      <path d="M12.5 6.5V4.5a1.5 1.5 0 0 0-1.5-1.5H4.5A1.5 1.5 0 0 0 3 4.5V11a1.5 1.5 0 0 0 1.5 1.5h2" />
    </>
  ),
  extLeft: (
    <>
      <path d="M2.5 9.5h14" />
      <path d="M5.5 6.5l-3 3 3 3" />
      <circle cx="13" cy="9.5" r="1.6" />
    </>
  ),
  extRight: (
    <>
      <path d="M2.5 9.5h14" />
      <path d="M13.5 6.5l3 3-3 3" />
      <circle cx="6" cy="9.5" r="1.6" />
    </>
  ),
  fill: <rect x="3.5" y="4.5" width="12" height="10" rx="1.5" fill="currentColor" fillOpacity="0.35" />,
  textEdit: <path d="M4 15.5l.8-3.6 8.4-8.4 2.8 2.8-8.4 8.4zM11.6 5.1l2.8 2.8" />,
};

export function Icon({ name, size = 19 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 19 19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {I[name]}
    </svg>
  );
}

function ToolButton({ label, icon, active, disabled, onClick }: { label: string; icon: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button className={`tool ${active ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}


interface ToolbarProps {
  tool: ToolId | null;
  onTool: (t: ToolId | null) => void;
  magnet: boolean;
  onMagnet: (v: boolean) => void;
  stay: boolean;
  onStay: (v: boolean) => void;
  lockAll: boolean;
  onLockAll: (v: boolean) => void;
  hideAll: boolean;
  onHideAll: (v: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  count: number;
  onClearAll: () => void;
}

export function DrawingToolbar(p: ToolbarProps) {
  // each group shows the tool last picked from it
  const [picked, setPicked] = useState<Record<string, ToolId>>(() => {
    const v = load(GROUP_KEY);
    return v && typeof v === 'object' ? (v as Record<string, ToolId>) : {};
  });
  const pick = (group: string, id: ToolId) => {
    const next = { ...picked, [group]: id };
    setPicked(next);
    save(GROUP_KEY, next);
    p.onTool(id);
  };
  return (
    <div className="cp-tools" role="toolbar" aria-label="Drawing tools">
      <ToolButton label="Select and move (Esc)" icon="cursor" active={!p.tool} onClick={() => p.onTool(null)} />
      {TOOL_GROUPS.map((g) => {
        const current = g.tools.includes(p.tool as ToolId) ? (p.tool as ToolId) : g.tools.includes(picked[g.id]) ? picked[g.id] : g.tools[0];
        return <ToolGroup key={g.id} group={g} current={current} active={g.tools.includes(p.tool as ToolId)} onPick={(id) => pick(g.id, id)} onToggle={() => p.onTool(p.tool === current ? null : current)} />;
      })}
      <span className="tool-sep" />
      <ToolButton label={p.magnet ? 'Magnet on: points snap to the bar’s open, high, low or close' : 'Magnet: snap points to the bar’s open, high, low or close'} icon="magnet" active={p.magnet} onClick={() => p.onMagnet(!p.magnet)} />
      <ToolButton label={p.stay ? 'Keep drawing: on. The tool stays picked after each drawing.' : 'Keep drawing: keep the tool picked after each drawing'} icon="stay" active={p.stay} onClick={() => p.onStay(!p.stay)} />
      <ToolButton label={p.lockAll ? 'Drawings are locked. Click to unlock.' : 'Lock all drawings so they can’t be moved'} icon={p.lockAll ? 'lock' : 'unlock'} active={p.lockAll} onClick={() => p.onLockAll(!p.lockAll)} />
      <ToolButton label={p.hideAll ? 'Drawings are hidden. Click to show them.' : 'Hide all drawings'} icon={p.hideAll ? 'eyeOff' : 'eye'} active={p.hideAll} onClick={() => p.onHideAll(!p.hideAll)} />
      <span className="tool-sep" />
      <ToolButton label="Undo (Ctrl+Z)" icon="undo" disabled={!p.canUndo} onClick={p.onUndo} />
      <ToolButton label="Redo (Ctrl+Y)" icon="redo" disabled={!p.canRedo} onClick={p.onRedo} />
      <ToolButton label={p.count ? `Remove all ${p.count} drawings on this chart` : 'No drawings on this chart'} icon="trash" disabled={!p.count} onClick={p.onClearAll} />
    </div>
  );
}

function ToolGroup({
  group,
  current,
  active,
  onPick,
  onToggle,
}: {
  group: (typeof TOOL_GROUPS)[number];
  current: ToolId;
  active: boolean;
  onPick: (id: ToolId) => void;
  onToggle: () => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const [pos, setPos] = useState<CSSProperties>({});
  const t = toolById(current)!;
  const many = group.tools.length > 1;
  const openFly = (btn: HTMLElement) => {
    const r = btn.closest('.tool-group')!.getBoundingClientRect();
    // beside a vertical toolbar, under a horizontal one (phones)
    const below = getComputedStyle(btn.closest('.cp-tools')!).flexDirection === 'row';
    setPos(below ? { top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 250) } : { top: Math.min(r.top, window.innerHeight - 40 * group.tools.length - 50), left: r.right + 6 });
    setOpen(!open);
  };
  return (
    <div className="tool-group" ref={ref}>
      <button className={`tool ${active ? 'on' : ''}`} title={`${t.label}${t.key ? ` (${t.key})` : ''}: ${t.help}`} aria-label={t.label} aria-pressed={active} onClick={onToggle}>
        <Icon name={current} />
      </button>
      {many && (
        <button className="tool-more" aria-label={`More ${group.label.toLowerCase()}`} aria-expanded={open} title={`All ${group.label.toLowerCase()}`} onClick={(e) => openFly(e.currentTarget)}>
          <svg width="7" height="7" viewBox="0 0 7 7" aria-hidden>
            <path d="M1 6h5V1z" fill="currentColor" />
          </svg>
        </button>
      )}
      {open && (
        <div className="tool-fly" role="menu" aria-label={group.label} style={pos}>
          <div className="pop-sub">{group.label}</div>
          {group.tools.map((id) => {
            const x = TOOLS.find((y) => y.id === id)!;
            return (
              <button
                key={id}
                role="menuitemradio"
                aria-checked={id === current}
                className={`fly-item ${id === current ? 'on' : ''}`}
                title={x.help}
                onClick={() => {
                  setOpen(false);
                  onPick(id);
                }}
              >
                <Icon name={id} />
                <span>{x.label}</span>
                {x.key && <kbd>{x.key}</kbd>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- the bar over the chart for the selected drawing ----------

interface StyleBarProps {
  drawing: Drawing;
  theme: 'light' | 'dark';
  locked: boolean;
  onStyle: (s: Partial<Style>) => void;
  onLock: (v: boolean) => void;
  onClone: () => void;
  onDelete: () => void;
  onEditText: () => void;
}

const DASHES: { id: Dash; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'dotted', label: 'Dotted' },
];
const SIZES = [11, 13, 16, 20, 28];
const COLOR_NAMES: Record<ColorKey, string> = {
  blue: 'Blue',
  orange: 'Orange',
  green: 'Green',
  amber: 'Amber',
  pink: 'Pink',
  indigo: 'Indigo',
  red: 'Red',
  forest: 'Dark green',
  ink: 'Text colour',
  grey: 'Grey',
};

export function DrawingStyleBar({ drawing, theme, locked, onStyle, onLock, onClone, onDelete, onEditText }: StyleBarProps) {
  const st = styleOf(drawing);
  const can = styleOptions(drawing.type);
  const lockedHere = locked || !!drawing.locked;
  const label = drawing.type === 'hline' && !st.ext[0] ? 'Horizontal ray' : TOOLS.find((t) => t.type === drawing.type && (drawing.type !== 'line' || !t.style))?.label;
  return (
    <div className="style-bar" role="toolbar" aria-label={`${label ?? 'Drawing'} settings`} onPointerDown={(e) => e.stopPropagation()}>
      <span className="sb-name">{label}</span>
      {can.color && (
        <Pop label="Colour" button={<i className="sb-swatch" style={{ background: colorValue(st.color, theme) }} />}>
          {(close) => (
            <div className="sb-colors">
              {COLOR_KEYS.map((k) => (
                <button
                  key={k}
                  className={`sb-color ${k === st.color ? 'on' : ''}`}
                  style={{ background: colorValue(k, theme) }}
                  aria-label={COLOR_NAMES[k]}
                  title={COLOR_NAMES[k]}
                  onClick={() => {
                    onStyle({ color: k });
                    close();
                  }}
                />
              ))}
            </div>
          )}
        </Pop>
      )}
      {can.width && (
        <Pop label="Line width" button={<span className="sb-text">{st.width}px</span>}>
          {(close) =>
            [1, 2, 3, 4].map((w) => (
              <button
                key={w}
                className={`sb-opt ${w === st.width ? 'on' : ''}`}
                onClick={() => {
                  onStyle({ width: w });
                  close();
                }}
              >
                <i className="sb-line" style={{ height: w }} /> {w}px
              </button>
            ))
          }
        </Pop>
      )}
      {can.dash && (
        <Pop label="Line style" button={<svg width="22" height="10" aria-hidden><line x1="1" y1="5" x2="21" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={st.dash === 'dashed' ? '5 3' : st.dash === 'dotted' ? '1 3' : undefined} strokeLinecap="round" /></svg>}>
          {(close) =>
            DASHES.map((x) => (
              <button
                key={x.id}
                className={`sb-opt ${x.id === st.dash ? 'on' : ''}`}
                onClick={() => {
                  onStyle({ dash: x.id });
                  close();
                }}
              >
                <svg width="34" height="10" aria-hidden>
                  <line x1="1" y1="5" x2="33" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={x.id === 'dashed' ? '6 4' : x.id === 'dotted' ? '1 4' : undefined} strokeLinecap="round" />
                </svg>
                {x.label}
              </button>
            ))
          }
        </Pop>
      )}
      {can.size && (
        <Pop label="Text size" button={<span className="sb-text">{st.size}px</span>}>
          {(close) =>
            SIZES.map((s) => (
              <button
                key={s}
                className={`sb-opt ${s === st.size ? 'on' : ''}`}
                onClick={() => {
                  onStyle({ size: s });
                  close();
                }}
              >
                <span style={{ fontSize: Math.min(s, 20) }}>Aa</span> {s}px
              </button>
            ))
          }
        </Pop>
      )}
      {can.size && <SbButton label="Edit the text (or double-click it)" icon="textEdit" onClick={onEditText} disabled={lockedHere} />}
      {can.fill && <SbButton label={st.fill ? 'Background on' : 'Background off'} icon="fill" on={st.fill} onClick={() => onStyle({ fill: !st.fill })} />}
      {can.extLeft && <SbButton label={st.ext[0] ? 'Extends left' : 'Extend left'} icon="extLeft" on={st.ext[0]} onClick={() => onStyle({ ext: [!st.ext[0], st.ext[1]] })} />}
      {can.extRight && <SbButton label={st.ext[1] ? 'Extends right' : 'Extend right'} icon="extRight" on={st.ext[1]} onClick={() => onStyle({ ext: [st.ext[0], !st.ext[1]] })} />}
      <span className="sb-sep" />
      <SbButton label={drawing.locked ? 'Locked. Click to unlock.' : 'Lock it in place'} icon={drawing.locked ? 'lock' : 'unlock'} on={!!drawing.locked} onClick={() => onLock(!drawing.locked)} />
      <SbButton label="Copy it, a few bars to the right" icon="clone" onClick={onClone} />
      <SbButton label="Delete (Delete key)" icon="trash" onClick={onDelete} danger />
    </div>
  );
}

function SbButton({ label, icon, on, danger, disabled, onClick }: { label: string; icon: string; on?: boolean; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button className={`sb-btn ${on ? 'on' : ''} ${danger ? 'danger' : ''}`} title={label} aria-label={label} aria-pressed={on} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={17} />
    </button>
  );
}

function Pop({ label, button, children }: { label: string; button: ReactNode; children: (close: () => void) => ReactNode }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="sb-pop-wrap" ref={ref}>
      <button className="sb-btn" title={label} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        {button}
      </button>
      {open && (
        <div className="sb-pop" role="menu" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
