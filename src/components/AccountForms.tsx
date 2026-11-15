import { useState, type FormEvent } from 'react';
import {
  Plain,
  changePassword,
  dismissRecovery,
  plain,
  googleEnabled,
  resendConfirmation,
  sendOwnPasswordReset,
  sendPasswordReset,
  setPassword,
  signIn,
  signInWithGoogle,
  signUp,
  useCloud,
} from '../cloud.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

// Supabase's sign-in messages in plain words; anything else gets plain()'s general wording
export function explain(err: unknown): string {
  if (err instanceof Plain) return err.message;
  const m = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err);
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Couldn’t connect. Check your internet connection and try again.';
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'This email address isn’t confirmed yet. Open the link in the email we sent when you made the account.';
  if (/already registered|already been registered/i.test(m)) return 'There’s already an account with this email. Sign in instead.';
  if (/rate limit|too many/i.test(m)) return 'Too many tries for now. Wait a few minutes and try again.';
  if (/different from the old password/i.test(m)) return 'Pick a new password that’s different from your current one.';
  if (/password should|weak password|pwned/i.test(m)) return 'Choose a stronger password: a longer one, not used on other sites.';
  if (/signups? not allowed|signup is disabled/i.test(m)) return 'New accounts can’t be made right now.';
  if (/invalid format|unable to validate email/i.test(m)) return 'That email address doesn’t look right.';
  return plain(err);
}

type Mode = 'signin' | 'signup' | 'forgot' | 'reset-sent' | 'confirm';

// Signed out: sign in, make an account, or ask for a password reset link
export function SignInForm() {
  const cloud = useCloud();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPasswordText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // sign-in refused because the address isn't confirmed yet: offer the email again
  const [unconfirmed, setUnconfirmed] = useState(false);

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

  if (mode === 'reset-sent' || mode === 'confirm')
    return (
      <div className="account-form">
        <h2 className="gate-title">Check your email</h2>
        <p className="small">
          {mode === 'reset-sent' ? (
            <>
              If <b>{email.trim()}</b> has an account, a link to choose a new password is on its way. Open it in this browser.
            </>
          ) : (
            <>
              Your account is made. Open the confirmation link sent to <b>{email.trim()}</b>, then sign in with your password. The account can be used once
              it’s approved.
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
      </div>
    );

  return (
    <form className="account-form" onSubmit={submit}>
      <h2 className="gate-title">{mode === 'signup' ? 'Create an account' : mode === 'forgot' ? 'Forgot your password?' : 'Sign in'}</h2>
      {mode === 'signin' && <p className="small muted">The screener is for approved accounts. New accounts can be used once they’re approved.</p>}
      {mode === 'signup' && <p className="small muted">After you confirm your email, the account waits for approval before it can be used.</p>}
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
      {mode !== 'forgot' && (
        <input
          type="password"
          className="account-input"
          placeholder={mode === 'signup' ? `Password, ${MIN_PASSWORD}+ characters` : 'Password'}
          aria-label="Password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => {
            setPasswordText(e.target.value);
            setError(null);
          }}
        />
      )}
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
  );
}

// Signed in: a new password. Back from a reset link there's no current password to give; otherwise it's checked first.
export function PasswordForm({ onDone, onCancel }: { onDone: (note: string) => void; onCancel: () => void }) {
  const cloud = useCloud();
  const [current, setCurrent] = useState('');
  const [password, setPasswordText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // what a password change is doing right now, for the button
  const [step, setStep] = useState<'checking' | 'saving' | null>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
      setStep(null);
    }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!cloud.recovery && !current) return setError('Enter your current password.');
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for the new one.`);
    void run(async () => {
      if (cloud.recovery) await setPassword(password);
      else await changePassword(current, password, setStep);
      onDone('Password changed.');
    });
  };
  const forgotCurrent = () =>
    void run(async () => {
      await sendOwnPasswordReset();
      onDone(`A link to choose a new password is on its way to ${cloud.email}. Open it in this browser.`);
    });

  return (
    <form className="account-form" onSubmit={save}>
      {!cloud.recovery && (
        <input
          type="password"
          className="account-input"
          placeholder="Current password"
          aria-label="Current password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value);
            setError(null);
          }}
        />
      )}
      <input
        type="password"
        className="account-input"
        placeholder={`New password, ${MIN_PASSWORD}+ characters`}
        aria-label="New password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => {
          setPasswordText(e.target.value);
          setError(null);
        }}
      />
      <button className="btn primary" type="submit" disabled={busy}>
        {step === 'checking' ? 'Checking your current password…' : step === 'saving' || busy ? 'Saving your new password…' : 'Change password'}
      </button>
      {error && <p className="small down">{error}</p>}
      <div className="account-links">
        <button
          className="link"
          type="button"
          onClick={() => {
            dismissRecovery();
            onCancel();
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
  );
}
