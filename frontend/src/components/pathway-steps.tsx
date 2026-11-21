"use client";
import { Check } from "lucide-react";
import { useLanguage } from "@/lib/language-context";

export function PathwaySteps({ current }: { current: 1 | 2 | 3 | 4 }) {
  const { lang } = useLanguage(), ar = lang === "ar";
  const labels = ar ? ["الاختبار", "المعلومات", "المسار", "التقرير"] : ["Le test", "Vos infos", "Le parcours", "Le bilan"];
  return <ol aria-label={ar ? "مراحل المسار" : "Étapes du parcours"} className="mb-8 grid grid-cols-4 gap-2 print:hidden" data-pathway-steps>{labels.map((label, index) => <li key={label} aria-current={index + 1 === current ? "step" : undefined} className={`flex flex-col items-center gap-2 border-b-2 pb-4 text-center text-xs font-bold sm:flex-row sm:gap-3 ${index + 1 === current ? "border-brand-green-700 text-brand-green-800" : index + 1 < current ? "border-brand-green-200 text-brand-blue-700" : "border-slate-200 text-slate-500"}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] ${index + 1 === current ? "bg-brand-green-700 text-white" : index + 1 < current ? "bg-brand-green-100 text-brand-green-800" : "bg-slate-100 text-slate-500"}`}>{index + 1 < current ? <Check size={13} aria-hidden="true" /> : `0${index + 1}`}</span><span>{label}</span></li>)}</ol>;
}
