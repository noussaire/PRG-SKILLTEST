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
    return <div className="ad-chart" ref={root}><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-title ${id}-description`}><title id={`${id}-title`}>{c.evolution[lang]}</title><desc id={`${id}-description`}>{days.map(d => `${d.key}: ${d.count}`).join('; ')}</desc>{ticks.map(n => <g key={n}><line x1={L} x2={W - R} y1={ys(n)} y2={ys(n)} className="ad-chart-grid"/><text x={L - 10} y={ys(n) + 4} textAnchor="end">{n}</text></g>)}<polyline points={points} className="ad-chart-series"/>{days.filter((_,i)=>W>=450||i%2===0).map((d) => {const i=days.indexOf(d);return <text key={d.key} x={xs(i)} y={H - 7} textAnchor={i === 0 ? 'start' : i === 6 ? 'end' : 'middle'}>{d.date.toLocaleDateString(lang === 'ar' ? 'ar-MA' : 'fr-FR', { timeZone: 'Africa/Casablanca', day: '2-digit', month: '2-digit' }).replace(/[\u200e\u200f\u061c]/g, '')}</text>;})}</svg><div className="sr-only"><table><caption>{c.chartTable[lang]}</caption><thead><tr><th scope="col">{c.day[lang]}</th><th scope="col">{c.count[lang]}</th></tr></thead><tbody>{days.map(d => <tr key={d.key}><th scope="row">{d.key}</th><td>{d.count}</td></tr>)}</tbody></table></div><p className="ad-caption">{c.chartScope[lang]}</p></div>;
}
