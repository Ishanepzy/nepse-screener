import { useCallback, useEffect, useState } from 'react';
import { listMembers, setMemberStatus, useCloud, type Access, type Member } from '../cloud.ts';
import { explain } from './AccountForms.tsx';
import * as fmt from '../format.ts';

type Filter = Access | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'pending', label: 'Waiting' },
  { id: 'approved', label: 'Approved' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'all', label: 'All' },
];
const STATUS: Record<Access, { label: string; tone: string }> = {
  pending: { label: 'Waiting', tone: '' },
  approved: { label: 'Approved', tone: 'up' },
  blocked: { label: 'Blocked', tone: 'down' },
};

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : undefined);

// Admins only: who has an account, and who may use the site
export function UsersPage() {
  const cloud = useCloud();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [loading, setLoading] = useState(false);
  // the account being changed
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setMembers(await listMembers());
      setError(null);
    } catch (e) {
      setError(explain(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const change = async (m: Member, status: Access) => {
    setBusy(m.id);
    try {
      await setMemberStatus(m.id, status);
      await refresh();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  };

  const count = (f: Filter) => (members ?? []).filter((m) => f === 'all' || m.status === f).length;
  const shown = (members ?? []).filter((m) => filter === 'all' || m.status === filter);
  const me = (m: Member) => m.email === cloud.email;

  return (
    <div className="users">
      <section className="card page-intro">
        <div className="page-intro-head">
          <div>
            <h2 className="section-title">Users</h2>
            <p className="muted small">
              New accounts wait here until you approve them. Until then they only see the sign-in screen. A blocked account is shut out from its next
              visit; its saved data is kept in case you let it back in.
            </p>
          </div>
          <button className="btn" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </section>

      <section className="card users-list">
        <div className="seg users-filter" role="tablist" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
              {f.label} <span className="muted">{members ? count(f.id) : ''}</span>
            </button>
          ))}
        </div>
        {error && <p className="small down users-note">{error}</p>}
        {!members ? (
          !error && <p className="muted small users-note">Loading the accounts…</p>
        ) : !shown.length ? (
          <p className="muted small users-note">
            {filter === 'pending' ? 'No one is waiting for approval.' : filter === 'all' ? 'No accounts yet.' : `No ${filter} accounts.`}
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="left">Email</th>
                  <th className="left">Status</th>
                  <th className="left hide-sm">Signed up</th>
                  <th className="left hide-sm">Last sign-in</th>
                  <th className="left" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <tr key={m.id} className="static">
                    <td className="left users-email">
                      <div className="users-who">
                        <span>{m.email}</span>
                        {me(m) && <span className="pill">you</span>}
                        {m.admin && <span className="pill">admin</span>}
                        {!m.confirmed && (
                          <span className="pill" title="They haven’t opened the confirmation link in their email yet, so they can’t sign in">
                            email not confirmed
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="left">
                      <span className={`pill ${STATUS[m.status].tone}`} title={m.decidedAt ? `Since ${stamp(m.decidedAt)}` : undefined}>
                        {STATUS[m.status].label}
                      </span>
                    </td>
                    <td className="left hide-sm mono" title={stamp(m.signedUp)}>
                      {day(m.signedUp)}
                    </td>
                    <td className="left hide-sm" title={stamp(m.lastSignIn)}>
                      {fmt.relTime(m.lastSignIn)}
                    </td>
                    <td className="left users-actions">
                      {m.admin || me(m) ? (
                        <span className="muted small">—</span>
                      ) : (
                        <>
                          {m.status !== 'approved' && (
                            <button className="btn tiny primary" disabled={busy === m.id} onClick={() => void change(m, 'approved')}>
                              Approve
                            </button>
                          )}
                          {m.status !== 'blocked' && (
                            <button className="btn tiny" disabled={busy === m.id} onClick={() => void change(m, 'blocked')}>
                              Block
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
