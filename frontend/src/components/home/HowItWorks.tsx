"use client";
import { ArrowUpRight } from "lucide-react";
import { useHome } from "./shared";
export default function HowItWorks() { const { c, lang } = useHome(); return <section id="comment-ca-marche" className="hq-how hq-section"><div className="hq-container"><div className="hq-section-heading" data-home-reveal><h2>{c.how.title[lang]}</h2><p>{c.how.intro[lang]}</p></div><ol className="hq-journey">{c.how.steps.map((s, i) => <li key={i} data-home-reveal><span className="hq-journey-node" aria-hidden="true">{i === 3 ? <ArrowUpRight /> : i + 1}</span><h3>{s.title[lang]}</h3><p>{s.body[lang]}</p></li>)}</ol></div></section>; }
