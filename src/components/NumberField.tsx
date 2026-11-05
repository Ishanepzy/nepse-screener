import { useEffect, useState } from 'react';

/** Free-typing number box; empty reports null. Follows outside changes without rewriting what's being typed. */
export function NumberField({
  value,
  onChange,
  label,
  placeholder,
  width = '10ch',
  min = 0,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
  placeholder?: string;
  width?: string;
  min?: number;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    setText((t) => {
      const typed = t.trim() === '' ? null : Number(t.replace(/,/g, ''));
      return typed === value ? t : value == null ? '' : String(value);
    });
  }, [value]);
  return (
    <input
      className="num"
      inputMode="decimal"
      aria-label={label}
      title={label}
      placeholder={placeholder}
      style={{ width: `calc(${width} + 18px)` }}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === '') return onChange(null);
        const n = Number(t.replace(/,/g, ''));
        if (Number.isFinite(n) && n >= min) onChange(n);
      }}
    />
  );
}
