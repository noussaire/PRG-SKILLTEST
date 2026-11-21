"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import { homeContent as c } from "@/lib/home-content";
import { LanguageSwitcher } from "./language-switcher";
import { BrandLogo } from "./brand-logo";
import { StartLink } from "./home/shared";
export function PublicHeader() { const { lang } = useLanguage(), pathname = usePathname(); if (pathname.startsWith("/admin"))
    return null; return <><a href="#main-content" className="skip-link">{c.skip[lang]}</a><header className="public-header hq-site-header"><div className="hq-institution"><div className="hq-container"><span>{c.association[lang]}</span><span>{c.institution[lang]}</span></div></div><div className="hq-container hq-header-inner"><Link href="/" aria-label="SkillQuest"><BrandLogo /></Link><nav aria-label={c.navLabel[lang]}>{c.nav.map(n => <Link key={n.href} href={n.href}>{n.label[lang]}</Link>)}</nav><LanguageSwitcher /><StartLink /></div></header></>; }
export function PublicFooter() {
    const { lang } = useLanguage(), ar = lang === "ar", pathname = usePathname();
    if (pathname.startsWith("/admin")) return null;
    const cols = [
        { title: ar ? "اكتشف" : "Découvrir", links: [
            [ar ? "المسار التكيفي" : "Le parcours", "/#comment-ca-marche"],
            [ar ? "المهارات" : "Les compétences", "/#competences"],
            [ar ? "التقرير الشخصي" : "Le rapport", "/#rapport"],
            [ar ? "أسئلة شائعة" : "Questions fréquentes", "/#questions"],
        ] },
        { title: ar ? "المعلومات" : "Informations", links: [
            [ar ? "الجمعية" : "L’association", "/#association"],
            [ar ? "الخصوصية" : "Confidentialité", "/confidentialite"],
            [ar ? "الإدارة" : "Administration", "/admin/login"],
        ] },
    ];
    return <footer className="hq-site-footer">
        <span className="hq-footer-arc" aria-hidden="true" />
        <div className="hq-container">
            <div className="hq-footer-grid">
                <div className="hq-footer-brand">
                    <Link href="/" aria-label="SkillQuest" className="hq-footer-logo"><BrandLogo /></Link>
                    <p>{ar ? "أداة تربوية لاستكشاف مهاراتك الشخصية وإيجاد مسارات جديدة للعمل." : "Un outil pédagogique pour explorer ses compétences et trouver de nouvelles pistes d’action."}</p>
                    <Link href="/entretien" className="hq-footer-cta">{c.start[lang]}<ArrowUpRight size={18} aria-hidden="true" /></Link>
                </div>
                {cols.map(col => <nav key={col.title} aria-label={col.title} className="hq-footer-col">
                    <h2>{col.title}</h2>
                    <ul>{col.links.map(([label, href]) => <li key={href}><Link href={href}>{label}</Link></li>)}</ul>
                </nav>)}
                <div className="hq-footer-col">
                    <h2>{ar ? "مبادرة" : "Une initiative"}</h2>
                    <p className="hq-footer-org">{c.association[lang]}</p>
                    <ul className="hq-footer-tags">
                        <li>{ar ? "عربية · فرنسية" : "Français · Arabe"}</li>
                        <li>{ar ? "دون بطاقة بنكية" : "Sans carte bancaire"}</li>
                        <li>{ar ? "ليس تشخيصا" : "Pas un diagnostic"}</li>
                    </ul>
                </div>
            </div>
            <p className="hq-footer-wordmark" aria-hidden="true" dir="ltr">SkillQuest</p>
            <div className="hq-footer-bottom">
                <p>© {new Date().getFullYear()} {c.association[lang]}</p>
                <p>{ar ? "أداة تربوية، دون تصنيف الأشخاص." : "Un outil pédagogique, sans classement des personnes."}</p>
            </div>
        </div>
    </footer>;
}
