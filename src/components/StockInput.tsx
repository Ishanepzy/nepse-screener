import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.ts';

let cache: Promise<{ symbol: string; name: string }[]> | null = null;
const symbols = () => (cache ??= api.symbols().catch((e) => ((cache = null), Promise.reject(e))));

// Symbol box with suggestions. A symbol is taken on a suggestion pick, Enter or leaving the box, never while typing:
// CIT is a symbol and also the start of CITY. While the text isn't a committed symbol the parent gets ''.
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
  const reported = useRef(value);
  useEffect(() => {
    // follow the parent, unless it is only echoing what this box told it
    if (value === reported.current) return;
    reported.current = value;
    setText(value);
  }, [value]);
  useEffect(() => {
    symbols().then(setAll).catch(() => {});
  }, []);

  const report = (s: string) => {
    if (s === reported.current) return;
    reported.current = s;
    onPick(s);
  };
  const commit = (t: string) => {
    if (!all.length) return; // list not loaded yet, can't tell
    const s = t.trim().toUpperCase();
    const known = all.some((x) => x.symbol === s);
    if (known) setText(s);
    report(known ? s : '');
  };
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
          // a suggestion pick arrives as a replacement (or as a plain Event on some browsers), typing as an insert
          const ev = e.nativeEvent;
          if (!(ev instanceof InputEvent) || ev.inputType === 'insertReplacementText') commit(t);
          else report('');
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault(); // don't submit a surrounding form with a half-picked stock
          commit(text);
        }}
        onBlur={() => commit(text)}
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
