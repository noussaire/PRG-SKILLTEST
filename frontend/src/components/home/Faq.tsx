"use client";
import { Plus } from "lucide-react";
import { useHome } from "./shared";
export default function Faq() { const { c, lang } = useHome(); return <section id="questions" className="hq-faq hq-section"><div className="hq-container hq-two-col"><div><h2>{c.faq.title[lang]}</h2><p className="hq-lead">{c.faq.intro[lang]}</p></div><div>{c.faq.items.map((s, i) => <details key={i}><summary>{s.question[lang]}<Plus size={20} aria-hidden="true"/></summary><p>{s.answer[lang]}</p></details>)}</div></div></section>; }
