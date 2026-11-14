// Joining what this browser saved while signed out with what the account already has, on the first sign-in here.
// Nothing is thrown away: lists of things with an id (or a name) are combined, plain lists are combined without
// repeats, and objects are joined key by key. Where both sides have a single value, the account's copy wins.

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);

// the field that names an item in a list, if every item on both sides has it
function identity(a: unknown[], b: unknown[]): string | null {
  for (const f of ['id', 'name']) if ([...a, ...b].every((x) => isObj(x) && (typeof x[f] === 'string' || typeof x[f] === 'number'))) return f;
  return null;
}

export function mergeValues(account: unknown, here: unknown): unknown {
  if (Array.isArray(account) && Array.isArray(here)) {
    const f = identity(account, here);
    if (f) {
      const known = new Set(account.map((x) => (x as Obj)[f]));
      return [...account, ...here.filter((x) => !known.has((x as Obj)[f]))];
    }
    if ([...account, ...here].every((x) => x === null || typeof x !== 'object')) return [...new Set([...account, ...here])];
    return account;
  }
  if (isObj(account) && isObj(here)) {
    const out: Obj = { ...here, ...account };
    for (const k of Object.keys(account)) if (k in here) out[k] = mergeValues(account[k], here[k]);
    return out;
  }
  return account;
}
