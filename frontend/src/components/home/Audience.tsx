"use client";
import { useHome } from "./shared";
export default function Audience() { const { c, lang } = useHome(); return <section className="hq-audience hq-section"><div className="hq-container"><h2>{c.audience.title[lang]}</h2><div className="hq-audience-grid">{c.audience.items.map((s, i) => <article key={i} className={`hq-audience-${i}`} data-home-reveal><h3>{s.title[lang]}</h3><p>{s.body[lang]}</p></article>)}</div></div></section>; }
