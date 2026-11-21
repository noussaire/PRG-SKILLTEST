# SkillQuest ? fichiers complets de l?administration

Les fichiers sont d?j? appliqu?s. Les blocs suivants contiennent les fichiers entiers, un par un, en commen?ant par les layouts et le login. Ils sont destin?s au projet SkillQuest existant. Les endpoints, les d?pendances et les r?gles d?impression restent ceux du projet.

## frontend/src/app/admin/layout.tsx

```tsx
import "../admin.css";
import type { ReactNode } from 'react';
export default function AdminLayout({ children }: {
    children: ReactNode;
}) { return <div data-admin-root className="ad-root">{children}</div>; }
```

## frontend/src/app/admin/(protected)/layout.tsx

```tsx
import { AdminShell } from '@/components/admin/AdminShell';
export default function AdminProtectedLayout({ children }: {
    children: React.ReactNode;
}) { return <AdminShell>{children}</AdminShell>; }
```

## frontend/src/app/admin/login/page.tsx

```tsx
"use client";
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useLanguage } from '@/lib/language-context';
import { adminContent as c } from '@/lib/admin-content';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import { BrandArcs } from '@/components/home/shared';
export default function AdminLoginPage() {
    const router = useRouter(), { lang } = useLanguage();
    const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [showPassword, setShowPassword] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
    const errorRef = useRef<HTMLDivElement>(null);
    async function handleSubmit(e: React.FormEvent) { e.preventDefault(); setError(null); setLoading(true); try {
        const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const data: {
            error?: string;
        } = await res.json();
        if (!res.ok) {
            setError(data.error || c.invalid[lang]);
            setLoading(false);
            requestAnimationFrame(() => errorRef.current?.focus());
            return;
        }
        router.push('/admin/dashboard');
        router.refresh();
    }
    catch {
        setError(c.network[lang]);
        setLoading(false);
        requestAnimationFrame(() => errorRef.current?.focus());
    } }
    return <div className="ad-login"><section className="ad-login-brand"><Link href="/" className="ad-login-logo"><BrandLogo /></Link><div><ShieldCheck size={20} aria-hidden="true"/><h2>{c.loginStatement[lang]}</h2><p>{c.loginBrandBody[lang]}</p></div><BrandArcs /><p className="ad-login-signature">{c.association[lang]}</p></section><section className="ad-login-work"><div className="ad-login-top"><Link href="/">{c.backSite[lang]}</Link><LanguageSwitcher /></div><div className="ad-login-form"><h1>{c.loginTitle[lang]}</h1><p className="ad-lead">{c.loginIntro[lang]}</p>{error && <div ref={errorRef} tabIndex={-1} role="alert" id="login-error" className="ad-alert ad-alert-error"><AlertCircle size={18} aria-hidden="true"/><p>{error}</p></div>}<form onSubmit={handleSubmit} aria-busy={loading}><FormField id="email" label={c.email[lang]}><input id="email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} dir="ltr" aria-describedby={error ? 'login-error' : undefined}/></FormField><FormField id="password" label={c.password[lang]}><div className="ad-password"><input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} aria-describedby={error ? 'login-error' : undefined}/><button type="button" aria-label={(showPassword ? c.hidePassword : c.showPassword)[lang]} aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)}>{showPassword ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}</button></div></FormField><Button type="submit" variant="primary" busy={loading}>{(loading ? c.logging : c.login)[lang]}{!loading && <ArrowRight size={18} className="ad-direction" aria-hidden="true"/>}</Button></form><p className="ad-login-notice"><ShieldCheck size={16} aria-hidden="true"/>{c.restricted[lang]}</p></div></section></div>;
}
```

## frontend/src/components/admin/ActivityChart.tsx

```tsx
"use client";
import { useEffect, useId, useRef, useState } from 'react';
import type { AdminAdaptiveParticipant } from '@/lib/adaptive-admin-types';
import { adminContent as c, AdminLanguage } from '@/lib/admin-content';
export function ActivityChart({ participants, generatedAt, lang }: {
    participants: AdminAdaptiveParticipant[];
    generatedAt: string;
    lang: AdminLanguage;
}) {
    const id = useId();
    const root=useRef<HTMLDivElement>(null), [width,setWidth]=useState(600);
    useEffect(()=>{const observer=new ResizeObserver(([entry])=>setWidth(Math.max(240,Math.round(entry.contentRect.width))));if(root.current)observer.observe(root.current);return()=>observer.disconnect();},[]);
    const key = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const end = new Date(generatedAt);
    const days = Array.from({ length: 7 }, (_, i) => { const date = new Date(end); date.setUTCDate(end.getUTCDate() - 6 + i); return { date, key: key(date), count: 0 }; });
    for (const p of participants) {
        const d = days.find(d => d.key === key(new Date(p.createdAt)));
        if (d)
            d.count++;
    }
    const max = Math.max(2, Math.ceil((Math.max(0,...days.map(d => d.count))+1)/2)*2);
    const W = width, H = 178, L = 36, R = 16, T = 12, B = 32, plotH = H - T - B;
    const xs = (i: number) => L + i * (W - L - R) / 6, ys = (v: number) => H - B - v / max * plotH;
    const points = days.map((d, i) => `${xs(i)},${ys(d.count)}`).join(' ');
    const ticks = [0, Math.ceil(max / 2), max];
    return <div className="ad-chart" ref={root}><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-title ${id}-description`}><title id={`${id}-title`}>{c.evolution[lang]}</title><desc id={`${id}-description`}>{days.map(d => `${d.key}: ${d.count}`).join('; ')}</desc>{ticks.map(n => <g key={n}><line x1={L} x2={W - R} y1={ys(n)} y2={ys(n)} className="ad-chart-grid"/><text x={L - 10} y={ys(n) + 4} textAnchor="end">{n}</text></g>)}<polyline points={points} className="ad-chart-series"/>{days.filter((_,i)=>W>=450||i%2===0).map((d) => {const i=days.indexOf(d);return <text key={d.key} x={xs(i)} y={H - 7} textAnchor={i === 0 ? 'start' : i === 6 ? 'end' : 'middle'}>{d.date.toLocaleDateString(lang === 'ar' ? 'ar-MA' : 'fr-FR', { timeZone: 'Africa/Casablanca', day: '2-digit', month: '2-digit' }).replace(/[\u200e\u200f\u061c]/g, '')}</text>;})}</svg><table className="sr-only"><caption>{c.chartTable[lang]}</caption><thead><tr><th scope="col">{c.day[lang]}</th><th scope="col">{c.count[lang]}</th></tr></thead><tbody>{days.map(d => <tr key={d.key}><th scope="row">{d.key}</th><td>{d.count}</td></tr>)}</tbody></table><p className="ad-caption">{c.chartScope[lang]}</p></div>;
}
```

## frontend/src/components/admin/adaptive-ui.tsx

```tsx
"use client";
import Link from 'next/link';
import { RefreshCw, ArrowUpRight } from 'lucide-react';
import type { AdminAdaptiveParticipant } from '@/lib/adaptive-admin-types';
import { adminContent as c, adminDate } from '@/lib/admin-content';
import { Skeleton } from './Skeleton';
import { Button } from './Button';
import { StatusBadge } from './StatusBadge';
export function AdminLoading({ ar }: {
    ar: boolean;
}) { return <Skeleton label={c.loading[ar ? 'ar' : 'fr']}/>; }
export function AdminError({ ar, retry }: {
    ar: boolean;
    retry: () => void;
}) { const lang = ar ? 'ar' : 'fr'; return <div role="alert" className="ad-alert ad-alert-error"><p>{c.failed[lang]}</p><Button onClick={retry}><RefreshCw size={16} aria-hidden="true"/>{c.retry[lang]}</Button></div>; }
export function AIStatus({ participant: p, ar }: {
    participant: AdminAdaptiveParticipant;
    ar: boolean;
}) { const lang = ar ? 'ar' : 'fr', pending = ['PENDING', 'PROCESSING', 'RETRY'].includes(p.aiStatus); return <StatusBadge tone={p.aiGenerated ? 'info' : pending ? 'warning' : 'neutral'}>{(p.aiGenerated ? c.aiReady : pending ? c.aiPending : p.status === 'IN_PROGRESS' ? c.afterTest : c.automatic)[lang]}</StatusBadge>; }
export function ParticipantRows({ participants, ar }: {
    participants: AdminAdaptiveParticipant[];
    ar: boolean;
}) { const lang = ar ? 'ar' : 'fr'; return <ul className="ad-recent-list">{participants.map(p => <li key={p.id}><Link href={`/admin/participants/${p.id}`} data-participant-row><span className="ad-avatar" aria-hidden="true">{p.displayName.slice(0, 2).toUpperCase()}</span><div className="ad-recent-identity"><strong>{p.displayName}</strong><span>{adminDate(p.createdAt, lang)} · {p.answeredCount}/31</span></div><ArrowUpRight size={18} className="ad-direction" aria-hidden="true"/></Link></li>)}</ul>; }
```

## frontend/src/components/admin/AdminShell.tsx

```tsx
"use client";
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { adminContent as c } from '@/lib/admin-content';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Skeleton } from './Skeleton';
interface AdminUser {
    id: string;
    email: string;
    role: string;
}
export function AdminShell({ children }: {
    children: React.ReactNode;
}) {
    const router = useRouter(), pathname = usePathname(), { lang } = useLanguage();
    const [admin, setAdmin] = useState<AdminUser | null>(null), [loading, setLoading] = useState(true), [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const drawer = useRef<HTMLDialogElement>(null);
    useEffect(() => { let active = true; void fetch('/api/admin/me', { cache: 'no-store' }).then(async (res) => { if (!res.ok)
        throw Error(); const data = await res.json(); if (!data.admin)
        throw Error(); if (active)
        setAdmin(data.admin); }).catch(() => { if (active)
        router.replace('/admin/login'); }).finally(() => { if (active)
        setLoading(false); }); return () => { active = false; }; }, [router]);
    useEffect(() => { if (mobileMenuOpen && !drawer.current?.open)
        drawer.current?.showModal();
    else if (!mobileMenuOpen && drawer.current?.open)
        drawer.current.close(); }, [mobileMenuOpen]);
    useEffect(() => { const media = matchMedia('(min-width:1100px)'); const close = () => { if (media.matches)
        setMobileMenuOpen(false); }; media.addEventListener('change', close); return () => media.removeEventListener('change', close); }, []);
    async function logout() { try {
        await fetch('/api/admin/logout', { method: 'POST' });
    }
    finally {
        router.replace('/admin/login');
    } }
    if (loading || !admin)
        return <div className="ad-auth-loading"><Skeleton label={c.loading[lang]}/></div>;
    return <div className="ad-shell"><a href="#admin-content" className="skip-link">{c.skip[lang]}</a><aside className="ad-sidebar"><Sidebar lang={lang} pathname={pathname} email={admin.email} onLogout={logout}/></aside><div className="ad-workarea"><Topbar lang={lang} pathname={pathname} email={admin.email} menuOpen={mobileMenuOpen} onMenu={() => setMobileMenuOpen(true)} onLogout={logout}/><section id="admin-content" tabIndex={-1} aria-label={c.content[lang]} className="admin-content ad-content">{children}</section></div><dialog ref={drawer} id="admin-navigation-drawer" className="admin-drawer ad-navigation-drawer" aria-label={c.navigation[lang]} onCancel={() => setMobileMenuOpen(false)} onClose={() => setMobileMenuOpen(false)} onClick={e => { const b = e.currentTarget.getBoundingClientRect(); if (e.target === e.currentTarget && (e.clientX < b.left || e.clientX > b.right))
        setMobileMenuOpen(false); }}><button className="ad-drawer-close ad-icon-button" onClick={() => setMobileMenuOpen(false)} aria-label={c.close[lang]}><X size={20} aria-hidden="true"/></button><Sidebar lang={lang} pathname={pathname} email={admin.email} onLogout={logout} onNavigate={() => setMobileMenuOpen(false)}/></dialog></div>;
}
```

## frontend/src/components/admin/Breadcrumbs.tsx

```tsx
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
export function Breadcrumbs({ label, items }: {
    label: string;
    items: {
        label: string;
        href?: string;
    }[];
}) { return <nav aria-label={label} className="ad-breadcrumbs"><ol>{items.map((item, i) => <li key={i}>{i > 0 && <ChevronRight size={16} className="ad-direction" aria-hidden="true"/>}{item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}</li>)}</ol></nav>; }
```

## frontend/src/components/admin/Button.tsx

```tsx
"use client";
import type { ButtonHTMLAttributes } from 'react';
import { LoaderCircle } from 'lucide-react';
export function Button({ variant = 'secondary', busy = false, className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    busy?: boolean;
}) { return <button {...props} className={`ad-button ad-button-${variant} ${className}`} disabled={props.disabled || busy} aria-busy={busy || undefined}>{busy && <LoaderCircle size={18} className="ad-spin" aria-hidden="true"/>}{children}</button>; }
```

## frontend/src/components/admin/ConfirmDialog.tsx

```tsx
"use client";
import { useEffect, useRef } from 'react';
import { Button } from './Button';
export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel, onConfirm, onClose }: {
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
    onClose: () => void;
}) { const ref = useRef<HTMLDialogElement>(null); useEffect(() => { if (open && !ref.current?.open)
    ref.current?.showModal(); if (!open && ref.current?.open)
    ref.current.close(); }, [open]); return <dialog ref={ref} className="ad-confirm" aria-labelledby="ad-confirm-title" aria-describedby="ad-confirm-description" onCancel={onClose}><h2 id="ad-confirm-title">{title}</h2><p id="ad-confirm-description">{description}</p><div className="ad-dialog-actions"><Button autoFocus onClick={onClose}>{cancelLabel}</Button><Button variant="primary" onClick={onConfirm}>{confirmLabel}</Button></div></dialog>; }
