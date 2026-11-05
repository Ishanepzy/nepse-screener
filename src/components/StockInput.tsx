import { useEffect, useId, useState } from 'react';
import { api } from '../api.ts';

let cache: Promise<{ symbol: string; name: string }[]> | null = null;
const symbols = () => (cache ??= api.symbols().catch((e) => ((cache = null), Promise.reject(e))));

/** Symbol box with suggestions from every stock in the data. Reports a symbol once it matches one exactly. */
export function StockInput({
  value,
  onPick,
  placeholder = 'Symbol, e.g. NABIL',
  label,
}: {
  value: string;
  onPick: (symbol: string) => void;
  placeholder?: string;
  label: string;
}) {
  const id = useId();
  const [all, setAll] = useState<{ symbol: string; name: string }[]>([]);
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    symbols().then(setAll).catch(() => {});
  }, []);
  const known = (s: string) => all.some((x) => x.symbol === s);
  const name = all.find((x) => x.symbol === text.trim().toUpperCase())?.name;
  return (
    <span className="stock-input">
      <input
        list={id}
        value={text}
        placeholder={placeholder}
        aria-label={label}
        title={name ?? label}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const s = t.trim().toUpperCase();
          if (known(s)) onPick(s);
        }}
        onBlur={() => {
          const s = text.trim().toUpperCase();
          if (known(s) && s !== text) setText(s);
        }}
      />
      <datalist id={id}>
        {all.map((x) => (
          <option key={x.symbol} value={x.symbol}>
            {x.name}
          </option>
        ))}
      </datalist>
    </span>
  );
}
