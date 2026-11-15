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

// A new account waits until an admin approves it (supabase/setup.sql, public.members)
export type Access = 'pending' | 'approved' | 'blocked';

export interface CloudState {
  status: 'off' | 'starting' | 'signed-out' | 'signed-in';
  email: string | null;
  // signed in: whether the account may use the site; null until known, 'failed' when the check couldn't be made
  access: Access | 'failed' | null;
  admin: boolean;
  // admins: accounts waiting for approval, once the list has been read
  waiting: number | null;
  saving: boolean;
  error: string | null;
  // back from a "forgot password" email: signed in, and asked to choose a new password
  recovery: boolean;
}

let state: CloudState = {
  status: cloudConfigured ? 'starting' : 'off',
  email: null,
  access: null,
  admin: false,
  waiting: null,
  saving: false,
  error: null,
  recovery: false,
};
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

// an error whose message is already written for the person using the site
export class Plain extends Error {}

// What went wrong, in words anyone can follow. The technical detail goes to the browser console for whoever runs the
// site; database errors raised by supabase/setup.sql's own checks are already plain sentences and pass through.
export function plain(e: unknown): string {
  if (e instanceof Plain) return e.message;
  const m = message(e);
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  console.warn('[account]', code, m);
  if (code === '42501' || code === 'P0002' || code === '22023') return m;
  if (/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(m)) return 'Couldn’t connect. Check your internet connection and try again.';
  if (code === 'PGRST202' || code === '42883' || code === '42P01' || /could not find the function|schema cache|does not exist/i.test(m))
    return 'Accounts on this site aren’t fully set up yet. Please try again later.';
  if (/jwt|token|session/i.test(m)) return 'Your sign-in has run out. Sign out, then sign in again.';
  if (/rate limit|too many/i.test(m)) return 'Too many tries for now. Wait a few minutes and try again.';
  return 'Something went wrong on our side. Please try again in a moment.';
}

// sign-in links and Google come back here, to the page they were asked from
const here = () => `${location.origin}${location.pathname}`;

async function fetchAccess(): Promise<{ status: Access; admin: boolean }> {
  const { data, error } = await client!.rpc('my_access');
  if (error) throw error;
  const d = (data ?? {}) as { status?: unknown; admin?: unknown };
  const status = d.status === 'approved' || d.status === 'blocked' ? d.status : 'pending';
  return { status, admin: status === 'approved' && d.admin === true };
}

// Run once as the page opens: picks up a sign-in that just came back, checks the account may use the site, and
// brings its data down. The app only draws after that (main.tsx shows the sign-in screen until then), so every page
// starts from the account's data.
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
      if (!s && state.status === 'signed-in') set({ status: 'signed-out', email: null, access: null, admin: false, waiting: null });
    });
    if (!session) return set({ status: 'signed-out' });
    if (linkError) set({ error: null });
    set({ status: 'signed-in', email: session.user.email ?? null, recovery: resetting });
    const access = await fetchAccess();
    if (access.status !== 'approved') return set({ access: access.status });
    try {
      await pullAccount(backend(), store, session.user.id).then(({ send }) => {
        // only now, so nothing saved from the old copy can overwrite the account's
        setSaveHook(queue);
        if (send.length) void flush();
      });
    } catch (e) {
      // the site still opens, on this browser's copy
      set({ error: `Your saved items couldn’t be loaded from your account, so you’re seeing the copy kept in this browser. ${plain(e)}` });
    }
    set({ access: 'approved', admin: access.admin });
    if (access.admin) void listMembers().catch(() => {});
  } catch (e) {
    set(
      session
        ? { status: 'signed-in', access: 'failed', error: plain(e) }
        : { status: 'signed-out', error: `Sign-in isn’t working right now. ${plain(e)}` },
    );
  }
}

// A waiting account asks again. Let in: the page starts over, bringing the account's data down first.
export async function recheckAccess(): Promise<Access | null> {
  if (!client || !session) return null;
  const access = await fetchAccess();
  if (access.status === 'approved') location.reload();
  else set({ access: access.status, error: null });
  return access.status;
}

// ---------- admins: who may use the site ----------

export interface Member {
  id: string;
  email: string;
  status: Access;
  admin: boolean;
  signedUp: string;
  // when the address was confirmed from the email; null = not yet, and the account can't sign in
  confirmed: string | null;
  lastSignIn: string | null;
  decidedAt: string | null;
}

// everyone with an account, newest first (the database refuses anyone but an admin)
export async function listMembers(): Promise<Member[]> {
  const { data, error } = await ready().rpc('list_members');
  if (error) throw error;
  const rows = ((data ?? []) as Record<string, unknown>[]).map(
    (r): Member => ({
      id: String(r.user_id),
      email: String(r.email ?? ''),
      status: r.status === 'approved' || r.status === 'blocked' ? r.status : 'pending',
      admin: r.is_admin === true,
      signedUp: String(r.signed_up),
      confirmed: (r.confirmed as string | null) ?? null,
      lastSignIn: (r.last_sign_in as string | null) ?? null,
      decidedAt: (r.decided_at as string | null) ?? null,
    }),
  );
  set({ waiting: rows.filter((m) => m.status === 'pending').length });
  return rows;
}

export async function setMemberStatus(id: string, status: Access): Promise<void> {
  const { error } = await ready().rpc('set_member_status', { target: id, new_status: status });
  if (error) throw error;
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
    .catch((e) =>
      set({
        saving: false,
        error: `Some changes haven’t reached your account yet. They’ll be sent the next time you change something or reload the page. ${plain(e)}`,
      }),
    );
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
  if (!client) throw new Plain('Accounts aren’t available on this site.');
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
  if (!email) throw new Plain('You’re not signed in.');
  onStep('checking');
  const check = await db.auth.signInWithPassword({ email, password: current });
  if (check.error) throw /invalid login credentials/i.test(check.error.message) ? new Plain('Your current password isn’t right.') : check.error;
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
  if (!client) throw new Plain('Accounts aren’t available on this site.');
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
