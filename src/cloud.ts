// Sign-in and the account's copy of the user's data, on Supabase. Optional: without VITE_SUPABASE_URL and
// VITE_SUPABASE_KEY the site works as before, everything kept in this browser only.
//
// The key in VITE_SUPABASE_KEY is Supabase's publishable (anon) key. It is meant to be in the page; what keeps one
// user out of another's data is the table's row level security (see supabase/setup.sql).
import { useSyncExternalStore } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { setSaveHook } from './storage.ts';
import { isSynced, pullAccount, pushKeys, readDirty, wipeLocal, writeDirty, type Backend, type LocalStore } from './cloudSync.ts';

// the project URL; one copied with the Data API's /rest/v1/ on the end works too
const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const KEY = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
export const cloudConfigured = !!(URL_ && KEY);
// Google needs setting up in Supabase first, so its button only shows once that's done
export const googleEnabled = import.meta.env.VITE_SUPABASE_GOOGLE === 'true';

const TABLE = 'user_data';
const SEND_AFTER_MS = 1200;

export interface CloudState {
  status: 'off' | 'starting' | 'signed-out' | 'signed-in';
  email: string | null;
  saving: boolean;
  error: string | null;
  // back from a "forgot password" email: signed in, and asked to choose a new password
  recovery: boolean;
}

let state: CloudState = { status: cloudConfigured ? 'starting' : 'off', email: null, saving: false, error: null, recovery: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<CloudState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
export const useCloud = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
// for the notes that say where things are kept
export const useSignedIn = () => useCloud().status === 'signed-in';

const store: LocalStore = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // full or blocked: the account still has it
    }
  },
  remove: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      // blocked
    }
  },
  keys: () => {
    try {
      return Object.keys(localStorage);
    } catch {
      return [];
    }
  },
};

let client: SupabaseClient | null = null;
let session: Session | null = null;
let rendered = false;
// main.tsx: the app has drawn
export const cloudRendered = () => {
  rendered = true;
};

function backend(): Backend {
  const db = client!;
  const userId = session!.user.id;
  return {
    async list() {
      const { data, error } = await db.from(TABLE).select('key, value');
      if (error) throw error;
      return (data ?? []) as { key: string; value: unknown }[];
    },
    async put(rows) {
      const now = new Date().toISOString();
      const { error } = await db.from(TABLE).upsert(
        rows.map((r) => ({ user_id: userId, key: r.key, value: r.value, updated_at: now })),
        { onConflict: 'user_id,key' },
      );
      if (error) throw error;
    },
    async remove(keys) {
      const { error } = await db.from(TABLE).delete().eq('user_id', userId).in('key', keys);
      if (error) throw error;
    },
  };
}

const message = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e));

// sign-in links and Google come back here, to the page they were asked from
const here = () => `${location.origin}${location.pathname}`;

// Run once before the app first draws: picks up a sign-in that just came back, and brings the account's data down so
// every page starts from it.
export async function startCloud(): Promise<void> {
  if (!cloudConfigured) return;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(URL_!, KEY!, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    session = (await client.auth.getSession()).data.session;
    // done with ?code=... (and ?reset) from an email link; keep the page's own #route
    const params = new URLSearchParams(location.search);
    const resetting = params.has('reset');
    // an email link that had expired or was already used comes back with an error instead of a code
    const hashParams = new URLSearchParams(location.hash.startsWith('#error') ? location.hash.slice(1) : '');
    const linkError = params.get('error_description') ?? hashParams.get('error_description');
    if (params.has('code') || resetting || linkError) history.replaceState(null, '', here() + (hashParams.has('error') ? '' : location.hash));
    if (linkError) set({ error: /expired|invalid/i.test(linkError) ? 'That email link has expired or was already used. Ask for a new one.' : linkError });
    client.auth.onAuthStateChange((_event, s) => {
      session = s;
      if (!s && state.status === 'signed-in') set({ status: 'signed-out', email: null });
    });
    if (!session) return set({ status: 'signed-out' });
    if (linkError) set({ error: null });
    set({ status: 'signed-in', email: session.user.email ?? null, recovery: resetting });
    const { send, changed } = await pullAccount(backend(), store, session.user.id);
    // the page drew from this browser's copy while the account's was on its way: start again from the account's
    if (rendered && changed) return location.reload();
    // only now, so nothing saved from the old copy can overwrite the account's
    setSaveHook(queue);
    if (send.length) void flush();
  } catch (e) {
    set({ status: session ? 'signed-in' : 'signed-out', error: `Couldn't reach your account: ${message(e)}` });
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let sending: Promise<void> | null = null;

// storage.save() calls this for every key it writes
function queue(key: string) {
  if (!isSynced(key) || !session) return;
  const dirty = readDirty(store);
  dirty.add(key);
  writeDirty(store, dirty);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), SEND_AFTER_MS);
}