```

## frontend/src/components/admin/DataTable.tsx

```tsx
"use client";
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { AdminAdaptiveParticipant } from '@/lib/adaptive-admin-types';
import { adminContent as c, adminDate, AdminLanguage } from '@/lib/admin-content';
import { AIStatus } from './adaptive-ui';
export function DataTable({ rows, lang, selected, onSelect, onSelectAll }: {
    rows: AdminAdaptiveParticipant[];
    lang: AdminLanguage;
    selected: Set<string>;
    onSelect: (id: string) => void;
    onSelectAll: () => void;
}) { return <div className="ad-table-scroll" role="region" aria-label={c.tableCaption[lang]} tabIndex={0}><table className="ad-data-table"><caption className="sr-only">{c.tableCaption[lang]}</caption><thead><tr><th scope="col" className="ad-select-column"><label className="ad-check-target"><input type="checkbox" aria-label={c.selectAll[lang]} checked={rows.length > 0 && rows.every(r => selected.has(r.id))} onChange={onSelectAll}/></label></th><th scope="col">{c.identity[lang]}</th><th scope="col" className="ad-number">{c.progress[lang]}</th><th scope="col">{c.report[lang]}</th><th scope="col">{c.created[lang]}</th><th scope="col"><span className="sr-only">{c.actions[lang]}</span></th></tr></thead><tbody>{rows.map(p => <tr key={p.id} data-participant-row aria-selected={selected.has(p.id)}><td className="ad-select-column"><label className="ad-check-target"><span className="sr-only">{c.select[lang]} {p.displayName}</span><input type="checkbox" checked={selected.has(p.id)} onChange={() => onSelect(p.id)}/></label></td><th scope="row" className="ad-participant-identity"><Link href={`/admin/participants/${p.id}`}><span className="ad-avatar" aria-hidden="true">{p.displayName.slice(0, 2).toUpperCase()}</span><span><strong>{p.displayName}</strong><span className="ad-email" dir="ltr">{p.email || '—'}</span><span className="ad-mobile-meta">{(p.language === 'ar' ? c.arabic : c.french)[lang]} · {adminDate(p.createdAt, lang)}</span></span></Link></th><td className="ad-number" data-label={c.progress[lang]}><strong className="ad-tabular">{p.answeredCount}<span className="ad-muted">/31</span></strong><span className="ad-cell-sub">{(p.status === 'COMPLETED' ? c.finished : c.inProgress)[lang]}</span></td><td className="ad-report-cell" data-label={c.report[lang]}><AIStatus participant={p} ar={lang === 'ar'}/></td><td className="ad-created-cell"><span>{adminDate(p.createdAt, lang)}</span><span className="ad-cell-sub">{(p.language === 'ar' ? c.arabic : c.french)[lang]}</span></td><td className="ad-row-action"><Link href={`/admin/participants/${p.id}`} aria-label={`${c.openReport[lang]} — ${p.displayName}`}><ArrowUpRight size={18} className="ad-direction" aria-hidden="true"/></Link></td></tr>)}</tbody></table></div>; }
```

## frontend/src/components/admin/EmptyState.tsx

```tsx
import type { ReactNode } from 'react';
export function EmptyState({ title, body, children }: {
    title: string;
    body?: string;
    children?: ReactNode;
}) { return <div className="ad-empty"><svg viewBox="0 0 100 44" fill="none" aria-hidden="true"><path d="M8 40a42 42 0 0 1 84 0M24 40a26 26 0 0 1 52 0M40 40a10 10 0 0 1 20 0"/><circle cx="78" cy="11" r="3"/></svg><h3>{title}</h3>{body && <p>{body}</p>}{children}</div>; }
```

## frontend/src/components/admin/FilterBar.tsx

```tsx
import type { ReactNode } from 'react';
export function FilterBar({ label, children }: {
    label: string;
    children: ReactNode;
}) { return <section className="ad-filter-bar" aria-label={label}>{children}</section>; }
```

## frontend/src/components/admin/FormField.tsx

```tsx
import type { ReactNode } from 'react';
export function FormField({ id, label, hint, children }: {
    id: string;
    label: string;
    hint?: string;
    children: ReactNode;
}) { return <div className="ad-field"><label htmlFor={id}>{label}</label>{children}{hint && <p id={`${id}-hint`} className="ad-muted">{hint}</p>}</div>; }
```

## frontend/src/components/admin/PageHeader.tsx

```tsx
import type { ReactNode } from 'react';
export function PageHeader({ title, description, children }: {
    title: string;
    description?: string;
    children?: ReactNode;
}) { return <div className="ad-page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{children && <div className="ad-page-actions">{children}</div>}</div>; }
```

## frontend/src/components/admin/ReportView.tsx

```tsx
"use client";
import { useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { adminContent as c, AdminLanguage } from '@/lib/admin-content';
import { homeContent } from '@/lib/home-content';
import type { AdaptiveInterview, AdaptiveReportSkill } from '@/lib/adaptive-types';
import { Button } from './Button';
export function ReportView({ report, aiStatus, lang }: {
    report: NonNullable<AdaptiveInterview['report']>;
    aiStatus: string;
    lang: AdminLanguage;
}) {
    const root = useRef<HTMLElement>(null);
    const groups = homeContent.skills.families.map(f => ({ id: f.id, label: f.label[lang], skills: report.skills.filter(s => f.ids.includes(s.id)) }));
    const known = new Set(groups.flatMap(g => g.skills.map(s => s.id)));
    const other = report.skills.filter(s => !known.has(s.id));
    if (other.length)
        groups.push({ id: 'other', label: c.other[lang], skills: other });
    function toggle(open: boolean) { root.current?.querySelectorAll<HTMLDetailsElement>('details[data-skill-details]').forEach(d => { d.open = open; }); }
    return <section ref={root} data-adaptive-report className="ad-report" dir={lang === 'ar' ? 'rtl' : 'ltr'}><article data-adaptive-summary className="ad-report-summary"><div className="ad-summary-heading"><BrandLogo /><span className="ad-summary-source">{(report.summarySource === 'ai' ? c.aiSummary : c.ruleSummary)[lang]}</span></div><h2>{c.reportTitle[lang]}</h2><p className="ad-report-prose">{report.summary}</p>{report.summarySource !== 'ai' && <p className="ad-notice">{(['PENDING', 'PROCESSING', 'RETRY'].includes(aiStatus) ? c.awaitAI : c.noAI)[lang]}</p>}<p className="ad-disclaimer">{report.disclaimer}</p>{!!report.legacyObservationCount && <p className="ad-caption">{c.legacyAnswers[lang]}</p>}</article><div className="ad-report-tools print:hidden"><nav aria-label={c.families[lang]}>{groups.map(g => <a key={g.id} href={`#family-${g.id}`}>{g.label}<span>{g.skills.length}</span></a>)}</nav><div><Button variant="ghost" onClick={() => toggle(true)}>{c.expandAll[lang]}</Button><Button variant="ghost" onClick={() => toggle(false)}>{c.collapseAll[lang]}</Button></div></div>{groups.filter(g => g.skills.length).map(group => <section key={group.id} id={`family-${group.id}`} className="ad-report-family"><div className="ad-family-heading"><h2>{group.label}</h2><span>{group.skills.length} {c.familyCount[lang]}</span></div><div className="ad-skill-list">{group.skills.map(skill => <article key={skill.id} data-adaptive-skill className="ad-skill"><details data-skill-details><summary><h3>{skill.label}</h3><span className="ad-skill-reference">{skill.level === null ? c.notObserved[lang] : `${c.reference[lang]} ${skill.level}/4`}</span><ChevronDown size={18} aria-hidden="true"/></summary><SkillBody skill={skill} lang={lang}/></details><div className="hidden print:block"><h3>{skill.label} · {skill.level === null ? c.notObserved[lang] : `${c.reference[lang]} ${skill.level}/4`}</h3><SkillBody skill={skill} lang={lang}/></div></article>)}</div></section>)}</section>;
}
function SkillBody({ skill, lang }: {
    skill: AdaptiveReportSkill;
    lang: AdminLanguage;
}) { return <div className="ad-skill-body"><div><h4>{c.question[lang]}</h4><p>{skill.question || '—'}</p><h4>{c.choice[lang]}</h4><p>{skill.answer || skill.evidenceQuote || '—'}</p></div><div><h4>{c.rationale[lang]}</h4><p>{skill.rationale}</p><h4>{c.advice[lang]}</h4><p>{skill.advice}</p></div></div>; }
```

## frontend/src/components/admin/Sidebar.tsx

```tsx
"use client";
import Link from 'next/link';
import { LayoutDashboard, Users, Search, ArrowUpRight, LogOut, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { adminContent as c, AdminLanguage } from '@/lib/admin-content';
export const adminNav = [{ href: '/admin/dashboard', key: 'overview' as const, icon: LayoutDashboard }, { href: '/admin/participants', key: 'participants' as const, icon: Users }];
export function Sidebar({ lang, pathname, email, onLogout, onNavigate }: {
    lang: AdminLanguage;
    pathname: string;
    email: string;
    onLogout: () => void;
    onNavigate?: () => void;
}) { return <div className="ad-sidebar-inner"><Link href="/" className="ad-logo-surface" aria-label="SkillQuest"><BrandLogo /></Link><p className="ad-workspace"><ShieldCheck size={16} aria-hidden="true"/>{c.workspace[lang]}</p><form action="/admin/participants" role="search" className="ad-drawer-search"><label htmlFor="admin-drawer-search">{c.searchHint[lang]}</label><div><input id="admin-drawer-search" name="search" maxLength={100}/><button aria-label={c.searchGo[lang]}><Search size={18} aria-hidden="true"/></button></div></form><nav aria-label={c.navigation[lang]}><p className="ad-nav-group">{c.follow[lang]}</p>{adminNav.map(item => <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={pathname.startsWith(item.href) ? 'page' : undefined}><item.icon size={18} strokeWidth={1.7} aria-hidden="true"/>{c[item.key][lang]}</Link>)}</nav><div className="ad-sidebar-foot"><Link className="ad-site-link" href="/" target="_blank" rel="noreferrer">{c.site[lang]}<ArrowUpRight size={16} className="ad-direction" aria-hidden="true"/></Link><div className="ad-user"><span className="ad-avatar" aria-hidden="true">{email.slice(0, 2).toUpperCase()}</span><div><p dir="ltr" title={email}>{email}</p><span>{c.connected[lang]}</span></div><button aria-label={c.logout[lang]} onClick={onLogout}><LogOut size={18} aria-hidden="true"/></button></div></div></div>; }
```

## frontend/src/components/admin/Skeleton.tsx

```tsx
export function Skeleton({ label, rows = 4 }: {
    label: string;
    rows?: number;
}) { return <div role="status" className="ad-skeleton"><span className="sr-only">{label}</span><div className="ad-skeleton-title"/>{Array.from({ length: rows }, (_, i) => <div className="ad-skeleton-row" key={i}><span /><span /><span /></div>)}</div>; }
```

## frontend/src/components/admin/StatCard.tsx

```tsx
import type { ReactNode } from 'react';
export function StatCard({ label, value, note, lead = false }: {
    label: string;
    value: ReactNode;
    note?: string;
    lead?: boolean;
}) { return <div data-kpi className={`ad-stat ${lead ? 'ad-stat-lead' : ''}`}><dt>{label}</dt><dd data-kpi-value>{value}</dd>{note && <p>{note}</p>}</div>; }
```

## frontend/src/components/admin/StatusBadge.tsx

```tsx
import type { ReactNode } from 'react';
export function StatusBadge({ tone = 'neutral', children }: {
    tone?: 'neutral' | 'info' | 'success' | 'warning' | 'error';
    children: ReactNode;
}) { return <span className={`ad-badge ad-badge-${tone}`}>{children}</span>; }
```

## frontend/src/components/admin/Toast.tsx

```tsx
"use client";
import { useEffect, useState } from 'react';
export function Toast({ message }: {
    message: string;
}) { const [visible, setVisible] = useState(false); useEffect(() => { if (!message)
    return; setVisible(true); const t = setTimeout(() => setVisible(false), 4000); return () => clearTimeout(t); }, [message]); return <div className={visible ? 'ad-toast' : 'sr-only'} role="status" aria-live="polite">{visible ? message : ''}</div>; }
```

## frontend/src/components/admin/Topbar.tsx

```tsx
"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Menu, Search, UserRound, LogOut, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { LanguageSwitcher } from '@/components/language-switcher';
import { adminContent as c, AdminLanguage } from '@/lib/admin-content';
import { Breadcrumbs } from './Breadcrumbs';
export function Topbar({ lang, pathname, email, menuOpen, onMenu, onLogout }: {
    lang: AdminLanguage;
    pathname: string;
    email: string;
    menuOpen: boolean;
    onMenu: () => void;
    onLogout: () => void;
}) { const router = useRouter(), [q, setQ] = useState(''); const detail = pathname.startsWith('/admin/participants/'); const items = [{ label: c.admin[lang], href: '/admin/dashboard' }, { label: (pathname.startsWith('/admin/participants') ? c.participants : c.overview)[lang], ...(detail ? { href: '/admin/participants' } : {}) }, ...(detail ? [{ label: c.participant[lang] }] : [])]; return <header className="ad-topbar"><button className="ad-mobile-menu ad-icon-button" onClick={onMenu} aria-label={c.openMenu[lang]} aria-expanded={menuOpen} aria-controls="admin-navigation-drawer"><Menu size={20} aria-hidden="true"/></button><Breadcrumbs label={c.breadcrumb[lang]} items={items}/><form className="ad-global-search" role="search" onSubmit={e => { e.preventDefault(); router.push(`/admin/participants?search=${encodeURIComponent(q.trim())}`); }}><label htmlFor="admin-global-search" className="sr-only">{c.searchHint[lang]}</label><Search size={18} aria-hidden="true"/><input id="admin-global-search" value={q} maxLength={100} onChange={e => setQ(e.target.value)} placeholder={c.searchHint[lang]}/><button type="submit" aria-label={c.searchGo[lang]}><ArrowUpRight size={18} className="ad-direction" aria-hidden="true"/></button></form><div className="ad-topbar-tools"><LanguageSwitcher /><details className="ad-profile"><summary aria-label={c.profile[lang]}><UserRound size={18} aria-hidden="true"/></summary><div className="ad-profile-menu"><strong>{c.profile[lang]}</strong><p dir="ltr">{email}</p><Link href="/">{c.site[lang]}</Link><button onClick={onLogout}><LogOut size={16} aria-hidden="true"/>{c.logout[lang]}</button></div></details></div></header>; }
```

## frontend/src/app/admin/(protected)/dashboard/page.tsx

```tsx
"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, ArrowUpRight, FileText, Users } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { adminContent as c, adminDate } from '@/lib/admin-content';
import type { AdaptiveDashboard } from '@/lib/adaptive-admin-types';
import { AdminLoading, AdminError, ParticipantRows } from '@/components/admin/adaptive-ui';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/admin/Button';
import { StatCard } from '@/components/admin/StatCard';
import { ActivityChart } from '@/components/admin/ActivityChart';
import { EmptyState } from '@/components/admin/EmptyState';
import { Toast } from '@/components/admin/Toast';
export default function DashboardPage() {
    const { lang } = useLanguage(), ar = lang === 'ar';
    const [data, setData] = useState<AdaptiveDashboard | null>(null), [error, setError] = useState(false), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0), [toast, setToast] = useState('');
    useEffect(() => { let active = true; setLoading(true); setError(false); fetch(`/api/admin/adaptive/dashboard?lang=${lang}`, { cache: 'no-store' }).then(async (res) => { if (!res.ok)
        throw Error(); return res.json() as Promise<AdaptiveDashboard>; }).then(value => { if (active) {
        setData(value);
        if (refresh)
            setToast(c.refreshDone[lang] + ' ');
    } }).catch(() => { if (active)
        setError(true); }).finally(() => { if (active)
        setLoading(false); }); return () => { active = false; }; }, [lang, refresh]);
    const latest = data?.recentParticipants.reduce<string | null>((latest, p) => !latest || p.updatedAt > latest ? p.updatedAt : latest, null);
    return <div data-adaptive-dashboard className="ad-dashboard"><PageHeader title={c.overview[lang]} description={c.dashboardIntro[lang]}><svg className="ad-header-motif" viewBox="0 0 88 44" fill="none" aria-hidden="true"><path d="M4 42a40 40 0 0 1 80 0M20 42a24 24 0 0 1 48 0M36 42a8 8 0 0 1 16 0"/><circle cx="74" cy="15" r="3"/></svg><Button onClick={() => { setToast(''); setRefresh(v => v + 1); }} disabled={loading}><RefreshCw size={16} className={loading ? 'ad-spin' : ''} aria-hidden="true"/>{c.refresh[lang]}</Button></PageHeader>{error ? <AdminError ar={ar} retry={() => setRefresh(v => v + 1)}/> : !data ? <AdminLoading ar={ar}/> : <><dl className="ad-stats" aria-busy={loading}><StatCard label={c.recorded[lang]} value={data.kpis.totalParticipants.toLocaleString(ar ? 'ar-MA' : 'fr-FR')} note={c.savedJourneys[lang]} lead/><StatCard label={c.completed[lang]} value={data.kpis.completedTests.toLocaleString(ar ? 'ar-MA' : 'fr-FR')} note={c.allAnswers[lang]}/><StatCard label={c.completion[lang]} value={`${data.kpis.completionRate}%`} note={c.ofRecorded[lang]}/><StatCard label={c.lastActivity[lang]} value={latest ? adminDate(latest, lang) : '—'} note={latest ? c.recentScope[lang] : c.noActivity[lang]}/></dl><div className="ad-dashboard-grid"><section className="ad-panel ad-evolution"><div className="ad-panel-heading"><h2>{c.evolution[lang]}</h2><span>{c.week[lang]}</span></div><ActivityChart participants={data.recentParticipants} generatedAt={data.generatedAt} lang={lang}/></section><section className="ad-panel ad-activity"><div className="ad-panel-heading"><h2>{c.activity[lang]}</h2><Link href="/admin/participants">{c.all[lang]}<ArrowUpRight size={16} className="ad-direction" aria-hidden="true"/></Link></div>{data.recentParticipants.length ? <ParticipantRows participants={data.recentParticipants.slice(0, 4)} ar={ar}/> : <EmptyState title={c.noActivity[lang]} body={c.emptyBody[lang]}/>}</section><section className="ad-panel ad-indicators"><div className="ad-panel-heading"><h2>{c.indicators[lang]}</h2></div>{data.topSkills.length ? <ul className="ad-indicator-list">{[...data.topSkills].sort((a, b) => a.label.localeCompare(b.label, lang)).map(skill => <li key={skill.id} data-top-skill><span>{skill.label}</span><div><span className="ad-indicator-value">{skill.average === null ? '—' : skill.average.toFixed(2)}<small>/4</small></span><span className="ad-muted">{skill.participants} {(skill.participants===1?c.participation:c.count)[lang]}</span></div></li>)}</ul> : <EmptyState title={c.noIndicators[lang]}/>}<p className="ad-caption">{c.indicatorsNote[lang]}</p></section><section className="ad-panel ad-shortcuts"><h2>{c.shortcuts[lang]}</h2><div className="ad-shortcut-links"><Link href="/admin/participants"><Users size={18} aria-hidden="true"/>{c.openParticipants[lang]}<ArrowUpRight size={16} className="ad-direction" aria-hidden="true"/></Link><Link href="/admin/participants"><FileText size={18} aria-hidden="true"/>{c.seeCompleted[lang]}<ArrowUpRight size={16} className="ad-direction" aria-hidden="true"/></Link></div><dl className="ad-ai-counters"><div><dt>{c.aiReports[lang]}</dt><dd>{data.kpis.aiReports}</dd></div><div><dt>{c.pending[lang]}</dt><dd>{data.kpis.pendingAIReports}</dd></div></dl><p className="ad-caption">{c.pendingNote[lang]}</p></section></div><p className="ad-freshness">{c.updated[lang]} · {adminDate(data.generatedAt, lang, true)}</p></>}<Toast message={toast}/></div>;
}
```

## frontend/src/app/admin/(protected)/participants/page.tsx

```tsx
"use client";
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, RefreshCw, Download } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { adminContent as c } from '@/lib/admin-content';
import type { AdaptiveParticipantList } from '@/lib/adaptive-admin-types';
import { AdminLoading, AdminError } from '@/components/admin/adaptive-ui';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/admin/Button';
import { FilterBar } from '@/components/admin/FilterBar';
import { FormField } from '@/components/admin/FormField';
import { DataTable } from '@/components/admin/DataTable';
import { EmptyState } from '@/components/admin/EmptyState';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Toast } from '@/components/admin/Toast';
export default function ParticipantsPage() { return <Suspense><ParticipantList /></Suspense>; }
function ParticipantList() {
    const { lang } = useLanguage(), ar = lang === 'ar', params = useSearchParams();
    const [search, setSearch] = useState(''), [debounced, setDebounced] = useState(''), [status, setStatus] = useState('ALL'), [ai, setAI] = useState('ALL'), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
    const [data, setData] = useState<AdaptiveParticipantList | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(false);
    const [language, setLanguage] = useState('ALL'), [period, setPeriod] = useState('ALL'), [sort, setSort] = useState('recent'), [selected, setSelected] = useState<Set<string>>(new Set()), [confirm, setConfirm] = useState(false), [toast, setToast] = useState('');
    useEffect(() => { setSearch(params.get('search')?.slice(0, 100) || ''); }, [params]);
    useEffect(() => { const timer = setTimeout(() => { setDebounced(search); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
    useEffect(() => { let active = true; setLoading(true); setError(false); const query = new URLSearchParams({ page: String(page), limit: '12', search: debounced, status, ai }); fetch(`/api/admin/adaptive/participants?${query}`, { cache: 'no-store' }).then(async (res) => { if (!res.ok)
        throw Error(); return res.json() as Promise<AdaptiveParticipantList>; }).then(value => { if (active)
        setData(value); }).catch(() => { if (active)
        setError(true); }).finally(() => { if (active)
        setLoading(false); }); return () => { active = false; }; }, [page, debounced, status, ai, refresh]);
    const visible = useMemo(() => { const minDate = period === 'ALL' ? 0 : Date.now() - Number(period) * 86400000; return (data?.participants || []).filter(p => (language === 'ALL' || p.language === language) && new Date(p.createdAt).getTime() >= minDate).sort((a, b) => sort === 'name' ? a.displayName.localeCompare(b.displayName, lang) : sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)); }, [data, language, period, sort, lang]);
    useEffect(() => { setSelected(new Set()); }, [data, language, period, sort]);
    function reset() { setSearch(''); setStatus('ALL'); setAI('ALL'); setLanguage('ALL'); setPeriod('ALL'); setSort('recent'); setPage(1); }
    function exportSelected() { const rows = visible.filter(p => selected.has(p.id)); const cell = (v: string) => { const safe = /^[\s]*[=+\-@]/.test(v) ? `'${v}` : v; return `"${safe.replaceAll('"', '""')}"`; }; const lines = [[c.identity[lang], c.email[lang], c.testState[lang], c.language[lang], c.created[lang]], ...rows.map(p => [p.displayName, p.email || '', p.status, p.language, p.createdAt])]; const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.map(row => row.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8;' })); const a = document.createElement('a'); a.href = url; a.download = 'skillquest-participations.csv'; document.body.appendChild(a);a.click();a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); setConfirm(false); setToast(c.exported[lang]); }
    return <div data-adaptive-participants><PageHeader title={c.listTitle[lang]} description={c.listIntro[lang]}><Button disabled={loading} aria-label={c.refresh[lang]} onClick={() => setRefresh(v => v + 1)}><RefreshCw size={18} aria-hidden="true"/></Button><Button onClick={() => { setToast(''); setConfirm(true); }} disabled={!selected.size}><Download size={18} aria-hidden="true"/>{c.export[lang]}</Button></PageHeader><FilterBar label={c.filters[lang]}><div className="ad-filters-main"><FormField id="participant-search" label={c.search[lang]}><div className="ad-search-field"><Search size={18} aria-hidden="true"/><input id="participant-search" aria-label={c.search[lang]} value={search} onChange={e => setSearch(e.target.value)} maxLength={100}/></div></FormField><FormField id="participant-status" label={c.testState[lang]}><select id="participant-status" aria-label={c.testState[lang]} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="ALL">{c.allTests[lang]}</option><option value="COMPLETED">{c.completeTests[lang]}</option><option value="IN_PROGRESS">{c.currentTests[lang]}</option></select></FormField><FormField id="participant-ai" label={c.aiState[lang]}><select id="participant-ai" aria-label={c.aiState[lang]} value={ai} onChange={e => { setAI(e.target.value); setPage(1); }}><option value="ALL">{c.allReports[lang]}</option><option value="COMPLETE">{c.aiReady[lang]}</option><option value="PENDING">{c.aiPending[lang]}</option><option value="UNAVAILABLE">{c.automatic[lang]}</option></select></FormField></div><details className="ad-local-filters"><summary>{c.moreFilters[lang]}</summary><div className="ad-filters-secondary"><FormField id="page-language" label={c.language[lang]}><select id="page-language" value={language} onChange={e => setLanguage(e.target.value)}><option value="ALL">{c.allLanguages[lang]}</option><option value="fr">{c.french[lang]}</option><option value="ar">{c.arabic[lang]}</option></select></FormField><FormField id="page-period" label={c.period[lang]}><select id="page-period" value={period} onChange={e => setPeriod(e.target.value)}><option value="ALL">{c.allDates[lang]}</option><option value="7">{c.week[lang]}</option><option value="30">{c.month[lang]}</option></select></FormField><FormField id="page-sort" label={c.sort[lang]}><select id="page-sort" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">{c.recentFirst[lang]}</option><option value="oldest">{c.oldestFirst[lang]}</option><option value="name">{c.nameFirst[lang]}</option></select></FormField></div><p className="ad-caption">{c.localScope[lang]}</p></details></FilterBar>{error ? <AdminError ar={ar} retry={() => setRefresh(v => v + 1)}/> : loading || !data ? <AdminLoading ar={ar}/> : <section className="ad-list-panel"><div className="ad-list-summary"><p><strong>{data.pagination.total}</strong> {(data.pagination.total===1?c.oneTotal:c.total)[lang]} <span>· {visible.length} {c.shown[lang]}</span></p>{selected.size > 0 && <p role="status">{selected.size} {c.selected[lang]}</p>}</div>{visible.length ? <DataTable rows={visible} lang={lang} selected={selected} onSelect={id => setSelected(prev => { const next = new Set(prev); if (next.has(id))
        next.delete(id);
    else
        next.add(id); return next; })} onSelectAll={() => setSelected(selected.size === visible.length ? new Set() : new Set(visible.map(p => p.id)))}/> : <EmptyState title={c.emptyTitle[lang]} body={c.emptyBody[lang]}><Button onClick={reset}>{c.reset[lang]}</Button></EmptyState>}<div className="ad-pagination"><span>{c.page[lang]} {page} {c.of[lang]} {data.pagination.totalPages}</span><div><Button disabled={page <= 1} onClick={() => setPage(v => v - 1)}>{c.previous[lang]}</Button><Button disabled={page >= data.pagination.totalPages} onClick={() => setPage(v => v + 1)}>{c.next[lang]}</Button></div></div></section>}<ConfirmDialog open={confirm} title={c.exportTitle[lang]} description={c.exportBody[lang]} confirmLabel={c.download[lang]} cancelLabel={c.cancel[lang]} onConfirm={exportSelected} onClose={() => setConfirm(false)}/><Toast message={toast}/></div>;
}
```

## frontend/src/app/admin/(protected)/participants/[id]/page.tsx

```tsx
"use client";
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Download, FileText, ListChecks, RefreshCw, ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { adminContent as c, adminDate } from '@/lib/admin-content';
import type { AdaptiveParticipantDetail } from '@/lib/adaptive-admin-types';
import { AdminLoading, AdminError, AIStatus } from '@/components/admin/adaptive-ui';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/admin/Button';
import { EmptyState } from '@/components/admin/EmptyState';
import { ReportView } from '@/components/admin/ReportView';
export default function ParticipantDetailPage() {
    const { id } = useParams<{
        id: string;
    }>(), { lang } = useLanguage(), ar = lang === 'ar';
    const [data, setData] = useState<AdaptiveParticipantDetail | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(false), [missing, setMissing] = useState(false), [refresh, setRefresh] = useState(0), [tab, setTab] = useState<'report' | 'answers'>('report');
    useEffect(() => { let active = true; setLoading(true); setError(false); setMissing(false); fetch(`/api/admin/adaptive/participants/${id}?lang=${lang}`, { cache: 'no-store' }).then(async (res) => { if (res.status === 404) {
        if (active)
            setMissing(true);
        return null;
    } if (!res.ok)
        throw Error(); return res.json() as Promise<AdaptiveParticipantDetail>; }).then(value => { if (active)
        setData(value); }).catch(() => { if (active)
        setError(true); }).finally(() => { if (active)
        setLoading(false); }); return () => { active = false; }; }, [id, lang, refresh]);
    const aiStatus = data?.participant.aiStatus;
    useEffect(() => { if (!aiStatus || !['PENDING', 'PROCESSING', 'RETRY'].includes(aiStatus))
        return; let active = true; const timer = setInterval(() => { if (document.visibilityState !== 'visible')
        return; void fetch(`/api/admin/adaptive/participants/${id}?lang=${lang}`, { cache: 'no-store' }).then(async (res) => { if (res.ok) {
        const value = await res.json();
        if (active)
            setData(value);
    } }).catch(() => { }); }, 30000); return () => { active = false; clearInterval(timer); }; }, [id, lang, aiStatus]);
    const p = data?.participant, interview = data?.interview, report = interview?.report;
    return <div data-admin-participant-detail><Link href="/admin/participants" className="ad-back-link print:hidden"><ArrowLeft size={16} className="ad-direction" aria-hidden="true"/>{c.back[lang]}</Link>{error ? <AdminError ar={ar} retry={() => setRefresh(v => v + 1)}/> : loading ? <AdminLoading ar={ar}/> : missing || !data || !p || !interview ? <EmptyState title={c.missingTitle[lang]} body={c.missingBody[lang]}/> : <><PageHeader title={p.displayName} description={`${p.answeredCount}/31 ${c.savedAnswers[lang]}`}><div className="print:hidden"><Button aria-label={c.refresh[lang]} onClick={() => setRefresh(v => v + 1)}><RefreshCw size={18} aria-hidden="true"/></Button>{report && tab === 'report' && <Button variant="primary" onClick={() => window.print()}><Download size={18} aria-hidden="true"/>{c.print[lang]}</Button>}</div></PageHeader><div className="ad-participant-status"><span>{(p.status === 'COMPLETED' ? c.finished : c.inProgress)[lang]}</span><AIStatus participant={p} ar={ar}/></div><section className="ad-participant-info print:hidden" aria-label={c.participant[lang]}><dl>{[{ label: c.startLanguage[lang], value: (p.language === 'ar' ? c.arabic : c.french)[lang] }, { label: c.started[lang], value: adminDate(p.createdAt, lang, true) }, { label: c.last[lang], value: adminDate(p.updatedAt, lang, true) }, { label: c.expires[lang], value: adminDate(p.expiresAt, lang, true) }].map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}<div className="ad-info-email"><dt>{c.declaredEmail[lang]}</dt><dd dir={p.email ? 'ltr' : undefined}>{p.email || c.legacyEmail[lang]}</dd></div><div className="ad-info-id"><dt>{c.participationId[lang]}</dt><dd>{p.id}</dd></div></dl></section><p className="ad-privacy"><ShieldCheck size={16} aria-hidden="true"/>{c.private[lang]}</p><div className="ad-detail-tabs print:hidden">{[{ id: 'report' as const, label: c.personalReport[lang], icon: FileText }, { id: 'answers' as const, label: c.answers[lang], icon: ListChecks }].map(item => <button key={item.id} onClick={() => setTab(item.id)} aria-pressed={tab === item.id}><item.icon size={18} aria-hidden="true"/>{item.label}</button>)}</div>{tab === 'report' ? report ? <ReportView report={report} aiStatus={p.aiStatus} lang={lang}/> : <EmptyState title={c.reportWaiting[lang]} body={c.reportWaitingBody[lang]}/> : <section className="ad-answers">{interview.transcript.length ? interview.transcript.map((answer, index) => <article key={index} className="ad-answer"><h2>{c.question[lang]} {index + 1}</h2><p>{answer.question}</p><div><h3>{c.choice[lang]}</h3><p>{answer.answer}</p></div></article>) : <EmptyState title={c.noAnswers[lang]}/>}</section>}</>}</div>;
}
```

## frontend/src/app/admin/page.tsx

```tsx
import { redirect } from "next/navigation";

