// localStorage throws in private windows and when it's blocked or full, so all access goes through these two.

export function load(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw; // the theme was once saved as plain text
    }
  } catch {
    return null;
  }
}

// Signed in, every save also goes to the account (cloud.ts sets this).
let afterSave: ((key: string) => void) | null = null;
export const setSaveHook = (fn: ((key: string) => void) | null) => {
  afterSave = fn;
};

export function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return false;
  }
  afterSave?.(key);
  return true;
}

// Calls fn when another tab changes `key`. Returns the unsubscribe.
export function onOtherTab(key: string, fn: () => void): () => void {
  const h = (e: StorageEvent) => {
    if (e.key === key) fn();
  };
  window.addEventListener('storage', h);
  return () => window.removeEventListener('storage', h);
}
