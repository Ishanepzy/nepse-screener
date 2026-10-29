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

/** Number box that lets you type freely (empty, "-", "1.") and only reports valid numbers. */
export function NumInput({ value, onChange, title, min, max, float, width = '4.5ch', className }: Props) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(value)));
  }, [value]);

  const commit = (t: string) => {
    const n = Number(t);
    if (t.trim() === '' || !Number.isFinite(n)) return;
    let v = float ? n : Math.round(n);
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    onChange(v);
  };

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
        commit(e.target.value);
      }}
      onBlur={() => setText(String(value))}
    />
  );
}
