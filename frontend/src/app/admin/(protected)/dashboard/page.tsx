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
