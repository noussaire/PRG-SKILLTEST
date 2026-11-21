"use client";
import { useLanguage } from "@/lib/language-context";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLanguage();
  return <div role="group" aria-label={lang === "ar" ? "لغة الموقع" : "Langue du site"} className={`sq-language ${className}`} dir="ltr">
    <button type="button" lang="fr" aria-label="Français" aria-pressed={lang === "fr"} onClick={() => setLang("fr")} className="">FR</button>
    <button type="button" lang="ar" aria-label="العربية" aria-pressed={lang === "ar"} onClick={() => setLang("ar")} className="">العربية</button>
  </div>;
}
