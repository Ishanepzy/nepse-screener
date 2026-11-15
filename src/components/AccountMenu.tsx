import { useEffect, useState } from 'react';
import { usePopover } from '../usePopover.ts';
import { cloudConfigured, signOut, useCloud } from '../cloud.ts';
import { PasswordForm } from './AccountForms.tsx';

// The signed-in account, in the top bar. Signed out, the sign-in screen stands in for the whole site (Gate.tsx).
// Hidden on a site built without Supabase settings.
export function AccountMenu({ onUsers }: { onUsers: () => void }) {
  const cloud = useCloud();
  const { open, setOpen, ref } = usePopover();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  // back from a "forgot password" link: open straight onto choosing a new one
  useEffect(() => {
    if (cloud.recovery) {
      setOpen(true);
      setChanging(true);
    }
  }, [cloud.recovery]);

  if (!cloudConfigured || cloud.status !== 'signed-in') return null;
  const waiting = cloud.admin ? (cloud.waiting ?? 0) : 0;

  const leave = async () => {
    if (cloud.error && !confirm('Some changes haven’t reached your account yet, and signing out clears them from this browser. Sign out anyway?')) return;
    setBusy(true);
    await signOut();
  };

  return (
    <div className="popover-wrap account" ref={ref}>
      <button
        className={`avatar ${cloud.error ? 'warn' : waiting ? 'waiting' : ''}`}
        aria-expanded={open}
        aria-label={`Account: ${cloud.email ?? 'signed in'}${waiting ? `, ${waiting} waiting for approval` : ''}`}
        title={
          cloud.error ??
          (cloud.saving ? 'Saving to your account…' : `Signed in as ${cloud.email}${waiting ? ` · ${waiting} ${waiting === 1 ? 'account' : 'accounts'} waiting for approval` : ''}`)
        }
        onClick={() => setOpen(!open)}
      >
        {(cloud.email ?? '?').slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="popover account-pop" role="dialog" aria-label="Account">
          <div className="pop-sub">{cloud.recovery ? 'Choose a new password' : cloud.admin ? 'Signed in · admin' : 'Signed in'}</div>
          <p className="account-email">{cloud.email}</p>
          {!cloud.recovery && (
            <p className={`small ${cloud.error ? 'down' : 'muted'}`}>
              {cloud.error ?? (cloud.saving ? 'Saving…' : 'Your watchlist, journal, scans, drawings and settings are saved to your account.')}
            </p>
          )}
          {note && <p className="small up">{note}</p>}
          {changing ? (
            <PasswordForm
              onDone={(n) => {
                setChanging(false);
                setNote(n);
              }}
              onCancel={() => setChanging(false)}
            />
          ) : (
            <div className="account-actions">
              {cloud.admin && (
                <button
                  className="btn"
                  onClick={() => {
                    setOpen(false);
                    onUsers();
                  }}
                >
                  Users{waiting ? ` · ${waiting} waiting` : ''}
                </button>
              )}
              <button
                className="btn"
                onClick={() => {
                  setChanging(true);
                  setNote(null);
                }}
              >
                Change password
              </button>
              <button className="btn" disabled={busy} onClick={leave}>
                Sign out
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
