"use client";
import { PdfDownloadButton } from "@/components/pdf-download-button";
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText, ListChecks, RefreshCw, ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { adminContent as c, adminDate } from '@/lib/admin-content';
import type { AdaptiveParticipantDetail } from '@/lib/adaptive-admin-types';
import { AdminLoading, AdminError, AIStatus } from '@/components/admin/adaptive-ui';
import { AdminSummaryAction } from '@/components/admin/admin-summary-action';
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
    const [config, setConfig] = useState<{ aiReportAvailable?: boolean } | null>(null);
    useEffect(() => { fetch(`/api/adaptive/config?lang=${lang}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => setConfig(d)).catch(() => {}); }, [lang]);
    const aiStatus = data?.participant.aiStatus;
    useEffect(() => { if (!aiStatus || !['PENDING', 'PROCESSING', 'RETRY'].includes(aiStatus))
        return; let active = true; const timer = setInterval(() => { if (document.visibilityState !== 'visible')
        return; void fetch(`/api/admin/adaptive/participants/${id}?lang=${lang}`, { cache: 'no-store' }).then(async (res) => { if (res.ok) {
        const value = await res.json();
        if (active)
            setData(value);
    } }).catch(() => { }); }, 30000); return () => { active = false; clearInterval(timer); }; }, [id, lang, aiStatus]);
    const p = data?.participant, interview = data?.interview, report = interview?.report ?? data?.previousReport;
    const previousNotice = data?.previousReport && !interview?.report ? <p className="ad-privacy">{ar ? "التقرير السابق محفوظ حتى إكمال الاختبار الجديد." : "Rapport précédent conservé pendant le nouveau test. Il sera remplacé à la fin de celui-ci."}</p> : null;
    return <div data-admin-participant-detail><Link href="/admin/participants" className="ad-back-link print:hidden"><ArrowLeft size={16} className="ad-direction" aria-hidden="true"/>{c.back[lang]}</Link>{error ? <AdminError ar={ar} retry={() => setRefresh(v => v + 1)}/> : loading ? <AdminLoading ar={ar}/> : missing || !data || !p || !interview ? <EmptyState title={c.missingTitle[lang]} body={c.missingBody[lang]}/> : <><PageHeader title={p.displayName} description={`${p.answeredCount}/31 ${c.savedAnswers[lang]}`}><div className="print:hidden"><Button aria-label={c.refresh[lang]} onClick={() => setRefresh(v => v + 1)}><RefreshCw size={18} aria-hidden="true"/></Button>{report && tab === 'report' && <PdfDownloadButton url={`/api/admin/adaptive/participants/${p.id}/report.pdf?lang=${lang}`} lang={lang} label={c.print[lang]} className="ad-button ad-button-primary inline-flex items-center gap-2" />}</div></PageHeader><div className="ad-participant-status"><span>{(p.status === 'COMPLETED' ? c.finished : c.inProgress)[lang]}</span><AIStatus participant={p} ar={ar}/></div><section className="ad-participant-info print:hidden" aria-label={c.participant[lang]}><dl>{[{ label: c.startLanguage[lang], value: (p.language === 'ar' ? c.arabic : c.french)[lang] }, { label: c.started[lang], value: adminDate(p.createdAt, lang, true) }, { label: c.last[lang], value: adminDate(p.updatedAt, lang, true) }, { label: c.expires[lang], value: adminDate(p.expiresAt, lang, true) }].map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}<div className="ad-info-email"><dt>{c.declaredEmail[lang]}</dt><dd dir={p.email ? 'ltr' : undefined}>{p.email || c.legacyEmail[lang]}</dd></div><div className="ad-info-id"><dt>{c.participationId[lang]}</dt><dd>{p.id}</dd></div></dl></section><p className="ad-privacy"><ShieldCheck size={16} aria-hidden="true"/>{c.private[lang]}</p><div className="ad-detail-tabs print:hidden">{[{ id: 'report' as const, label: c.personalReport[lang], icon: FileText }, { id: 'answers' as const, label: c.answers[lang], icon: ListChecks }].map(item => <button key={item.id} onClick={() => setTab(item.id)} aria-pressed={tab === item.id}><item.icon size={18} aria-hidden="true"/>{item.label}</button>)}</div>{tab === 'report' ? report ? <>{previousNotice}<AdminSummaryAction participantId={p.id} aiStatus={report.aiStatus ?? p.aiStatus ?? 'NONE'} available={config?.aiReportAvailable === true} lang={lang} onUpdate={setData}/>​<ReportView report={report} aiStatus={report.aiStatus ?? p.aiStatus} lang={lang}/></> : <EmptyState title={c.reportWaiting[lang]} body={c.reportWaitingBody[lang]}/> : <section className="ad-answers">{interview.transcript.length ? interview.transcript.map((answer, index) => <article key={index} className="ad-answer"><h2>{c.question[lang]} {index + 1}</h2><p>{answer.question}</p><div><h3>{c.choice[lang]}</h3><p>{answer.answer}</p></div></article>) : <EmptyState title={c.noAnswers[lang]}/>}</section>}</>}</div>;
}