export async function flush(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!client || !session) return;
  if (sending) await sending;
  const keys = [...readDirty(store)];
  if (!keys.length) return;
  set({ saving: true });
  sending = pushKeys(backend(), store, keys)
    .then(() => set({ saving: false, error: null }))
    .catch((e) => set({ saving: false, error: `Not saved to your account yet: ${message(e)}` }));
  await sending;
  sending = null;
}

// a tab closing or going to the background: send what's waiting
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}

const ready = () => {
  if (!client) throw new Error('Accounts are not set up on this site');
  return client;
};

// Signing in or up reloads the page, so it starts from the account's data like any other visit.
export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await ready().auth.signInWithPassword({ email, password });
  if (error) throw error;
  location.reload();
}

// 'confirm' when the project still asks new users to confirm their address by email first
export async function signUp(email: string, password: string): Promise<'confirm' | void> {
  const { data, error } = await ready().auth.signUp({ email, password, options: { emailRedirectTo: here() } });
  if (error) throw error;
  if (!data.session) return 'confirm';
  location.reload();
}

// the one email that can't be avoided: a link back here, signed in, to choose a new password
export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await ready().auth.resetPasswordForEmail(email, { redirectTo: `${here()}?reset=1` });
  if (error) throw error;
}

// signed in: a new password (also how an account made from an email link gets its first one)
export async function setPassword(password: string): Promise<void> {
  const { error } = await ready().auth.updateUser({ password });
  if (error) throw error;
  set({ recovery: false });
}

// Signed in: checks the current password (signing in with it again), then sets the new one. Supabase itself
// doesn't ask for the old password, so without this check anyone at an unlocked computer could change it.
export async function changePassword(current: string, next: string, onStep: (step: 'checking' | 'saving') => void = () => {}): Promise<void> {
  const db = ready();
  const email = session?.user.email;
  if (!email) throw new Error('You’re not signed in.');
  onStep('checking');
  const check = await db.auth.signInWithPassword({ email, password: current });
  if (check.error) throw new Error(/invalid login credentials/i.test(check.error.message) ? 'Your current password isn’t right.' : check.error.message);
  onStep('saving');
  const { error } = await db.auth.updateUser({ password: next });
  if (error) throw error;
}

// a new account whose confirmation email went missing or expired
export async function resendConfirmation(email: string): Promise<void> {
  const { error } = await ready().auth.resend({ type: 'signup', email, options: { emailRedirectTo: here() } });
  if (error) throw error;
}

// the signed-in user's own reset link, for a forgotten current password
export const sendOwnPasswordReset = () => sendPasswordReset(session?.user.email ?? '');

export const dismissRecovery = () => set({ recovery: false });

export async function signInWithGoogle(): Promise<void> {
  if (!client) throw new Error('Accounts are not set up on this site');
  const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: here() } });
  if (error) throw error;
}

// Sends anything waiting, signs out, and clears the account's data from this browser (a shared computer keeps
// nothing of it). The page reloads into the signed-out state.
export async function signOut(): Promise<void> {
  try {
    await flush();
  } catch {
    // signing out anyway
  }
  await client?.auth.signOut();
  wipeLocal(store);
  location.reload();
}
