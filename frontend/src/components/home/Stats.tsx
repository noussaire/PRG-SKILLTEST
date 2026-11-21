"use client";
import { useEffect, useRef, useState } from "react";
import { useHome } from "./shared";
function Count({ value }: {
    value: number;
}) { const ref = useRef<HTMLSpanElement>(null); const [n, setN] = useState(value); useEffect(() => { if (matchMedia("(prefers-reduced-motion: reduce)").matches)
    return; let frame = 0; const obs = new IntersectionObserver(([e]) => { if (!e.isIntersecting)
    return; const start = performance.now(); const step = (now: number) => { const t = Math.min((now - start) / 900, 1); setN(Math.round(value * (1 - (1 - t) ** 3))); if (t < 1)
    frame = requestAnimationFrame(step); }; frame = requestAnimationFrame(step); obs.disconnect(); }); if (ref.current)
    obs.observe(ref.current); return () => { obs.disconnect(); cancelAnimationFrame(frame); }; }, [value]); return <span ref={ref}><span aria-hidden="true">{n}</span><span className="sr-only">{value}</span></span>; }
export default function Stats() { const { c, lang } = useHome(); return <section className="hq-stats" aria-label={c.statsLabel[lang]}><dl className="hq-container">{c.stats.map(s => <div key={s.value}><dt><Count value={s.value}/></dt><dd>{s.label[lang]}</dd></div>)}</dl></section>; }
