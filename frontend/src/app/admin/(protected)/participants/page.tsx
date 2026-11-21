"use client";
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, RefreshCw, Download } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { adminContent as c } from '@/lib/admin-content';
import type { AdaptiveParticipantList, AdminAdaptiveParticipant } from '@/lib/adaptive-admin-types';
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
    const [deleteTarget, setDeleteTarget] = useState<AdminAdaptiveParticipant | null>(null), [deleting, setDeleting] = useState(false), [deleteError, setDeleteError] = useState<string | null>(null);
    useEffect(() => { setSearch(params.get('search')?.slice(0, 100) || ''); }, [params]);
    useEffect(() => { if (search === debounced) return; const timer = setTimeout(() => { setDebounced(search); setPage(1); }, 300); return () => clearTimeout(timer); }, [search, debounced]);
    useEffect(() => { let active = true; setLoading(true); setError(false); const query = new URLSearchParams({ page: String(page), limit: '12', search: debounced, status, ai }); fetch(`/api/admin/adaptive/participants?${query}`, { cache: 'no-store' }).then(async (res) => { if (!res.ok)
        throw Error(); return res.json() as Promise<AdaptiveParticipantList>; }).then(value => { if (active)
        setData(value); }).catch(() => { if (active)
        setError(true); }).finally(() => { if (active)
        setLoading(false); }); return () => { active = false; }; }, [page, debounced, status, ai, refresh]);
    const visible = useMemo(() => { const minDate = period === 'ALL' ? 0 : Date.now() - Number(period) * 86400000; return (data?.participants || []).filter(p => (language === 'ALL' || p.language === language) && new Date(p.createdAt).getTime() >= minDate).sort((a, b) => sort === 'name' ? a.displayName.localeCompare(b.displayName, lang) : sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)); }, [data, language, period, sort, lang]);
    useEffect(() => { setSelected(new Set()); }, [data, language, period, sort]);
    function reset() { setSearch(''); setStatus('ALL'); setAI('ALL'); setLanguage('ALL'); setPeriod('ALL'); setSort('recent'); setPage(1); }
    async function deleteParticipant() {
        if (!deleteTarget || deleting) return;
        setDeleting(true); setDeleteError(null); setToast('');
        try {
            const response = await fetch(`/api/admin/adaptive/participants/${deleteTarget.id}`, { method: 'DELETE' });
            // A concurrently removed participant is already in the requested state.
            if (!response.ok && response.status !== 404) throw Error();
            const total = Math.max(0, (data?.pagination.total ?? 1) - 1), limit = data?.pagination.limit ?? 12;
            setPage(value => Math.min(value, Math.max(1, Math.ceil(total / limit))));
            setSelected(new Set()); setData(null); setRefresh(value => value + 1);
            setDeleteTarget(null); setToast(c.deleted[lang]);
        } catch { setDeleteError(c.deleteFailed[lang]); }
        finally { setDeleting(false); }
    }
    function exportSelected() { const rows = visible.filter(p => selected.has(p.id)); const cell = (v: string) => { const safe = /^[\s]*[=+\-@]/.test(v) ? `'${v}` : v; return `"${safe.replaceAll('"', '""')}"`; }; const lines = [[c.identity[lang], c.email[lang], c.testState[lang], c.language[lang], c.created[lang]], ...rows.map(p => [p.displayName, p.email || '', p.status, p.language, p.createdAt])]; const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.map(row => row.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8;' })); const a = document.createElement('a'); a.href = url; a.download = 'skillquest-participations.csv'; document.body.appendChild(a);a.click();a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); setConfirm(false); setToast(c.exported[lang]); }
    return <div data-adaptive-participants><PageHeader title={c.listTitle[lang]} description={c.listIntro[lang]}><Button disabled={loading} aria-label={c.refresh[lang]} onClick={() => setRefresh(v => v + 1)}><RefreshCw size={18} aria-hidden="true"/></Button><Button onClick={() => { setToast(''); setConfirm(true); }} disabled={!selected.size}><Download size={18} aria-hidden="true"/>{c.export[lang]}</Button></PageHeader><FilterBar label={c.filters[lang]}><div className="ad-filters-main"><FormField id="participant-search" label={c.search[lang]}><div className="ad-search-field"><Search size={18} aria-hidden="true"/><input id="participant-search" aria-label={c.search[lang]} value={search} onChange={e => setSearch(e.target.value)} maxLength={100}/></div></FormField><FormField id="participant-status" label={c.testState[lang]}><select id="participant-status" aria-label={c.testState[lang]} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="ALL">{c.allTests[lang]}</option><option value="COMPLETED">{c.completeTests[lang]}</option><option value="IN_PROGRESS">{c.currentTests[lang]}</option></select></FormField><FormField id="participant-ai" label={c.aiState[lang]}><select id="participant-ai" aria-label={c.aiState[lang]} value={ai} onChange={e => { setAI(e.target.value); setPage(1); }}><option value="ALL">{c.allReports[lang]}</option><option value="COMPLETE">{c.aiReady[lang]}</option><option value="PENDING">{c.aiPending[lang]}</option><option value="UNAVAILABLE">{c.automatic[lang]}</option></select></FormField></div><details className="ad-local-filters"><summary>{c.moreFilters[lang]}</summary><div className="ad-filters-secondary"><FormField id="page-language" label={c.language[lang]}><select id="page-language" value={language} onChange={e => setLanguage(e.target.value)}><option value="ALL">{c.allLanguages[lang]}</option><option value="fr">{c.french[lang]}</option><option value="ar">{c.arabic[lang]}</option></select></FormField><FormField id="page-period" label={c.period[lang]}><select id="page-period" value={period} onChange={e => setPeriod(e.target.value)}><option value="ALL">{c.allDates[lang]}</option><option value="7">{c.week[lang]}</option><option value="30">{c.month[lang]}</option></select></FormField><FormField id="page-sort" label={c.sort[lang]}><select id="page-sort" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">{c.recentFirst[lang]}</option><option value="oldest">{c.oldestFirst[lang]}</option><option value="name">{c.nameFirst[lang]}</option></select></FormField></div><p className="ad-caption">{c.localScope[lang]}</p></details></FilterBar>{error ? <AdminError ar={ar} retry={() => setRefresh(v => v + 1)}/> : loading || !data ? <AdminLoading ar={ar}/> : <section className="ad-list-panel"><div className="ad-list-summary"><p><strong>{data.pagination.total}</strong> {(data.pagination.total===1?c.oneTotal:c.total)[lang]} <span>· {visible.length} {c.shown[lang]}</span></p>{selected.size > 0 && <p role="status">{selected.size} {c.selected[lang]}</p>}</div>{visible.length ? <DataTable rows={visible} lang={lang} selected={selected} deleting={deleting} onDelete={participant => { setDeleteError(null); setToast(''); setDeleteTarget(participant); }} onSelect={id => setSelected(prev => { const next = new Set(prev); if (next.has(id))
        next.delete(id);
    else
        next.add(id); return next; })} onSelectAll={() => setSelected(selected.size === visible.length ? new Set() : new Set(visible.map(p => p.id)))}/> : <EmptyState title={c.emptyTitle[lang]} body={c.emptyBody[lang]}><Button onClick={reset}>{c.reset[lang]}</Button></EmptyState>}<div className="ad-pagination"><span>{c.page[lang]} {page} {c.of[lang]} {data.pagination.totalPages}</span><div><Button disabled={page <= 1} onClick={() => setPage(v => v - 1)}>{c.previous[lang]}</Button><Button disabled={page >= data.pagination.totalPages} onClick={() => setPage(v => v + 1)}>{c.next[lang]}</Button></div></div></section>}<ConfirmDialog open={confirm} title={c.exportTitle[lang]} description={c.exportBody[lang]} confirmLabel={c.download[lang]} cancelLabel={c.cancel[lang]} onConfirm={exportSelected} onClose={() => setConfirm(false)}/><ConfirmDialog open={deleteTarget !== null} title={c.deleteTitle[lang]} description={c.deleteBody[lang].replace('{name}', deleteTarget?.displayName ?? '')} confirmLabel={deleting ? c.deleting[lang] : c.deleteConfirm[lang]} cancelLabel={c.cancel[lang]} danger busy={deleting} error={deleteError} onConfirm={deleteParticipant} onClose={() => { if (!deleting) { setDeleteTarget(null); setDeleteError(null); } }}/><Toast message={toast}/></div>;
}
