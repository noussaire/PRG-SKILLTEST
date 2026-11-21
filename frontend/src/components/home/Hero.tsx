"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Check, Pause, Play } from "lucide-react";
import { homeDemo } from "@/lib/home-content";
import { BrandArcs, StartLink, useHome } from "./shared";
export default function Hero() {
    const { c, lang } = useHome();
    const [paused, setPaused] = useState(false), [slide, setSlide] = useState(0), [visible, setVisible] = useState(true), [reduced, setReduced] = useState(true);
    const root = useRef<HTMLElement>(null);
    useEffect(() => { const media = matchMedia("(prefers-reduced-motion: reduce)"); const update = () => setReduced(media.matches); update(); media.addEventListener("change", update); const obs = new IntersectionObserver(([e]) => setVisible(e.isIntersecting)); if (root.current)
        obs.observe(root.current); return () => { media.removeEventListener("change", update); obs.disconnect(); }; }, []);
    useEffect(() => { if (paused || reduced || !visible)
        return; const id = setInterval(() => { if (document.visibilityState === "visible")
        setSlide(v => (v + 1) % 4); }, 3600); return () => clearInterval(id); }, [paused, reduced, visible]);
    return <section ref={root} className="hq-hero"><div className="hq-container hq-hero-grid"><div className="hq-hero-copy"><h1>{c.hero.title[lang]}</h1><p className="hq-lead">{c.hero.intro[lang]}</p><div className="hq-actions"><StartLink /><a className="hq-text-link" href="#comment-ca-marche">{c.howLink[lang]}</a></div><ul className="hq-reassurance">{c.hero.reassurance.map((s, i) => <li key={i}><Check size={15} aria-hidden="true"/>{s[lang]}</li>)}</ul></div><div className="hq-hero-visual"><BrandArcs /><div className="hq-app-window" data-ui aria-label={c.hero.preview[lang]}><div className="hq-window-bar"><span className="hq-window-dots" aria-hidden="true">● ● ●</span><span>{c.hero.example[lang]}</span><span>SkillQuest</span></div><div className="hq-mock-body"><div className="hq-progress" aria-hidden="true"><span /></div><p className="hq-kicker">{c.hero.stage[lang]}</p><p className="hq-mock-question">{c.hero.question[lang]}</p><div className="hq-mock-choices">{homeDemo.choices.map((s, i) => <div key={i} className={slide === i ? "is-active" : ""}><span className="hq-choice-mark" aria-hidden="true">{slide === i && <Check size={14}/>}</span>{s[lang]}</div>)}</div><p className="hq-mock-next">{c.hero.next[lang]}</p></div></div><figure className="hq-hero-receipt"><Image src={`/brand/previews/path-${lang}.png`} alt={c.hero.imageAlt[lang]} width={900} height={320} sizes="(max-width: 767px) 75vw, 320px" priority/></figure><button className="hq-motion" onClick={() => setPaused(v => !v)} aria-pressed={paused}>{paused ? <Play size={16} aria-hidden="true"/> : <Pause size={16} aria-hidden="true"/>}{(paused ? c.hero.play : c.hero.pause)[lang]}</button></div></div></section>; // taste-skill-ignore: this context label belongs to the data-ui test preview, not an eyebrow above a marketing heading.
}
