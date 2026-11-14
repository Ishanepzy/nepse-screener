import { useEffect, useState, type FormEvent } from 'react';
import { usePopover } from '../usePopover.ts';
import {
  changePassword,
  cloudConfigured,
  dismissRecovery,
  googleEnabled,
  resendConfirmation,
  sendOwnPasswordReset,
  sendPasswordReset,
  setPassword,
  signIn,
  signInWithGoogle,
  signOut,
  signUp,
  useCloud,
} from '../cloud.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

// Supabase's messages, in the site's words; the browser's own wording for a network failure says nothing useful
function explain(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Couldn’t reach the sign-in service. Check your connection and try again.';
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'This address isn’t confirmed yet: open the link in the email sent when the account was made.';
  if (/already registered|already been registered/i.test(m)) return 'There’s already an account with this email. Sign in instead.';
  if (/rate limit|too many/i.test(m)) return 'Too many tries for now. Wait a few minutes and try again.';
  return m;
}

type Mode = 'signin' | 'signup' | 'forgot' | 'reset-sent' | 'confirm';

// Sign in / out, in the top bar. Hidden on a site built without Supabase settings.
export function AccountMenu() {
  const cloud = useCloud();
  const { open, setOpen, ref } = usePopover();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPasswordText] = useState('');
  // the current password, when changing it
  const [currentPassword, setCurrentPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  // what a password change is doing right now, for the button
  const [step, setStep] = useState<'checking' | 'saving' | null>(null);
  // sign-in refused because the address isn't confirmed yet: offer the email again
  const [unconfirmed, setUnconfirmed] = useState(false);

  // back from a "forgot password" link: open straight onto choosing a new one
  useEffect(() => {
    if (cloud.recovery) {
      setOpen(true);
      setChanging(true);
    }
  }, [cloud.recovery]);

  if (!cloudConfigured || cloud.status === 'off') return null;
  const signedIn = cloud.status === 'signed-in';

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setUnconfirmed(false);
    try {
      await work();
    } catch (err) {
      setError(explain(err));
      setUnconfirmed(/email not confirmed/i.test(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
      setStep(null);
    }
  };
  const resend = () =>
    void run(async () => {
      await resendConfirmation(email.trim());
      setMode('confirm');
    });
  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setPasswordText('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!EMAIL.test(address)) return setError('Enter your email address.');
    if (mode === 'forgot') return void run(async () => (await sendPasswordReset(address), setMode('reset-sent')));
    if (!password) return setError('Enter your password.');
    if (mode === 'signup' && password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    void run(async () => {
      if (mode === 'signin') await signIn(address, password);
      else if ((await signUp(address, password)) === 'confirm') setMode('confirm');
    });
  };

  // back from a reset link there's no current password to give; otherwise it's checked first
  const savePassword = (e: FormEvent) => {
    e.preventDefault();
    if (!cloud.recovery && !currentPassword) return setError('Enter your current password.');
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for the new one.`);
    void run(async () => {
      if (cloud.recovery) await setPassword(password);
      else await changePassword(currentPassword, password, setStep);
      setChanging(false);
      setPasswordText('');
      setCurrentPassword('');
      setNote('Password changed.');
    });
  };
  const forgotCurrent = () =>
    void run(async () => {
      await sendOwnPasswordReset();
      setChanging(false);
      setCurrentPassword('');
      setPasswordText('');
      setNote(`A link to choose a new password is on its way to ${cloud.email}. Open it in this browser.`);
    });

  const leave = async () => {
    if (cloud.error && !confirm('Some changes haven’t reached your account yet, and signing out clears them from this browser. Sign out anyway?')) return;
    setBusy(true);
    await signOut();
  };

  const passwordField = (autoComplete: string, label = 'Password') => (
    <input
      type="password"
      className="account-input"
      placeholder={label}
      aria-label={label}
      autoComplete={autoComplete}
      value={password}
      onChange={(e) => {
        setPasswordText(e.target.value);
        setError(null);
      }}
    />
  );

  return (
    <div className="popover-wrap account" ref={ref}>
      {signedIn ? (
        <button
          className={`avatar ${cloud.error ? 'warn' : ''}`}
          aria-expanded={open}
          aria-label={`Account: ${cloud.email ?? 'signed in'}`}
          title={cloud.error ?? (cloud.saving ? 'Saving to your account…' : `Signed in as ${cloud.email}`)}
          onClick={() => setOpen(!open)}
        >
          {(cloud.email ?? '?').slice(0, 1).toUpperCase()}
        </button>
      ) : (
        <button className="btn ghost" aria-expanded={open} disabled={cloud.status === 'starting'} onClick={() => setOpen(!open)}>
          Sign in
        </button>
      )}
      {open && (
        <div className="popover account-pop" role="dialog" aria-label="Account">
          {signedIn ? (
            <>
              <div className="pop-sub">{cloud.recovery ? 'Choose a new password' : 'Signed in'}</div>
              <p className="account-email">{cloud.email}</p>
              {!cloud.recovery && (
                <p className={`small ${cloud.error ? 'down' : 'muted'}`}>
                  {cloud.error ?? (cloud.saving ? 'Saving…' : 'Your watchlist, journal, scans, drawings and settings are saved to your account.')}
                </p>
              )}
              {note && <p className="small up">{note}</p>}
              {changing ? (
                <form onSubmit={savePassword}>
                  {!cloud.recovery && (
                    <input
                      type="password"
                      className="account-input"
                      placeholder="Current password"
                      aria-label="Current password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(e) => {
                        setCurrentPassword(e.target.value);
                        setError(null);
                      }}
                    />
                  )}
                  {passwordField('new-password', `New password, ${MIN_PASSWORD}+ characters`)}
                  <button className="btn primary" type="submit" disabled={busy}>
                    {step === 'checking' ? 'Checking your current password…' : step === 'saving' || busy ? 'Saving your new password…' : 'Change password'}
                  </button>
                  {error && <p className="small down">{error}</p>}
                  <div className="account-links">
                    <button
                      className="link"
                      type="button"
                      onClick={() => {
                        setChanging(false);
                        setError(null);
                        setCurrentPassword('');
                        setPasswordText('');
                        dismissRecovery();
                      }}
                    >
                      Cancel
                    </button>
                    {!cloud.recovery && (
                      <button className="link" type="button" disabled={busy} onClick={forgotCurrent}>
                        Forgot your current password?
                      </button>
                    )}
                  </div>
                </form>
              ) : (
                <div className="account-actions">
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
            </>
          ) : mode === 'reset-sent' || mode === 'confirm' ? (
            <>
              <div className="pop-sub">Check your email</div>
              <p className="small">
                {mode === 'reset-sent' ? (
                  <>
                    If <b>{email.trim()}</b> has an account, a link to choose a new password is on its way. Open it in this browser.
                  </>
                ) : (
                  <>
                    Your account is made. Open the confirmation link sent to <b>{email.trim()}</b>, then sign in with your password.
                  </>
                )}{' '}
                Look in spam if it doesn’t arrive.
              </p>
              {error && <p className="small down">{error}</p>}
              <div className="account-links">
                <button className="link" onClick={() => go('signin')}>
                  Back to sign in
                </button>
                {mode === 'confirm' && (
                  <button className="link" disabled={busy} onClick={resend}>
                    {busy ? 'Sending…' : 'Send it again'}
                  </button>
                )}
              </div>
            </>
          ) : (
            <form onSubmit={submit}>
              <div className="pop-sub">{mode === 'signup' ? 'Create an account' : mode === 'forgot' ? 'Forgot your password?' : 'Sign in'}</div>
              {mode === 'signin' && (
                <p className="small muted">
                  Keep your watchlist, journal, saved scans, drawings and settings in your account, on any device. Signed out, they stay in this browser
                  only.
                </p>
              )}
              {mode === 'forgot' && <p className="small muted">Enter your email and we’ll send a link to choose a new password.</p>}
              <input
                type="email"
                className="account-input"
                placeholder="you@example.com"
                aria-label="Email address"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
              />
              {mode !== 'forgot' && passwordField(mode === 'signup' ? 'new-password' : 'current-password', mode === 'signup' ? `Password, ${MIN_PASSWORD}+ characters` : 'Password')}
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send the link' : 'Sign in'}
              </button>
              {mode === 'signin' && googleEnabled && (
                <button className="btn" type="button" onClick={() => void run(signInWithGoogle)}>
                  Continue with Google
                </button>
              )}
              {error && <p className="small down">{error}</p>}
              {unconfirmed && (
                <button className="btn" type="button" disabled={busy} onClick={resend}>
                  Send the confirmation email again
                </button>
              )}
              {cloud.error && <p className="small down">{cloud.error}</p>}
              <div className="account-links">
                {mode === 'signin' ? (
                  <>
                    <button className="link" type="button" onClick={() => go('signup')}>
                      Create an account
                    </button>
                    <button className="link" type="button" onClick={() => go('forgot')}>
                      Forgot password?
                    </button>
                  </>
                ) : (
                  <button className="link" type="button" onClick={() => go('signin')}>
                    Back to sign in
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
