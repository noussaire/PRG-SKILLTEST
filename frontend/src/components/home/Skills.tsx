"use client";
import { useRef, useState } from "react";
import { homeDemo } from "@/lib/home-content";
import { useHome } from "./shared";
export default function Skills() { const { c, lang, ar } = useHome(); const [active, setActive] = useState(0); const refs = useRef<(HTMLButtonElement | null)[]>([]); return <section id="competences" className="hq-skills hq-section"><div className="hq-container"><div className="hq-section-heading"><h2>{c.skills.title[lang]}</h2><p>{c.skills.intro[lang]}</p></div><div className="hq-tabs" role="tablist" aria-label={c.skills.tabs[lang]}>{c.skills.families.map((f, i) => <button ref={el => { refs.current[i] = el; }} key={f.id} role="tab" id={`tab-${f.id}`} aria-controls={`panel-${f.id}`} aria-selected={active === i} tabIndex={active === i ? 0 : -1} onClick={() => setActive(i)} onKeyDown={e => { let n = active; if (e.key === "Home")
    n = 0;
else if (e.key === "End")
    n = 3;
else if (e.key === "ArrowRight")
    n = (active + (ar ? 3 : 1)) % 4;
else if (e.key === "ArrowLeft")
    n = (active + (ar ? 1 : 3)) % 4;
else
    return; e.preventDefault(); setActive(n); refs.current[n]?.focus(); }}>{f.label[lang]}<span>{f.ids.length}</span></button>)}</div>{c.skills.families.map((f, i) => <div key={f.id} className={`hq-skill-panel hq-family-${i}`} id={`panel-${f.id}`} role="tabpanel" aria-labelledby={`tab-${f.id}`} hidden={active !== i} tabIndex={0}><div><h3>{f.description[lang]}</h3><p>{f.ids.length} {c.skills.count[lang]}</p></div><ul>{f.ids.map(id => <li key={id}>{homeDemo.skills.find(s => s.id === id)?.[lang]}</li>)}</ul></div>)}</div></section>; }
