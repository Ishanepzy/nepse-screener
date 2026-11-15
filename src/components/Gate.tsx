import { useEffect, useState } from 'react';
import { recheckAccess, signOut, useCloud } from '../cloud.ts';
import { PasswordForm, SignInForm, explain } from './AccountForms.tsx';

// What everyone sees until they're signed in to an approved account: sign in, or the state of their account.
export function Gate() {
  const cloud = useCloud();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState(false);

  // a waiting account coming back to the tab: let it in if it's been approved meanwhile
  useEffect(() => {
    if (cloud.access !== 'pending') return;
    const onVisible = () => {
      if (!document.hidden) void recheckAccess().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [cloud.access]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await work();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  };
  const checkAgain = () =>
    void run(async () => {
      if ((await recheckAccess()) === 'pending') setNote('Still waiting. You’ll get in as soon as it’s approved.');
    });
  const leave = () => void run(signOut);

  const signedIn = cloud.status === 'signed-in';
  const checking = cloud.status === 'starting' || (signedIn && cloud.access == null);

  let body;
  if (checking) body = <p className="muted gate-checking">Checking your account…</p>;
  else if (!signedIn) body = <SignInForm />;
  else if (cloud.recovery || newPassword)
    body = (
      <>
        <h2 className="gate-title">Choose a new password</h2>
        <p className="account-email">{cloud.email}</p>
        <PasswordForm
          onDone={(n) => {
            setNewPassword(false);
            setNote(n);
          }}
          onCancel={() => setNewPassword(false)}
        />
      </>
    );
  else
    body = (
      <>
        <h2 className="gate-title">{cloud.access === 'pending' ? 'Waiting for approval' : cloud.access === 'blocked' ? 'No access' : 'Can’t open your account right now'}</h2>
        <p className="account-email">{cloud.email}</p>
        {cloud.access === 'pending' && (
          <p className="small">
            Your account has been created. You’ll be able to use the screener once it’s approved. This page checks again whenever you come back to it.
          </p>
        )}
        {cloud.access === 'blocked' && <p className="small">This account isn’t allowed to use the screener.</p>}
        {cloud.access === 'failed' && <p className="small down">{cloud.error}</p>}
        {note && <p className="small up">{note}</p>}
        {error && <p className="small down">{error}</p>}
        <div className="account-actions">
          {cloud.access === 'pending' && (
            <button className="btn primary" disabled={busy} onClick={checkAgain}>
              {busy ? 'Checking…' : 'Check again'}
            </button>
          )}
          {cloud.access === 'failed' && (
            <button className="btn primary" onClick={() => location.reload()}>
              Try again
            </button>
          )}
          <button className="btn" disabled={busy} onClick={leave}>
            Sign out
          </button>
        </div>
        {cloud.access !== 'failed' && (
          <div className="account-links">
            <button className="link" onClick={() => setNewPassword(true)}>
              Change password
            </button>
          </div>
        )}
      </>
    );

  return (
    <main className="gate">
      <section className="card gate-card" aria-label="Account">
        <div className="gate-brand">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="7" fill="var(--brand-bg)" />
            <path d="M5 22l7-7 5 4 10-11" stroke="var(--up)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1>NEPSE Screener</h1>
        </div>
        {body}
      </section>
    </main>
  );
}
