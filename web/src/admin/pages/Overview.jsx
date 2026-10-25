// Placeholder landing page of the admin area. Real pages (users, organizations, audit...) are added by later phases as more files in this folder.
import {useEffect,useState} from 'react';
import {api} from '../../api';
export const meta = { title: 'Overview', permission: 'system:read', order: 0 };
export default function Overview() {
  const [ping, setPing] = useState(null), [err, setErr] = useState('');
  useEffect(() => { api('/admin/ping').then(setPing).catch(e => setErr(e.message)); }, []);
  return <div className="card full">
    <h3>Admin overview</h3>
    <p className="mu">The admin tools are being built in phases. This page confirms the admin API is reachable and that your role may use it.</p>
    {err ? <div className="st dn">⚠ {err}</div> : ping ? <div className="st">Admin API reachable. You are signed in as <b>{ping.role}</b>.</div> : <div className="st">Checking the admin API…</div>}
  </div>;
}
