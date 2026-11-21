"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useHome } from "./shared";
export default function Trust() { const { c, lang } = useHome(); return <section className="hq-trust hq-section"><div className="hq-container hq-two-col"><div><h2>{c.trust.title[lang]}</h2><p className="hq-lead">{c.trust.intro[lang]}</p><Link className="hq-text-link" href="/confidentialite">{c.trust.privacy[lang]}<ArrowUpRight size={20} aria-hidden="true"/></Link></div><dl className="hq-trust-list">{c.trust.items.map((s, i) => <div key={i}><dt>{s.title[lang]}</dt><dd>{s.body[lang]}</dd></div>)}</dl></div></section>; }
