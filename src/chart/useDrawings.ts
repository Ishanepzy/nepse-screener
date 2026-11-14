import { useEffect, useRef, useState } from 'react';
import { onOtherTab } from '../storage.ts';
import { DRAWINGS_KEY, loadDrawings, saveDrawings, type Drawing } from './drawings.ts';

const HISTORY = 100;

// One stock's drawings, with undo / redo. History is per visit: it starts empty for each stock.
export function useDrawings(symbol: string | undefined) {
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const current = useRef<Drawing[]>([]);
  const past = useRef<Drawing[][]>([]);
  const future = useRef<Drawing[][]>([]);
  const [saveFailed, setSaveFailed] = useState(false);

  const show = (list: Drawing[]) => {
    current.current = list;
    setDrawings(list);
  };
  const persist = (list: Drawing[]) => {
    show(list);
    if (symbol) setSaveFailed(!saveDrawings(symbol, list));
  };

  useEffect(() => {
    past.current = [];
    future.current = [];
    show(symbol ? loadDrawings(symbol) : []);
  }, [symbol]);

  // the same stock open in another tab
  useEffect(() => {
    if (!symbol) return;
    return onOtherTab(DRAWINGS_KEY, () => show(loadDrawings(symbol)));
  }, [symbol]);

  // sameStep: fold this change into the last undo step (typing the text of a text drawing just placed)
  const commit = (next: Drawing[], sameStep = false) => {
    if (next === current.current) return;
    if (!sameStep || !past.current.length) past.current = [...past.current.slice(-(HISTORY - 1)), current.current];
    future.current = [];
    persist(next);
  };
  const undo = () => {
    const prev = past.current.at(-1);
    if (!prev) return false;
    past.current = past.current.slice(0, -1);
    future.current = [...future.current, current.current];
    persist(prev);
    return true;
  };
  const redo = () => {
    const next = future.current.at(-1);
    if (!next) return false;
    future.current = future.current.slice(0, -1);
    past.current = [...past.current, current.current];
    persist(next);
    return true;
  };

  return { drawings, commit, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0, saveFailed };
}
