"use client";
import Image from "next/image";
import { ListChecks, Compass, FileDown } from "lucide-react";
import { useHome } from "./shared";
const icons = [ListChecks, Compass, FileDown];
export default function Report() { const { c, lang } = useHome(); return <section id="rapport" className="hq-report hq-section"><div className="hq-container hq-two-col"><figure className="hq-report-visual" data-home-reveal><Image src={`/brand/previews/summary-${lang}.png`} alt={c.report.alt[lang]} width={900} height={550} sizes="(max-width: 767px) 85vw, 560px"/><figcaption>{c.report.caption[lang]}</figcaption></figure><div data-home-reveal><h2>{c.report.title[lang]}</h2><p className="hq-lead">{c.report.intro[lang]}</p><dl className="hq-benefits">{c.report.benefits.map((s, i) => { const Icon = icons[i]; return <div key={i}><Icon size={24} strokeWidth={1.6} aria-hidden="true"/><div><dt>{s.title[lang]}</dt><dd>{s.body[lang]}</dd></div></div>; })}</dl></div></div></section>; }
