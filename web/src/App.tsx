import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Clock3, FileText, Inbox, Layers3, LogOut, Mail, Menu, Search, Send, Settings2, ShieldCheck, Slack, Sparkles, Upload, Users, X } from 'lucide-react';

type User = { id: string; name: string; email: string; avatar: string | null };
type Email = { id: string; recipient: string; subject: string; status: 'scheduled'|'sending'|'sent'|'failed'; scheduled_at: string; sent_at?: string; error?: string; sender_id: string };
type Sender = { id: string; name: string; email: string };
type Integration = { googleReady: boolean; slackReady: boolean; slackTeam: string | null; senders: Sender[] };
type Queue = { waiting: number; delayed: number; active: number; failed: number; concurrency: number };
const api = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, { credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `Request failed (${response.status})`); }
  return response.json();
};
const fullDate = (value: string) => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const initials = (name: string) => name.split(/\s+/).slice(0,2).map(s => s[0]).join('').toUpperCase();

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [integrations, setIntegrations] = useState<Integration | null>(null);
  const [scheduled, setScheduled] = useState<Email[]>([]);
  const [sent, setSent] = useState<Email[]>([]);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'scheduled'|'sent'>('scheduled');
  const [search, setSearch] = useState('');
  const [compose, setCompose] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    api<{user: User|null}>('/auth/me').then(result => setUser(result.user)).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setError('');
      try {
        const q = search.trim() ? `&q=${encodeURIComponent(search.trim())}` : '';
        const [scheduledA, scheduledB, sentA, sentB, integrationsData, queueData] = await Promise.all([
          api<{emails: Email[]}>(`/api/emails?status=scheduled${q}`), api<{emails: Email[]}>(`/api/emails?status=sending${q}`),
          api<{emails: Email[]}>(`/api/emails?status=sent${q}`), api<{emails: Email[]}>(`/api/emails?status=failed${q}`),
          api<Integration>('/auth/integrations'), api<Queue>('/api/emails/queue'),
        ]);
        if (!active) return;
        setScheduled([...scheduledA.emails, ...scheduledB.emails].sort((a,b) => +new Date(a.scheduled_at)- +new Date(b.scheduled_at)));
        setSent([...sentA.emails, ...sentB.emails].sort((a,b) => +new Date(b.sent_at ?? b.scheduled_at)- +new Date(a.sent_at ?? a.scheduled_at)));
        setIntegrations(integrationsData); setQueue(queueData);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Could not load email activity.'); }
    }, search ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [user, search, refresh]);

  const current = tab === 'scheduled' ? scheduled : sent;
  const totalActivity = scheduled.length + sent.length;
  const hello = useMemo(() => {
    const hour = new Date().getHours(); return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  }, []);
  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 4500); };

  if (loading) return <div className="loading-screen"><div className="brand-mark">r.</div><p>Getting your workspace ready…</p></div>;
  if (!user) return <main className="login-screen"><div className="login-card"><div className="brand"><span className="brand-mark">r.</span><span>reachinbox</span></div><div className="login-art"><div className="art-orbit orbit-a"/><div className="art-orbit orbit-b"/><div className="art-card"><Sparkles size={19}/><span>Less busywork.<br/><b>More human moments.</b></span></div><div className="art-dot dot-a"/><div className="art-dot dot-b"/></div><span className="eyebrow">YOUR QUIETER WAY TO GROW</span><h1>Good conversations<br/>start with good timing.</h1><p className="login-copy">Plan thoughtful outreach. We’ll help it land at the right moment.</p><a className="google-button" href="/auth/google"><GoogleIcon/>Continue with Google <ArrowRight size={16}/></a><p className="login-note"><ShieldCheck size={14}/> Secure sign-in · We never send without your say-so</p>{error && <div className="notice error-note">{error}</div>}<small className="login-foot">By continuing, you agree to our terms and privacy policy.</small></div></main>;

  const doLogout = async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); };
  const connectSlack = async () => { window.location.href = '/auth/slack'; };
  const disconnectSlack = async () => { await api('/auth/slack', { method: 'DELETE' }); setRefresh(n => n + 1); showToast('Slack disconnected.'); };

  return <div className="shell">
    <aside className="sidebar"><a className="brand" href="#"><span className="brand-mark">r.</span><span>reachinbox</span></a><div className="side-caption">YOUR SPACE</div><button className="side-link active"><Layers3 size={17}/> Overview</button><button className="side-link" onClick={() => {setTab('scheduled');setSearch('')}}><Mail size={17}/> Email activity <span className="side-count">{totalActivity}</span></button><button className="side-link" onClick={() => document.getElementById('queue')?.scrollIntoView({behavior:'smooth'})}><Activity size={17}/> Sending queue</button><div className="side-caption side-manage">KEEP IT CONNECTED</div><button className="side-link" onClick={() => document.getElementById('senders')?.scrollIntoView({behavior:'smooth'})}><Users size={17}/> Senders</button><button className="side-link" onClick={() => document.getElementById('slack')?.scrollIntoView({behavior:'smooth'})}><Settings2 size={17}/> Integrations</button><div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><CircleHelp size={16}/></div><b>A real person can help.</b><p>Questions about your setup? We’re happy to help.</p><a href="mailto:support@reachinbox.ai">Talk to our team <ArrowUpRight size={12}/></a></div><div className="profile"><div className="avatar">{user.avatar?<img src={user.avatar} alt=""/>:initials(user.name)}</div><div className="profile-copy"><b>{user.name}</b><span>{user.email}</span></div><button className="logout" onClick={doLogout} aria-label="Log out"><LogOut size={16}/></button></div></div></aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumb"><span>Workspace</span><b>/</b><strong>Overview</strong></div><div className="top-actions"><span className="system-status"><i/> All systems operational</span><a className="top-help" href="mailto:support@reachinbox.ai"><CircleHelp size={16}/></a><div className="avatar top-avatar">{user.avatar?<img src={user.avatar} alt=""/>:initials(user.name)}</div></div></header>
      <div className="content"><div className="welcome"><div><div className="eyebrow">{new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(new Date()).toUpperCase()}</div><h1>{hello}, {user.name.split(' ')[0]}.</h1><p>Here’s the shape of your outreach today.</p></div><button className="button primary" onClick={() => setCompose(true)}><Mail size={16}/> Compose new email</button></div>
        {error && <div className="notice error-note"><span>{error}</span><button onClick={() => setRefresh(n=>n+1)}>Try again</button></div>}
        <div className="stats-grid"><Stat label="In the queue" number={scheduled.length} detail="Emails waiting for their moment" icon={<Clock3 size={17}/>} tone="mint"/><Stat label="Sent with care" number={sent.filter(m=>m.status==='sent').length} detail="Delivered from this workspace" icon={<Send size={16}/>} tone="lavender"/><Stat label="Need a look" number={sent.filter(m=>m.status==='failed').length} detail="We’ll keep the reason visible" icon={<Inbox size={17}/>} tone="peach"/><Stat label="Queue running" number={queue?.active ?? 0} detail={`${queue?.concurrency ?? 0} worker slots configured`} icon={<Activity size={17}/>} tone="blue"/></div>
        <section className="activity-panel"><div className="panel-heading"><div className="tabs"><button className={tab==='scheduled'?'tab active':'tab'} onClick={()=>setTab('scheduled')}>Scheduled <span>{scheduled.length}</span></button><button className={tab==='sent'?'tab active':'tab'} onClick={()=>setTab('sent')}>Sent <span>{sent.length}</span></button></div><div className="table-tools"><label className="searchbox"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a person or subject"/><kbd>/</kbd></label><button className="refresh-button" onClick={()=>setRefresh(n=>n+1)} title="Refresh"><ArrowDown size={15}/></button></div></div>
          <div className="table-scroll"><table><thead><tr><th>TO</th><th>SUBJECT</th><th>{tab==='sent'?'SENT AT':'SCHEDULED FOR'}</th><th>STATUS</th></tr></thead><tbody>{current.map(email=><tr key={email.id}><td><div className="recipient"><span className="recipient-avatar">{initials(email.recipient.split('@')[0].replace(/[._-]/g,' '))}</span><span><b>{email.recipient}</b><small>{email.sender_id || 'Default sender'}</small></span></div></td><td className="subject-cell">{email.subject}</td><td className="date-cell">{fullDate(tab==='sent'?(email.sent_at??email.scheduled_at):email.scheduled_at)}</td><td><StatusBadge status={email.status}/>{email.error && <small className="error-hint">{email.error}</small>}</td></tr>)}{!current.length&&<tr><td colSpan={4}><div className="empty-state"><span className="empty-icon">{tab==='scheduled'?<Clock3 size={22}/>:<Mail size={22}/>}</span><b>{search?'No matching emails':tab==='scheduled'?'A little quiet in here':'Your sent emails will find a home here'}</b><p>{search?'Try another name or subject.':tab==='scheduled'?'When you schedule your first email, you’ll see the timing here.':'Once your scheduled messages go out, you can keep track of them here.'}</p>{!search&&tab==='scheduled'&&<button className="button primary small" onClick={()=>setCompose(true)}>Plan your first email <ArrowRight size={14}/></button>}</div></td></tr>}</tbody></table></div><div className="panel-footer"><span>{current.length} {current.length===1?'email':'emails'} {tab==='scheduled'?'in the queue':'in your sent history'}</span><span>Updates when you refresh</span></div>
        </section>
        <section className="lower-grid"><div className="queue-card" id="queue"><div className="section-top"><div className="soft-icon mint"><Activity size={17}/></div><span className="live-pill"><i/> LIVE</span></div><h3>Your queue is moving.</h3><p>Sent at a steady pace, with room to breathe.</p><div className="queue-metrics"><div><b>{queue?.waiting ?? 0}</b><span>waiting</span></div><div><b>{queue?.delayed ?? 0}</b><span>scheduled</span></div><div><b>{queue?.active ?? 0}</b><span>sending</span></div><a href="/admin/queues" target="_blank" rel="noreferrer">Open queue <ArrowUpRight size={13}/></a></div></div>
          <div className="integration-card" id="slack"><div className="section-top"><div className="soft-icon lavender"><Slack size={17}/></div><span className={integrations?.slackTeam?'connected-pill':'quiet-pill'}>{integrations?.slackTeam?'CONNECTED':'OPTIONAL'}</span></div><h3>A heads-up, when it matters.</h3><p>{integrations?.slackTeam?`Rate limit notices go to ${integrations.slackTeam}.`:'Connect Slack to know when a sender reaches its hourly limit.'}</p>{integrations?.slackTeam?<button className="text-action" onClick={disconnectSlack}>Disconnect workspace <ArrowRight size={13}/></button>:<button className="text-action" onClick={connectSlack}>Connect Slack <ArrowRight size={13}/></button>}</div></section>
        <section className="sender-strip" id="senders"><div className="sender-icon"><Users size={16}/></div><div><b>Your senders</b><span>{integrations?.senders.length?integrations.senders.map(s=>s.email).join(' · '):'Ethereal SMTP sender configured from your environment'}</span></div><span className="sender-lock"><ShieldCheck size={14}/> Credentials stay on the server</span></section>
        <footer className="page-footer"><span>Made for real people, sending thoughtful notes.</span><a href="/admin/queues" target="_blank" rel="noreferrer">Queue dashboard <ArrowUpRight size={12}/></a></footer>
      </div>
    </main>{compose&&<ComposeModal integrations={integrations} onClose={()=>setCompose(false)} onDone={count=>{setCompose(false);setTab('scheduled');setSearch('');setRefresh(n=>n+1);showToast(`${count} ${count===1?'email':'emails'} scheduled. They’ll go out at a thoughtful pace.`)}}/>}{toast&&<div className="toast"><span className="toast-check"><Check size={14}/></span>{toast}</div>}
  </div>;
}