export default function AdminIndexPage() {
  redirect("/admin/dashboard");
}
```

## frontend/src/lib/admin-content.ts

```tsx
const t = (fr: string, ar: string) => ({ fr, ar });
export const adminContent = {
    participation: t("participation", "مشاركة"),
    finished: t("Terminé", "مكتمل"),
    oneTotal: t("participation au total", "مشاركة إجمالا"),
    brand: t('SkillQuest', 'SkillQuest'), association: t('Association Chabab Connect', 'جمعية شباب كونكت'), admin: t('Administration', 'الإدارة'), workspace: t('Accompagnement pédagogique', 'المواكبة التربوية'), navigation: t('Navigation de l’administration', 'قائمة الإدارة'), overview: t('Tableau de bord', 'لوحة القيادة'), participants: t('Participants', 'المشاركون'), participant: t('Fiche participant', 'ملف المشارك'), follow: t('Suivi des parcours', 'متابعة المسارات'), reports: t('Rapports personnels', 'التقارير الشخصية'), site: t('Voir le site', 'مشاهدة الموقع'), logout: t('Se déconnecter', 'تسجيل الخروج'), profile: t('Compte administrateur', 'حساب المسؤول'), connected: t('Administrateur connecté', 'مسؤول متصل'), openMenu: t('Ouvrir le menu', 'فتح القائمة'), close: t('Fermer', 'إغلاق'), skip: t('Aller au contenu', 'الانتقال إلى المحتوى'), content: t('Contenu de l’administration', 'محتوى الإدارة'), breadcrumb: t('Fil d’Ariane', 'مسار التنقل'), search: t('Rechercher par nom ou e-mail', 'البحث بالاسم أو البريد الإلكتروني'), searchGo: t('Rechercher', 'بحث'), searchHint: t('Retrouver un participant', 'العثور على مشارك'),
    loginTitle: t('Connexion administrateur', 'تسجيل دخول المسؤول'), loginIntro: t('Un espace réservé à l’équipe et aux encadrants de Chabab Connect.', 'فضاء مخصص لفريق جمعية شباب كونكت والمؤطرين.'), loginStatement: t('Des parcours à comprendre. Des personnes à accompagner.', 'فهم المسارات. ومواكبة الأشخاص.'), loginBrandBody: t('Retrouvez les participations et leurs rapports pour ouvrir une discussion pédagogique, dans le respect de chacun.', 'اطّلع على المشاركات وتقاريرها لفتح نقاش تربوي يحترم كل شخص.'), email: t('Adresse e-mail', 'البريد الإلكتروني'), password: t('Mot de passe', 'كلمة المرور'), showPassword: t('Afficher le mot de passe', 'إظهار كلمة المرور'), hidePassword: t('Masquer le mot de passe', 'إخفاء كلمة المرور'), login: t('Accéder à l’administration', 'الدخول إلى الإدارة'), logging: t('Vérification en cours…', 'جارٍ التحقق…'), invalid: t('Identifiants invalides.', 'بيانات الدخول غير صحيحة.'), network: t('Impossible de joindre le serveur. Réessayez.', 'تعذر الاتصال بالخادم. حاول مجددا.'), restricted: t('Accès réservé aux personnes autorisées.', 'الدخول مخصص للأشخاص المخولين.'), backSite: t('Retour au site', 'العودة إلى الموقع'),
    loading: t('Chargement des données…', 'جارٍ تحميل البيانات…'), failed: t('Impossible de charger les données.', 'تعذر تحميل البيانات.'), retry: t('Réessayer', 'إعادة المحاولة'), refresh: t('Actualiser', 'تحديث'), updated: t('Données actualisées', 'تم تحديث البيانات'), refreshDone: t('Les données ont été actualisées.', 'تم تحديث البيانات.'), dashboardIntro: t('Le point sur les participations et les bilans disponibles.', 'نظرة على المشاركات والتقارير المتاحة.'), recorded: t('Participations enregistrées', 'مشاركات محفوظة'), completed: t('Tests terminés', 'اختبارات مكتملة'), inProgress: t('En cours', 'قيد الإنجاز'), completion: t('Taux de complétion', 'نسبة الإتمام'), lastActivity: t('Dernière activité récente', 'آخر نشاط حديث'), savedJourneys: t('Un parcours compte comme une participation.', 'يُحسب كل مسار كمشاركة.'), allAnswers: t('31 réponses sauvegardées', '31 إجابة محفوظة'), ofRecorded: t('Sur les participations enregistrées', 'من المشاركات المحفوظة'), recentScope: t('Parmi les parcours récents disponibles', 'ضمن المسارات الحديثة المتاحة'), noActivity: t('Aucune activité enregistrée', 'لا يوجد نشاط مسجل'), activity: t('Activité récente', 'النشاط الحديث'), evolution: t('Départs des parcours récents', 'بداية المسارات الحديثة'), chartScope: t('Sept derniers jours · parcours récents reçus uniquement, pas un historique global.', 'آخر سبعة أيام · المسارات الحديثة المتاحة فقط، وليس السجل العام.'), chartTable: t('Départs par jour dans les parcours récents', 'بدايات المسارات حسب اليوم ضمن المشاركات الحديثة'), day: t('Jour', 'اليوم'), count: t('Participations', 'المشاركات'), all: t('Tout voir', 'عرض الجميع'), shortcuts: t('Accès rapides', 'روابط سريعة'), openParticipants: t('Consulter les participants', 'عرض المشاركين'), seeCompleted: t('Consulter les bilans', 'عرض التقارير'), aiReports: t('Synthèses IA disponibles', 'خلاصات IA متاحة'), pending: t('Synthèses IA en attente', 'خلاصات IA قيد الانتظار'), pendingNote: t('Le bilan automatique reste accessible pendant l’attente.', 'يبقى التقرير التلقائي متاحا أثناء الانتظار.'), indicators: t('Repères pédagogiques disponibles', 'المؤشرات التربوية المتاحة'), indicatorsNote: t('Échantillon fourni par le service, présenté sans classement. Ces repères décrivent des choix en situation.', 'عينة يقدمها النظام، معروضة دون ترتيب. تصف هذه المؤشرات الاختيارات في المواقف.'), indicatorUnit: t('Moyenne des observations /4', 'متوسط الملاحظات /4'), noIndicators: t('Les repères apparaîtront après un premier test terminé.', 'ستظهر المؤشرات بعد إتمام أول اختبار.'),
    listTitle: t('Participants et rapports', 'المشاركون وتقاريرهم'), listIntro: t('Retrouvez un parcours, ses réponses et son bilan personnel.', 'اعثر على مسار وإجاباته وتقريره الشخصي.'), filters: t('Filtres des participations', 'تصفية المشاركات'), testState: t('État du test', 'حالة الاختبار'), aiState: t('État de la synthèse IA', 'حالة خلاصة IA'), allTests: t('Tous les tests', 'كل الاختبارات'), allReports: t('Tous les rapports', 'كل التقارير'), completeTests: t('Tests terminés', 'الاختبارات المكتملة'), currentTests: t('Tests en cours', 'الاختبارات الجارية'), aiReady: t('Synthèse IA prête', 'خلاصة IA جاهزة'), aiPending: t('Synthèse IA en attente', 'خلاصة IA قيد الانتظار'), automatic: t('Bilan automatique', 'تقرير تلقائي'), afterTest: t('Après le test', 'بعد إتمام الاختبار'), language: t('Langue', 'اللغة'), allLanguages: t('Toutes les langues', 'كل اللغات'), french: t('Français', 'الفرنسية'), arabic: t('Arabe', 'العربية'), period: t('Début du parcours', 'بداية المسار'), allDates: t('Toutes les dates', 'كل التواريخ'), week: t('7 derniers jours', 'آخر 7 أيام'), month: t('30 derniers jours', 'آخر 30 يوما'), sort: t('Trier cette page', 'ترتيب هذه الصفحة'), recentFirst: t('Plus récents', 'الأحدث أولا'), nameFirst: t('Nom A–Z', 'حسب الاسم'), oldestFirst: t('Plus anciens', 'الأقدم أولا'), pageFilters: t('Affichage de la page courante', 'عرض الصفحة الحالية'), moreFilters: t('Langue, période et tri', 'اللغة والفترة والترتيب'), localScope: t('Langue, période et tri s’appliquent aux lignes de la page reçue. La recherche et les filtres d’état portent sur tous les parcours.', 'تُطبّق اللغة والفترة والترتيب على سطور الصفحة المتاحة. يشمل البحث وتصفية الحالة كل المسارات.'), tableCaption: t('Participations — informations réservées à l’administration', 'المشاركات — معلومات مخصصة للإدارة'), identity: t('Participant', 'المشارك'), progress: t('Progression', 'التقدم'), report: t('Rapport', 'التقرير'), created: t('Inscription', 'التسجيل'), actions: t('Actions', 'الإجراءات'), openReport: t('Ouvrir la fiche', 'فتح الملف'), selectAll: t('Sélectionner les lignes affichées', 'تحديد السطور المعروضة'), select: t('Sélectionner', 'تحديد'), selected: t('lignes sélectionnées sur cette page', 'سطور محددة في هذه الصفحة'), export: t('Exporter la sélection', 'تصدير المحدد'), exportTitle: t('Exporter ces participations ?', 'تصدير هذه المشاركات؟'), exportBody: t('Le fichier CSV contient les noms, e-mails et états des lignes sélectionnées sur cette page. Réservez-le au suivi pédagogique autorisé.', 'يتضمن ملف CSV الأسماء والبريد والحالة للسطور المحددة في هذه الصفحة. يُستخدم للمتابعة التربوية المصرح بها فقط.'), download: t('Télécharger le CSV', 'تنزيل CSV'), cancel: t('Annuler', 'إلغاء'), exported: t('Le fichier CSV a été préparé.', 'تم إعداد ملف CSV.'), emptyTitle: t('Aucune participation trouvée', 'لم يتم العثور على مشاركة'), emptyBody: t('Modifiez les filtres ou attendez le début d’un premier parcours.', 'عدّل التصفية أو انتظر بداية أول مسار.'), reset: t('Réinitialiser les filtres', 'إعادة ضبط التصفية'), previous: t('Précédent', 'السابق'), next: t('Suivant', 'التالي'), page: t('Page', 'صفحة'), of: t('sur', 'من'), shown: t('lignes affichées', 'سطور معروضة'), total: t('participations au total', 'إجمالي المشاركات'),
    back: t('Retour aux participants', 'العودة إلى المشاركين'), missingTitle: t('Parcours indisponible', 'المسار غير متاح'), missingBody: t('Le parcours a peut-être été supprimé ou son accès a expiré.', 'ربما حُذف المسار أو انتهى الوصول إليه.'), print: t('Imprimer / Enregistrer en PDF', 'طباعة / حفظ PDF'), answers: t('Questions et réponses', 'الأسئلة والإجابات'), personalReport: t('Rapport personnel', 'التقرير الشخصي'), savedAnswers: t('réponses sauvegardées', 'إجابات محفوظة'), started: t('Début du parcours', 'بداية المسار'), last: t('Dernière activité', 'آخر نشاط'), expires: t('Fin d’accès du participant', 'نهاية وصول المشارك'), startLanguage: t('Langue au démarrage', 'لغة البداية'), declaredEmail: t('Adresse e-mail déclarée', 'البريد الإلكتروني المصرح به'), legacyEmail: t('Non renseignée : ancien parcours. Le nom peut être un pseudonyme.', 'غير مسجل: مسار قديم. قد يكون الاسم مستعارا.'), participationId: t('Identifiant de participation', 'معرّف المشاركة'), private: t('Confidentiel · Informations réservées au suivi pédagogique par l’administration autorisée.', 'سري · معلومات مخصصة للمتابعة التربوية من طرف الإدارة المخولة.'), reportTitle: t('Rapport de soft skills', 'تقرير المهارات الشخصية'), aiSummary: t('Synthèse générée par IA', 'خلاصة مولدة بالذكاء الاصطناعي'), ruleSummary: t('Synthèse automatique', 'خلاصة تلقائية'), awaitAI: t('Le bilan complet est disponible. La synthèse IA sera ajoutée lorsque le service sera disponible.', 'التقرير الكامل متاح. ستُضاف خلاصة IA عند توفر الخدمة.'), noAI: t('Cette synthèse automatique repose sur les réponses enregistrées. Aucune synthèse IA n’est disponible dans cette langue actuellement.', 'تستند هذه الخلاصة التلقائية إلى الإجابات المحفوظة. لا توجد خلاصة IA بهذه اللغة حاليا.'), legacyAnswers: t('Les anciennes réponses libres sont conservées dans leur langue d’origine.', 'تُحفظ الإجابات الحرة القديمة بلغتها الأصلية.'), reportWaiting: t('Le test est encore en cours', 'الاختبار لا يزال جاريا'), reportWaitingBody: t('Le bilan sera disponible après les 31 réponses. Les réponses déjà enregistrées restent consultables.', 'سيصبح التقرير متاحا بعد الإجابات الـ31. يمكنك الاطلاع على الإجابات المحفوظة حاليا.'), question: t('Situation', 'الموقف'), choice: t('Choix enregistré', 'الاختيار المحفوظ'), rationale: t('Lecture de cette observation', 'قراءة هذه الملاحظة'), advice: t('Une action pour progresser', 'خطوة عملية للتقدم'), reference: t('Repère', 'مؤشر'), notObserved: t('Non observé', 'لم يُلاحظ'), noAnswers: t('Aucune réponse enregistrée pour le moment.', 'لم تُحفظ أي إجابة بعد.'), expandAll: t('Déplier les compétences', 'فتح المهارات'), collapseAll: t('Replier les compétences', 'طي المهارات'), families: t('Familles de compétences', 'مجموعات المهارات'), other: t('Autres observations', 'ملاحظات أخرى'), familyCount: t('compétences explorées', 'مهارات مستكشفة'),
};
export type AdminLanguage = 'fr' | 'ar';
export function adminDate(value: string, lang: AdminLanguage, withTime = false) { return new Date(value).toLocaleString(lang === 'ar' ? 'ar-MA' : 'fr-FR', { timeZone: 'Africa/Casablanca', dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' as const } : {}) }); }
```

## frontend/src/app/admin.css

```css
/* Shared identity from the public homepage; administration adds semantic roles only. */
@media screen {
.ad-root{--ad-ground:var(--hq-blue-50);--ad-surface:#fff;--ad-ink:var(--hq-ink);--ad-muted:var(--hq-muted);--ad-nav:var(--hq-blue-800);--ad-rule:#e1e9eb;--ad-control:#b2c6ce;--ad-positive:var(--hq-green-800);--ad-positive-bg:var(--hq-green-50);--ad-info:var(--hq-blue-700);--ad-info-bg:var(--hq-blue-50);--ad-warning:#785017;--ad-warning-bg:#fbf3e2;--ad-error:#913a3e;--ad-error-bg:#fbefef;--ad-gap:24px;--ad-radius:var(--hq-radius-md);--ad-control-radius:var(--hq-radius-sm);color:var(--ad-ink);background:var(--ad-ground);font:14px/1.6 'Plus Jakarta Sans',sans-serif;min-height:100dvh}

[dir=rtl] .ad-root{font-family:'Tajawal',sans-serif}

.ad-root h1,.ad-root h2,.ad-root h3,.ad-stat dd{font-family:'Outfit','Plus Jakarta Sans',sans-serif}

[dir=rtl] .ad-root h1,[dir=rtl] .ad-root h2,[dir=rtl] .ad-root h3,[dir=rtl] .ad-stat dd{font-family:'Tajawal',sans-serif;letter-spacing:0}

.ad-root h1{font-size:28px;line-height:1.25;letter-spacing:-.02em;font-weight:600;margin:0}

.ad-root h2{font-size:18px;line-height:1.4;font-weight:500;margin:0}

.ad-root h3{font-size:16px;line-height:1.5;font-weight:500;margin:0}

.ad-root p{margin:0}
.ad-root ul,.ad-root ol{list-style:none;margin:0;padding:0}
.ad-root dl,.ad-root dd{margin:0}

.ad-root a,.ad-root button,.ad-root input,.ad-root select,.ad-root summary{transition:background-color .2s,color .2s,border-color .2s;scroll-margin-block:100px}

.ad-root :focus-visible{outline:3px solid var(--hq-blue-400);outline-offset:3px}
.ad-root .admin-content:focus{outline:none}
.ad-root input,.ad-root select{min-height:44px;max-width:100%;font-family:inherit;color:var(--ad-ink)}

.ad-root button:disabled{cursor:not-allowed;color:var(--ad-muted);background:var(--ad-ground);border-color:var(--ad-rule)}
.ad-root input::placeholder{color:var(--ad-muted)}
.ad-root input[type=checkbox]{min-height:18px;width:18px;height:18px;accent-color:var(--ad-nav)}

.ad-muted,.ad-caption{color:var(--ad-muted)}
.ad-caption{font-size:12px;line-height:1.7;margin-block-start:16px!important}
.ad-tabular,.ad-stat dd,.ad-ai-counters dd,.ad-number{font-variant-numeric:tabular-nums}

.ad-shell{min-height:100dvh}
.ad-sidebar{position:fixed;inset-block:0;inset-inline-start:0;width:248px;background:var(--ad-nav);color:var(--hq-blue-100);z-index:40}

.ad-sidebar-inner{height:100%;display:flex;flex-direction:column;padding:24px 16px;gap:24px}

.ad-logo-surface{background:#fff;border-radius:8px;padding:8px 16px;display:block;margin-inline:8px}
.ad-logo-surface .brand-logo{width:160px;max-width:100%;margin-inline:auto}

.ad-workspace{font-size:12px;display:flex;gap:8px;align-items:flex-start;padding-inline:12px;line-height:1.7}
.ad-workspace svg{flex-shrink:0;margin-block-start:3px}

.ad-nav-group{font-size:12px;color:var(--hq-blue-200);padding:0 12px 12px}

.ad-sidebar nav a,.ad-navigation-drawer nav a{display:flex;align-items:center;gap:12px;min-height:48px;padding:12px;border-radius:8px;color:var(--hq-blue-100);margin-block:4px}
.ad-sidebar nav a:hover,.ad-navigation-drawer nav a:hover{background:var(--hq-blue-700);color:#fff}
.ad-sidebar nav a[aria-current],.ad-navigation-drawer nav a[aria-current]{background:var(--hq-blue-50);color:var(--ad-nav);font-weight:600}

.ad-sidebar-foot{margin-block-start:auto;display:grid;gap:24px}
.ad-site-link{display:flex;gap:12px;align-items:center;justify-content:space-between;min-height:44px;padding-inline:12px;font-size:12px}
.ad-site-link:hover{color:#fff}
.ad-user{display:flex;align-items:center;gap:8px;border-block-start:1px solid var(--hq-blue-600);padding-block-start:24px}
.ad-user>div{min-width:0;flex:1}
.ad-user p{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ad-user div>span{font-size:11px;color:var(--hq-blue-200)}
.ad-user button{display:grid;place-items:center;width:44px;height:44px;flex-shrink:0;border-radius:8px}
.ad-user button:hover{background:var(--hq-blue-700)}

.ad-avatar{display:inline-grid;place-items:center;width:32px;height:32px;flex-shrink:0;border-radius:50%;background:var(--hq-blue-100);color:var(--ad-nav);font-size:12px;font-weight:600}

.ad-workarea{margin-inline-start:248px;min-width:0}
.ad-topbar{position:sticky;inset-block-start:0;z-index:30;min-height:80px;display:flex;align-items:center;gap:24px;padding-inline:32px;background:var(--ad-ground)}

.ad-breadcrumbs{flex:1;min-width:0}
.ad-breadcrumbs ol{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.ad-breadcrumbs li{display:flex;gap:8px;align-items:center;font-size:12px}
.ad-breadcrumbs a{color:var(--ad-muted);display:inline-flex;align-items:center;min-height:44px}
.ad-breadcrumbs span[aria-current]{font-weight:600}
.ad-topbar-tools{display:flex;align-items:center;gap:16px}
.ad-topbar .sq-language button{font-size:13px}

.ad-global-search{display:flex;align-items:center;gap:8px;border:1px solid var(--ad-control);border-radius:8px;background:#fff;padding-inline:12px;width:clamp(240px,25vw,360px);max-width:100%}
.ad-global-search input{width:100%;min-width:0;background:transparent;outline-offset:0;border:0;font-size:12px}
.ad-global-search button{width:44px;height:44px;display:grid;place-items:center;flex-shrink:0}
.ad-global-search>svg{color:var(--ad-muted);flex-shrink:0}

.ad-icon-button{width:44px;height:44px;display:inline-grid;place-items:center;border:1px solid var(--ad-control);border-radius:8px;flex-shrink:0}
.ad-mobile-menu{display:none}
.ad-profile{position:relative}
.ad-profile summary{display:grid;place-items:center;width:44px;height:44px;list-style:none;border:1px solid var(--ad-control);border-radius:50%}
.ad-profile summary::-webkit-details-marker{display:none}
.ad-profile[open] summary{background:var(--hq-blue-100)}
.ad-profile-menu{position:absolute;inset-inline-end:0;inset-block-start:56px;width:280px;max-width:calc(100vw - 40px);padding:24px;background:#fff;border:1px solid var(--ad-rule);border-radius:8px;box-shadow:0 8px 24px #01275414;display:grid;gap:16px}
.ad-profile-menu p{color:var(--ad-muted);font-size:12px;overflow-wrap:anywhere}
.ad-profile-menu a,.ad-profile-menu button{min-height:44px;display:flex;align-items:center;gap:8px;text-align:start}
.ad-profile-menu button{color:var(--ad-error)}

.ad-root .admin-content.ad-content{width:calc(100% - 16px);max-width:1440px;min-height:calc(100dvh - 88px);margin:0 auto 8px;padding:32px;border:1px solid var(--ad-rule);border-radius:16px;background:#fff}

/* At 1440: 248px navigation + 16px sheet inset + 64px content padding = 1112px working width. */
.ad-page-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-block-end:32px}
.ad-page-header>div:first-child{min-width:0}
.ad-page-header h1{overflow-wrap:anywhere}
.ad-page-header p{color:var(--ad-muted);margin-block-start:8px;max-width:65ch}
.ad-page-actions,.ad-page-actions>div{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.ad-page-actions{flex-shrink:0}
.ad-back-link{display:inline-flex;align-items:center;gap:8px;min-height:44px;font-size:12px;color:var(--ad-muted);margin-block-end:16px}
.ad-back-link:hover{color:var(--ad-nav)}

.ad-button{display:inline-flex;gap:8px;align-items:center;justify-content:center;min-height:44px;padding:10px 16px;font-family:inherit;font-size:12px;font-weight:600;line-height:1.5;border-radius:var(--ad-control-radius);border:1px solid var(--ad-control);color:var(--ad-ink);background:#fff;text-decoration:none}
.ad-button-primary{background:var(--hq-green-700);border-color:var(--hq-green-700);color:#fff}
.ad-button-primary:hover{background:var(--hq-green-800);border-color:var(--hq-green-800)}
.ad-button-secondary:hover{background:var(--hq-blue-50)}
.ad-button-ghost{background:transparent;border-color:transparent}
.ad-button-ghost:hover{background:var(--hq-blue-50)}
.ad-button-danger{color:var(--ad-error);border-color:var(--ad-error)}
.ad-button-danger:hover{background:var(--ad-error-bg)}
.ad-button:active:not(:disabled){filter:brightness(.95)}

.ad-field{display:grid;gap:8px;min-width:0}
.ad-field>label{font-size:12px;font-weight:600;color:var(--ad-ink)}
.ad-field>input,.ad-field>select,.ad-password,.ad-search-field{width:100%;border:1px solid var(--ad-control);border-radius:8px;background:#fff}
.ad-field>input,.ad-field>select{padding:10px 12px;font-size:14px}
.ad-password{display:flex;align-items:center}
.ad-password input{border:0;background:transparent;width:100%;min-width:0;padding-inline:12px}
.ad-password button{width:48px;min-height:48px;display:grid;place-items:center;flex-shrink:0;color:var(--ad-muted)}
.ad-search-field{display:flex;align-items:center;gap:8px;padding-inline:12px}
.ad-search-field svg{flex-shrink:0;color:var(--ad-muted)}
.ad-search-field input{width:100%;min-width:0;background:transparent;padding:10px 0;border:0;font-size:14px}

.ad-login{display:grid;grid-template-columns:minmax(320px,.95fr) 1.05fr;min-height:100dvh}
.ad-login-brand{background:var(--ad-nav);color:#fff;position:relative;isolation:isolate;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;padding:48px 64px;gap:64px}
.ad-login-logo{display:block;width:200px;padding:12px 20px;background:#fff;border-radius:8px}
.ad-login-logo .brand-logo{width:100%}
.ad-login-brand h2{font-size:clamp(28px,3.1vw,44px);line-height:1.25;letter-spacing:-.025em;max-width:18ch;margin-block:24px}
.ad-login-brand>div>p{max-width:42ch;color:var(--hq-blue-100);font-size:16px;line-height:1.8}
.ad-login-brand .hq-arcs{width:640px;height:640px;inset-block-start:24%;inset-inline-start:18%;stroke:var(--hq-blue-400);opacity:.18}
.ad-login-signature{font-size:12px;color:var(--hq-blue-100)}
.ad-login-work{display:flex;flex-direction:column;padding:32px 48px;background:var(--hq-paper)}
.ad-login-top{display:flex;justify-content:space-between;align-items:center;gap:24px;font-size:12px}
.ad-login-top a{display:inline-flex;align-items:center;min-height:44px}
.ad-login-form{width:min(100%,400px);margin:auto;padding-block:64px}
.ad-login-form h1{font-size:32px}
.ad-lead{color:var(--ad-muted);margin-block:16px 32px!important;font-size:14px;line-height:1.8}
.ad-login-form form{display:grid;gap:24px}
.ad-login-form form>.ad-button{margin-block-start:8px;min-height:48px;font-size:14px}
.ad-login-notice{display:flex;align-items:center;gap:8px;margin-block-start:32px!important;font-size:12px;color:var(--ad-muted)}

.ad-alert{display:flex;align-items:flex-start;flex-wrap:wrap;gap:16px;padding:24px;border-radius:8px;margin-block-end:24px}
.ad-alert-error{background:var(--ad-error-bg);color:var(--ad-error)}
.ad-alert svg{flex-shrink:0}
.ad-alert p{flex:1;min-width:160px}
.ad-auth-loading{max-width:900px;padding:64px 24px;margin:auto}
.ad-skeleton{padding:24px;border:1px solid var(--ad-rule);border-radius:16px}
.ad-skeleton-title{width:35%;height:24px;background:var(--hq-blue-100);margin-block-end:24px}
.ad-skeleton-row{display:grid;grid-template-columns:2fr 1fr 1fr;gap:24px;padding-block:20px;border-block-end:1px solid var(--ad-rule)}
.ad-skeleton-row span{height:16px;background:var(--hq-blue-50);border-radius:4px}
.ad-skeleton-row:last-child{border:0}
.ad-empty{padding:24px;text-align:center;display:grid;justify-items:center;gap:12px}
.ad-empty svg{width:80px;height:40px;stroke:var(--hq-blue-300);stroke-width:1.3}
.ad-empty h3{font-size:14px;max-width:50ch}
.ad-empty p{color:var(--ad-muted);font-size:12px;max-width:45ch}
.ad-empty .ad-button{margin-block-start:8px}

.ad-stats{display:grid;grid-template-columns:1.2fr 1fr 1fr 1.2fr;padding:24px 0;margin-block-end:24px!important;border-block:1px solid var(--ad-rule)}
.ad-stat{padding-inline:24px;border-inline-start:1px solid var(--ad-rule)}
.ad-stat:first-child{border:0;padding-inline-start:0}
.ad-stat:last-child{padding-inline-end:0}
.ad-stat dt{font-size:12px;color:var(--ad-muted);min-height:38px}
.ad-stat dd{font-size:28px;line-height:1.3;margin-block:8px;letter-spacing:-.025em;min-height:40px;overflow-wrap:anywhere}
.ad-stat-lead dd{font-size:36px;color:var(--ad-nav)}
.ad-stat:last-child dd{font-size:20px;letter-spacing:0}
.ad-stat p{font-size:11px;color:var(--ad-muted)}
.ad-dashboard-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(280px,1fr);gap:24px;align-items:start}
.ad-panel{min-width:0;border:1px solid var(--ad-rule);border-radius:16px;padding:24px;background:#fff}
.ad-panel-heading{display:flex;gap:16px;align-items:center;justify-content:space-between;margin-block-end:16px}
.ad-panel-heading h2{font-size:16px}
.ad-panel-heading>a{display:flex;gap:8px;align-items:center;font-size:12px;min-height:44px;white-space:nowrap}
.ad-panel-heading>span{font-size:11px;color:var(--ad-muted)}
.ad-chart svg{width:100%;height:auto;display:block;direction:ltr}
.ad-chart text{font-family:inherit;font-size:12px;fill:var(--ad-muted)}
.ad-chart-grid{stroke:var(--ad-rule);stroke-width:1}
.ad-chart-series{fill:none;stroke:var(--hq-green-700);stroke-width:2;stroke-linejoin:round}
.ad-recent-list li+li{border-block-start:1px solid var(--ad-rule)}
.ad-recent-list a{display:flex;align-items:center;gap:12px;min-height:64px;padding-block:12px}
.ad-recent-list a:hover{color:var(--hq-blue-600)}
.ad-recent-identity{min-width:0;flex:1;display:grid;gap:4px}
.ad-recent-identity strong{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ad-recent-identity>span{font-size:11px;color:var(--ad-muted)}
.ad-indicator-list{display:grid;gap:16px}
.ad-indicator-list li{display:flex;gap:16px;justify-content:space-between;align-items:center}
.ad-indicator-list li>div{text-align:end;display:grid;gap:4px;flex-shrink:0}
.ad-indicator-value{font-variant-numeric:tabular-nums;font-size:16px}
.ad-indicator-value small{font-size:12px;margin-inline-start:4px;color:var(--ad-muted)}
.ad-indicator-list li .ad-muted{font-size:11px}
.ad-shortcut-links{margin-block:16px}
.ad-shortcut-links a{display:flex;align-items:center;gap:12px;min-height:48px;font-size:13px}
.ad-shortcut-links a>svg:last-child{margin-inline-start:auto}
.ad-shortcut-links a:hover{color:var(--hq-green-700)}
.ad-ai-counters{display:grid;gap:16px;padding-block-start:16px;border-block-start:1px solid var(--ad-rule)}
.ad-ai-counters>div{display:flex;align-items:center;justify-content:space-between;gap:16px}
.ad-ai-counters dt{font-size:12px}
.ad-ai-counters dd{font-size:18px}
.ad-freshness{font-size:11px;color:var(--ad-muted);margin-block-start:24px!important}

.ad-filter-bar{border:1px solid var(--ad-rule);border-radius:16px;padding:24px;margin-block-end:24px}
.ad-filters-main{display:grid;grid-template-columns:minmax(220px,1.5fr) 1fr 1fr;gap:16px}
.ad-local-filters{margin-block-start:16px}
.ad-local-filters>summary{min-height:44px;display:flex;align-items:center;font-size:12px;font-weight:600;text-decoration:underline;text-underline-offset:4px}
.ad-filters-secondary{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding-block-start:16px}
.ad-list-panel{border:1px solid var(--ad-rule);border-radius:16px;overflow:hidden}
.ad-list-summary{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding:20px 24px;border-block-end:1px solid var(--ad-rule);font-size:12px}
.ad-list-summary strong{font-weight:600}
.ad-list-summary span{color:var(--ad-muted)}
.ad-table-scroll{overflow:auto}
.ad-data-table{border-collapse:collapse;width:100%;font-size:13px}
.ad-data-table th,.ad-data-table td{padding:16px 12px;text-align:start;font-weight:400;vertical-align:middle}
.ad-data-table thead th{font-size:12px;color:var(--ad-muted);white-space:nowrap}
.ad-data-table th.ad-select-column,.ad-data-table td.ad-select-column{padding-inline-start:20px;padding-inline-end:0;width:44px}
.ad-data-table thead input{margin-inline:12px}
.ad-check-target{width:44px;height:44px;display:grid;place-items:center}
.ad-data-table tbody tr{border-block-start:1px solid var(--ad-rule)}
.ad-data-table tbody tr:hover{background:var(--hq-blue-50)}
.ad-data-table tbody tr[aria-selected=true]{background:var(--hq-blue-50)}
.ad-data-table .ad-number{text-align:end;min-width:112px}
.ad-number strong{font-weight:500}
.ad-participant-identity{width:36%}
.ad-participant-identity>a{display:flex;align-items:center;gap:12px;min-height:44px}
.ad-participant-identity>a>span:last-child{display:grid;min-width:0;gap:4px}
.ad-participant-identity strong{font-weight:600;overflow-wrap:anywhere}
.ad-email{font-size:11px;color:var(--ad-muted);overflow-wrap:anywhere;text-align:start}
.ad-cell-sub{display:block;color:var(--ad-muted);font-size:11px;margin-block-start:4px}
.ad-mobile-meta{display:none}
.ad-badge{display:inline-flex;align-items:center;min-height:24px;padding:3px 8px;font-size:11px;line-height:1.5;border-radius:4px;max-width:100%;white-space:nowrap}
.ad-badge-neutral{background:var(--hq-blue-50);color:var(--ad-muted)}
.ad-badge-info{background:var(--ad-info-bg);color:var(--ad-info)}
.ad-badge-success{background:var(--ad-positive-bg);color:var(--ad-positive)}
.ad-badge-warning{background:var(--ad-warning-bg);color:var(--ad-warning)}
.ad-badge-error{background:var(--ad-error-bg);color:var(--ad-error)}
.ad-row-action>a{display:grid;place-items:center;width:44px;height:44px;border-radius:8px}
.ad-row-action>a:hover{background:var(--hq-blue-100)}
.ad-pagination{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 24px;border-block-start:1px solid var(--ad-rule);color:var(--ad-muted);font-size:12px}
.ad-pagination>div{display:flex;gap:8px}

.ad-confirm{width:min(460px,calc(100% - 40px));padding:32px;border:1px solid var(--ad-rule);border-radius:16px;background:#fff;color:var(--ad-ink);margin:auto;box-shadow:0 16px 40px #0127541a}
.ad-confirm::backdrop{background:#09223b66}
.ad-confirm h2{font-size:22px}
.ad-confirm p{margin-block:16px 24px;line-height:1.8;color:var(--ad-muted)}
.ad-dialog-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}
.ad-toast{position:fixed;inset-block-end:24px;inset-inline-end:24px;z-index:80;max-width:calc(100vw - 48px);background:var(--hq-green-50);color:var(--hq-green-900);border:1px solid var(--hq-green-200);padding:16px 24px;border-radius:8px;box-shadow:0 8px 24px #01275414;font-size:13px}

.ad-participant-status{display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin-block:-8px 24px;font-size:12px;color:var(--ad-muted)}
.ad-participant-info{border:1px solid var(--ad-rule);border-radius:16px;padding:24px}
.ad-participant-info dl{display:grid;grid-template-columns:repeat(4,1fr);gap:24px}
.ad-participant-info dt{font-size:11px;color:var(--ad-muted);margin-block-end:8px}
.ad-participant-info dd{font-size:13px;overflow-wrap:anywhere}
.ad-info-email,.ad-info-id{grid-column:span 2}
.ad-info-id dd{font-size:11px}
.ad-privacy{display:flex;gap:8px;align-items:flex-start;color:var(--ad-muted);font-size:12px;margin-block:24px!important;max-width:85ch}
.ad-privacy svg{flex-shrink:0;margin-block-start:3px}
.ad-detail-tabs{display:flex;gap:24px;border-block-end:1px solid var(--ad-rule);margin-block:24px}
.ad-detail-tabs button{min-height:48px;display:flex;gap:8px;align-items:center;padding-block:12px;border-block-end:2px solid transparent;color:var(--ad-muted);font-size:13px}
.ad-detail-tabs button[aria-pressed=true]{color:var(--ad-nav);border-color:var(--ad-nav);font-weight:600}

.ad-report-summary{border:1px solid var(--ad-rule);padding:32px;border-radius:16px;max-width:100%}
.ad-summary-heading{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-block-end:24px}
.ad-summary-heading .brand-logo{width:144px}
.ad-summary-source{font-size:12px;color:var(--ad-info)}
.ad-report-summary h2{font-size:24px;margin-block-end:24px}
.ad-report-prose{white-space:pre-wrap;max-width:80ch;line-height:1.9;font-size:15px}
.ad-notice{font-size:12px;color:var(--ad-warning);background:var(--ad-warning-bg);padding:16px;border-radius:8px;margin-block-start:24px!important}
.ad-disclaimer{font-size:12px;color:var(--ad-muted);padding-block-start:24px;margin-block-start:24px!important;border-block-start:1px solid var(--ad-rule);max-width:90ch}
.ad-report-tools{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-block:24px}
.ad-report-tools nav{display:flex;gap:8px;flex-wrap:wrap}
.ad-report-tools a{display:flex;gap:8px;min-height:44px;align-items:center;padding-inline:8px;font-size:13px;border-radius:8px}
.ad-report-tools a:hover{background:var(--hq-blue-50)}
.ad-report-tools a>span{color:var(--ad-muted);font-size:11px}
.ad-report-tools>div{display:flex;gap:8px}
.ad-report-family{margin-block:32px;scroll-margin-block-start:104px}
.ad-family-heading{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-block-end:16px}
.ad-family-heading h2{font-size:22px}
.ad-family-heading span{font-size:12px;color:var(--ad-muted)}
.ad-skill-list{border:1px solid var(--ad-rule);border-radius:16px;overflow:hidden}
.ad-skill+.ad-skill{border-block-start:1px solid var(--ad-rule)}
.ad-skill summary{display:flex;align-items:center;gap:24px;min-height:72px;padding:20px 24px;list-style:none}
.ad-skill summary::-webkit-details-marker{display:none}
.ad-skill summary h3{flex:1;min-width:0;font-size:16px}
.ad-skill summary svg{flex-shrink:0;transition:transform .2s;color:var(--ad-muted)}
.ad-skill details[open] summary svg{transform:rotate(180deg)}
.ad-skill summary:hover{background:var(--hq-blue-50)}
.ad-skill-reference{color:var(--ad-muted);font-size:12px;white-space:nowrap}
.ad-skill-body{display:grid;grid-template-columns:1fr 1fr;gap:32px;padding:8px 24px 24px}
.ad-skill-body h4{font-size:12px;font-weight:600;margin-block:16px 8px}
.ad-skill-body p{font-size:14px;line-height:1.9;white-space:pre-wrap;max-width:65ch}
.ad-skill-body>div+div{padding-inline-start:24px;border-inline-start:1px solid var(--ad-rule)}
.ad-answers{display:grid;gap:24px}
.ad-answer{border:1px solid var(--ad-rule);border-radius:16px;padding:24px}
.ad-answer h2{font-size:14px;margin-block-end:16px;color:var(--ad-muted)}
.ad-answer>p{font-weight:600;max-width:80ch;white-space:pre-wrap;line-height:1.8}
.ad-answer>div{background:var(--hq-blue-50);padding:16px 24px;border-radius:8px;margin-block-start:24px}
.ad-answer h3{font-size:12px;margin-block-end:8px}
.ad-answer div p{white-space:pre-wrap;line-height:1.8}

.ad-navigation-drawer.admin-drawer{color:var(--hq-blue-100);background:var(--ad-nav);width:min(320px,90vw);padding:0}
.ad-navigation-drawer::backdrop{background:#09223b66;backdrop-filter:none}
.ad-drawer-close{position:absolute;inset-inline-end:8px;inset-block-start:8px;color:#fff;border:0;background:var(--ad-nav);z-index:1}
.ad-navigation-drawer .ad-sidebar-inner{padding-block-start:64px}
.ad-navigation-drawer[open]{animation:ad-drawer-in .2s ease-out}
.ad-spin{animation:ad-spin 1s linear infinite}
@keyframes ad-spin{to{transform:rotate(360deg)}
}
@keyframes ad-drawer-in{from{opacity:.7;transform:translateY(8px)}
to{opacity:1;transform:translateY(0)}
}

[dir=rtl] .ad-direction{transform:scaleX(-1)}

}

@media screen and (max-width:1250px){.ad-topbar{gap:16px;padding-inline:24px}
.ad-global-search{width:240px}
.ad-root .admin-content.ad-content{padding:24px}
.ad-dashboard-grid{grid-template-columns:minmax(0,1.25fr) minmax(260px,1fr)}
.ad-stat{padding-inline:16px}
.ad-stats{grid-template-columns:repeat(4,1fr)}
.ad-filters-main{grid-template-columns:1.3fr 1fr 1fr}
.ad-topbar-tools{gap:8px}
.ad-breadcrumbs li:first-child{display:none}
}

@media screen and (max-width:1099px){.ad-sidebar{display:none}
.ad-workarea{margin-inline-start:0}
.ad-mobile-menu{display:inline-grid}
.ad-root .admin-content.ad-content{min-height:calc(100dvh - 88px)}
.ad-global-search{margin-inline-start:auto;width:min(36vw,320px)}
.ad-dashboard-grid{grid-template-columns:minmax(0,1.4fr) minmax(260px,1fr)}
.ad-page-header{margin-block-end:24px}
.ad-report-tools{align-items:flex-start}
.ad-filters-main{grid-template-columns:1fr 1fr}
.ad-filters-main>.ad-field:first-child{grid-column:1/-1}
.ad-topbar .ad-breadcrumbs li:first-child{display:flex}
.ad-topbar .ad-breadcrumbs li:nth-child(2) svg{display:none}
.ad-created-cell{display:none}
.ad-mobile-meta{display:block;color:var(--ad-muted);font-size:11px}
.ad-data-table thead th:nth-child(5){display:none}
.ad-table-scroll{max-width:100%}
}

@media screen and (max-width:767px){.ad-topbar{min-height:64px;padding-inline:16px;gap:12px}
.ad-topbar .ad-breadcrumbs li:first-child{display:none}
.ad-breadcrumbs li{font-size:11px}
.ad-topbar-tools{gap:8px;margin-inline-start:auto}
.ad-global-search{display:none}
.ad-root .admin-content.ad-content{border-radius:0;width:100%;border:0;margin:0;padding:24px 20px;min-height:calc(100dvh - 64px)}
.ad-root h1{font-size:24px}
.ad-page-header{gap:16px;flex-wrap:wrap}
.ad-page-header p{font-size:13px}
.ad-page-actions{flex-shrink:1}
.ad-page-actions .ad-button{font-size:12px}
.ad-stats{grid-template-columns:1fr 1fr;gap:24px;padding-block:24px}
.ad-stat,.ad-stat:first-child,.ad-stat:last-child{padding-inline:0 16px;border:0}
.ad-stat:nth-child(even){padding-inline:16px 0;border-inline-start:1px solid var(--ad-rule)}
.ad-stat dt{min-height:0}
.ad-stat dd{font-size:26px}
.ad-stat-lead dd{font-size:34px}
.ad-stat:last-child dd{font-size:18px}
.ad-stat p{font-size:11px}
.ad-dashboard-grid{grid-template-columns:1fr;gap:16px}
.ad-panel{padding:20px;border-radius:8px}
.ad-activity{grid-row:3}
.ad-shortcuts{grid-row:2}
.ad-evolution .ad-panel-heading{gap:12px;align-items:flex-start}
.ad-panel-heading h2{font-size:16px}
.ad-panel-heading>span{font-size:11px;white-space:nowrap}
.ad-chart svg{min-height:160px}
.ad-caption{font-size:12px}
.ad-indicators{grid-row:4}
.ad-filters-main{grid-template-columns:1fr 1fr;gap:12px}
.ad-filter-bar{padding:16px;border-radius:8px;margin-block-end:16px}
.ad-field>label{font-size:11px}
.ad-field>select{font-size:12px;padding-inline:8px}
.ad-field>input{font-size:16px}
.ad-search-field input{font-size:16px}
.ad-filters-secondary{grid-template-columns:1fr;gap:16px}
.ad-list-panel{border-radius:8px}
.ad-list-summary{padding:16px;gap:8px;font-size:11px}
.ad-list-summary p{display:flex;gap:4px;flex-wrap:wrap}
.ad-pagination{padding:16px;flex-wrap:wrap}
.ad-pagination .ad-button{padding-inline:12px}
.ad-data-table{display:block}
.ad-data-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
.ad-data-table tbody{display:block}
.ad-data-table tbody tr{display:grid;grid-template-columns:44px minmax(0,1fr) 44px;gap:8px 0;padding:12px 8px}
.ad-data-table th,.ad-data-table td{padding:0;border:0}
.ad-data-table td.ad-select-column{grid-column:1;grid-row:1;padding:0;width:44px}
.ad-participant-identity{grid-column:2;grid-row:1;width:auto}
.ad-participant-identity .ad-avatar{display:none}
.ad-participant-identity strong{font-size:14px}
.ad-email{font-size:12px}
.ad-row-action{grid-column:3;grid-row:1}
.ad-data-table .ad-number{grid-column:2;grid-row:2;text-align:start;display:flex;gap:8px;align-items:center}
.ad-number .ad-cell-sub{margin:0}
.ad-report-cell{grid-column:2/-1;grid-row:3}
.ad-data-table .ad-created-cell{display:none}
.ad-mobile-meta{font-size:11px}
.ad-badge{font-size:11px;white-space:normal}
.ad-participant-info{padding:20px;border-radius:8px}
.ad-participant-info dl{grid-template-columns:1fr 1fr;gap:24px 16px}
.ad-info-email,.ad-info-id{grid-column:1/-1}
.ad-participant-info dd{font-size:12px}
.ad-privacy{font-size:12px}
.ad-detail-tabs{gap:16px}
.ad-detail-tabs button{font-size:12px}
.ad-report-summary{padding:24px 20px;border-radius:8px}
.ad-summary-heading{flex-wrap:wrap;gap:16px}
.ad-report-summary h2{font-size:22px}
.ad-report-prose{font-size:15px}
.ad-report-tools{gap:8px}
.ad-report-tools>div{flex-wrap:wrap}
.ad-report-tools .ad-button{font-size:11px;padding-inline:8px}
.ad-report-tools nav{gap:4px}
.ad-report-tools a{font-size:12px;padding-inline:8px}
.ad-report-family{scroll-margin-block-start:88px}
.ad-family-heading{gap:16px}
.ad-family-heading h2{font-size:20px}
.ad-family-heading span{font-size:11px}
.ad-skill-list{border-radius:8px}
.ad-skill summary{padding:16px;gap:12px;flex-wrap:wrap}
.ad-skill summary h3{font-size:14px}
.ad-skill-reference{font-size:11px}
.ad-skill-body{grid-template-columns:1fr;gap:8px;padding:0 16px 24px}
.ad-skill-body>div+div{padding-inline-start:0;border:0}
.ad-answer{padding:20px}
.ad-answer>div{padding:16px}
.ad-login{grid-template-columns:1fr}
.ad-login-brand{padding:24px;gap:24px}
.ad-login-logo{width:150px;padding:8px 16px}
.ad-login-brand h2{font-size:24px;max-width:27ch;margin-block:16px}
.ad-login-brand>div>p{display:none}
.ad-login-brand>div>svg{display:none}
.ad-login-signature{display:none}
.ad-login-brand .hq-arcs{width:320px;height:320px;inset-block-start:-80px;inset-inline-start:45%}
.ad-login-work{padding:16px 24px 32px}
.ad-login-form{padding-block:32px}
.ad-login-form h1{font-size:26px}
.ad-login-top{font-size:12px}
.ad-login-form .ad-field>label{font-size:13px}
.ad-login-form input{font-size:16px}
.ad-confirm{padding:24px}
.ad-confirm h2{font-size:20px}
.ad-confirm p{font-size:14px}
.ad-dialog-actions .ad-button{flex:1}
}

@media screen and (prefers-reduced-motion:reduce){.ad-root *{animation:none!important;transition:none!important;scroll-behavior:auto!important}
}


@media screen{.ad-drawer-search{display:none}
.ad-navigation-drawer .ad-drawer-search{display:block}
.ad-drawer-search label{font-size:12px;display:block;margin-block-end:8px}
.ad-drawer-search>div{display:flex;border:1px solid var(--hq-blue-400);border-radius:8px;background:var(--hq-blue-700)}
.ad-drawer-search input{color:#fff;background:transparent;width:100%;min-width:0;padding-inline:12px}
.ad-drawer-search button{width:44px;height:44px;display:grid;place-items:center;flex-shrink:0}
.ad-dashboard>.ad-page-header{border-inline-end:3px solid var(--hq-green-200);padding-inline-end:16px}
}


@media screen{.ad-header-motif{width:64px;height:44px;stroke:var(--hq-green-300);stroke-width:1.25}
.ad-header-motif circle{fill:var(--hq-green-700);stroke:none}
.ad-data-table thead input{margin:0}
.ad-dashboard>.ad-page-header{border:0;padding-inline-end:0}
}

@media screen and (max-width:767px){.ad-header-motif{display:none}
}

/* Revue: isolate the old public-report rules, retain print styles unchanged. */
@media screen{
.ad-sidebar-inner,.ad-sidebar-foot,.ad-user{min-width:0;max-width:100%}
.ad-sidebar-foot{grid-template-columns:minmax(0,1fr)}
.ad-user>div{overflow:hidden}
.ad-user p{max-width:100%}
.ad-root [data-adaptive-skill].ad-skill{padding:0!important;border:0!important;border-radius:0!important}
.ad-root [data-adaptive-skill].ad-skill+.ad-skill{border-block-start:1px solid var(--ad-rule)!important}
.ad-root [data-adaptive-summary].ad-report-summary{padding:32px!important;border:1px solid var(--ad-rule)!important;border-radius:16px!important}
}
@media screen and (max-width:767px){
.ad-root [data-adaptive-summary].ad-report-summary{padding:24px 20px!important;border-radius:8px!important}
[data-adaptive-participants]>.ad-page-header p{display:none}
[data-adaptive-participants]>.ad-page-header{margin-block-end:16px}
.ad-filter-bar{padding:12px}
}
@media screen{
.ad-stat dt,.ad-button,.ad-field>label,.ad-panel-heading>a,.ad-site-link,.ad-workspace,.ad-nav-group,.ad-ai-counters dt,.ad-data-table thead th{font-size:13px}
.ad-stat p,.ad-recent-identity>span,.ad-email,.ad-cell-sub,.ad-indicator-list li .ad-muted,.ad-participant-info dt{font-size:12px}
.ad-chart table th,.ad-chart table td{text-align:end;font-variant-numeric:tabular-nums}
}
```
