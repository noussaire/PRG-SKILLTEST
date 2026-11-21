"use client";
import { useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { ReportEmailStatus } from '@/components/report-email-status';
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
    return <section ref={root} data-adaptive-report className="ad-report" dir={lang === 'ar' ? 'rtl' : 'ltr'}><ReportEmailStatus report={report} lang={lang}/><article data-adaptive-summary className="ad-report-summary"><div className="ad-summary-heading"><BrandLogo /><span className="ad-summary-source">{(report.summarySource === 'ai' ? c.aiSummary : c.ruleSummary)[lang]}</span></div><h2>{c.reportTitle[lang]}</h2><p className="ad-report-prose">{report.summary}</p>{report.summarySource !== 'ai' && <p className="ad-notice">{(['PENDING', 'PROCESSING', 'RETRY'].includes(aiStatus) ? c.awaitAI : c.noAI)[lang]}</p>}<p className="ad-disclaimer">{report.disclaimer}</p>{!!report.legacyObservationCount && <p className="ad-caption">{c.legacyAnswers[lang]}</p>}</article><div className="ad-report-tools print:hidden"><nav aria-label={c.families[lang]}>{groups.map(g => <a key={g.id} href={`#family-${g.id}`}>{g.label}<span>{g.skills.length}</span></a>)}</nav><div><Button variant="ghost" onClick={() => toggle(true)}>{c.expandAll[lang]}</Button><Button variant="ghost" onClick={() => toggle(false)}>{c.collapseAll[lang]}</Button></div></div>{groups.filter(g => g.skills.length).map(group => <section key={group.id} id={`family-${group.id}`} className="ad-report-family"><div className="ad-family-heading"><h2>{group.label}</h2><span>{group.skills.length} {c.familyCount[lang]}</span></div><div className="ad-skill-list">{group.skills.map(skill => <article key={skill.id} data-adaptive-skill className="ad-skill"><details data-skill-details><summary><h3>{skill.label}</h3><span className="ad-skill-reference">{skill.level === null ? c.notObserved[lang] : `${c.reference[lang]} ${skill.level}/4`}</span><ChevronDown size={18} aria-hidden="true"/></summary><SkillBody skill={skill} lang={lang}/></details><div className="hidden print:block"><h3>{skill.label} · {skill.level === null ? c.notObserved[lang] : `${c.reference[lang]} ${skill.level}/4`}</h3><SkillBody skill={skill} lang={lang}/></div></article>)}</div></section>)}</section>;
}
function SkillBody({ skill, lang }: {
    skill: AdaptiveReportSkill;
    lang: AdminLanguage;
}) { return <div className="ad-skill-body"><div><h4>{c.question[lang]}</h4><p>{skill.question || '—'}</p><h4>{c.choice[lang]}</h4><p>{skill.answer || skill.evidenceQuote || '—'}</p></div><div><h4>{c.rationale[lang]}</h4><p>{skill.rationale}</p><h4>{c.advice[lang]}</h4><p>{skill.advice}</p></div></div>; }