function Stat({label,number,detail,icon,tone}:{label:string;number:number;detail:string;icon:React.ReactNode;tone:string}){return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}>{icon}</span></div><strong>{number.toLocaleString()}</strong><small>{detail}</small></div>}
function StatusBadge({status}:{status:Email['status']}){return <span className={`status-badge ${status}`}><i/>{status==='scheduled'?'Scheduled':status==='sending'?'Sending':status==='sent'?'Sent':'Failed'}</span>}
function ComposeModal({integrations,onClose,onDone}:{integrations:Integration|null;onClose:()=>void;onDone:(count:number)=>void}){
  const [fileName,setFileName]=useState('');const [recipients,setRecipients]=useState<string[]>([]);const [sending,setSending]=useState(false);const [error,setError]=useState('');
  const minGap=2;const localStart=()=>new Date(Date.now()+3600000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  const [start,setStart]=useState(localStart);const [delay,setDelay]=useState(2);const [limit,setLimit]=useState(40);const [senderId,setSenderId]=useState(integrations?.senders[0]?.id??'');
  const readFile=async(file?:File)=>{if(!file)return;setFileName(file.name);const text=await file.text();const found=text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)??[];setRecipients([...new Set(found.map(a=>a.toLowerCase()))]);};
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setError('');if(!recipients.length){setError('Add a CSV or text file with at least one email address.');return}setSending(true);try{await api('/api/emails/schedule',{method:'POST',body:JSON.stringify({subject:(document.getElementById('subject') as HTMLInputElement).value,body:(document.getElementById('body') as HTMLTextAreaElement).value,recipients,startAt:new Date(start).toISOString(),delaySeconds:delay,hourlyLimit:limit,senderId:senderId||undefined})});onDone(recipients.length)}catch(err){setError(err instanceof Error?err.message:'Could not schedule those emails.')}finally{setSending(false)}};
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="compose-modal"><header className="compose-head"><div><span className="eyebrow">A NOTE, AT THE RIGHT MOMENT</span><h2>Who would you like to reach?</h2><p>A little context goes a long way. Make it yours.</p></div><button className="close-button" onClick={onClose} aria-label="Close"><X size={18}/></button></header><form onSubmit={submit}><div className="form-content"><label className="field-label" htmlFor="subject">Subject</label><input id="subject" className="form-input" required maxLength={180} placeholder="A thoughtful subject line"/><label className="field-label" htmlFor="body">Your message</label><textarea id="body" className="form-input message-input" required maxLength={10000} placeholder="Write like you’re talking to one person, not a list."/><label className="field-label">Your people</label><label className="upload-zone" htmlFor="lead-file"><input id="lead-file" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={e=>readFile(e.target.files?.[0])}/><span className="upload-icon"><Upload size={17}/></span><span><b>{fileName||'Choose a CSV or text file'}</b><small>{recipients.length?`${recipients.length} unique email ${recipients.length===1?'address':'addresses'} found.`:'We’ll count the email addresses for you.'}</small></span><FileText size={17} className="file-icon"/></label><div className="form-row"><div><label className="field-label" htmlFor="start">Start sending</label><input className="form-input" id="start" type="datetime-local" min={localStart()} value={start} onChange={e=>setStart(e.target.value)} required/></div><div><label className="field-label" htmlFor="delay">Pause between emails</label><div className="input-suffix"><input className="form-input" id="delay" type="number" min={minGap} value={delay} onChange={e=>setDelay(Number(e.target.value))} required/><span>seconds</span></div></div></div><div className="form-row lower-form-row"><div><label className="field-label" htmlFor="limit">Hourly limit per sender</label><div className="input-suffix"><input className="form-input" id="limit" type="number" min={1} max={10000} value={limit} onChange={e=>setLimit(Number(e.target.value))} required/><span>emails</span></div></div>{integrations?.senders.length?<div><label className="field-label" htmlFor="sender">Send from</label><select id="sender" className="form-input" value={senderId} onChange={e=>setSenderId(e.target.value)}>{integrations.senders.map(sender=><option key={sender.id} value={sender.id}>{sender.name} · {sender.email}</option>)}</select></div>:<div className="form-hint"><ShieldCheck size={14}/> Your SMTP sender details stay private.</div>}</div>{error&&<div className="form-error">{error}</div>}</div><footer className="compose-footer"><span><ShieldCheck size={14}/> You can pause or edit before sending.</span><div><button type="button" className="button quiet-button" onClick={onClose}>Maybe later</button><button className="button primary" disabled={sending}>{sending?'Scheduling…':<>Schedule emails <ArrowRight size={14}/></>}</button></div></footer></form></section></div>
}
function GoogleIcon(){return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.7c3.9-3.6 6-8.8 6-15z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.7-5.1c-1.8 1.2-4 2-6.8 2-5.2 0-9.6-3.5-11.2-8.2H5.9v5.2A20 20 0 0 0 24 44z"/><path fill="#FBBC05" d="M12.8 27.9a12 12 0 0 1 0-7.7V15H5.9a20 20 0 0 0 0 17.9l6.9-5z"/><path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.8-5.8A19.3 19.3 0 0 0 24 4 20 20 0 0 0 5.9 15l6.9 5.2C14.4 15.5 18.8 12 24 12z"/></svg>}
