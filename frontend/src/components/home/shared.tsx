"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import { homeContent } from "@/lib/home-content";
export function useHome() { const { lang } = useLanguage(); return { lang, c: homeContent, ar: lang === "ar" }; }
export function StartLink({ light = false }: {
    light?: boolean;
}) { const { c, lang } = useHome(); return <Link className={`hq-button ${light ? "hq-button-light" : ""}`} href="/entretien">{c.start[lang]}<ArrowUpRight size={20} aria-hidden="true"/></Link>; }
export function BrandArcs() { return <svg className="hq-arcs" viewBox="0 0 720 720" fill="none" aria-hidden="true"><circle cx="360" cy="360" r="310"/><circle cx="360" cy="360" r="242"/><ellipse cx="360" cy="360" rx="150" ry="310"/><path d="M50 360h620"/><circle className="hq-arc-point" cx="570" cy="132" r="12"/></svg>; }
