"use client";
import Image from "next/image";
import { BrandArcs, useHome } from "./shared";
export default function About() { const { c, lang } = useHome(); return <section id="association" className="hq-about hq-section"><div className="hq-container hq-two-col"><div data-home-reveal><h2>{c.about.title[lang]}</h2><p className="hq-lead">{c.about.body[lang]}</p><h3>{c.about.mission[lang]}</h3><p>{c.about.detail[lang]}</p></div><figure className="hq-about-art" data-home-reveal><BrandArcs /><div className="hq-about-paper"><Image src={`/brand/previews/report-${lang}.png`} alt={c.about.visualAlt[lang]} width={900} height={550} sizes="(max-width: 767px) 85vw, 460px"/></div><figcaption>{c.about.signature[lang]}</figcaption></figure></div></section>; }
