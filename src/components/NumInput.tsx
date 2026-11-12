import { useEffect, useState } from 'react';

interface Props {
  value: number;
  onChange: (v: number) => void;
  title?: string;
  min?: number;
  max?: number;
  float?: boolean;
  width?: string;
  className?: string;
}

// Lets you type freely ("", "-", "1.") and reports only numbers inside min..max. Clamping waits for blur:
// doing it per keystroke turned the "0" of "0.95" into the minimum and the rest could not be typed.
export function NumInput({ value, onChange, title, min, max, float, width = '4.5ch', className }: Props) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(value)));
  }, [value]);

  const parse = (t: string): number | null => {
    const n = Number(t);
    if (t.trim() === '' || !Number.isFinite(n)) return null;
    return float ? n : Math.round(n);
  };
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));

  return (
    <input
      className={`num ${className ?? ''}`}
      type="text"
      inputMode={float ? 'decimal' : 'numeric'}
      value={text}
      title={title}
      aria-label={title}
      style={{ width: `calc(${width} + 14px)` }}
      onChange={(e) => {
        setText(e.target.value);
        const v = parse(e.target.value);
        if (v != null && v === clamp(v)) onChange(v);
      }}
      onBlur={() => {
        const v = parse(text);
        const next = v == null ? value : clamp(v);
        if (next !== value) onChange(next);
        setText(String(next));
      }}
    />
  );
}
