"use client";
import { useEffect } from "react";
import Hero from "@/components/home/Hero";
import Stats from "@/components/home/Stats";
import About from "@/components/home/About";
import HowItWorks from "@/components/home/HowItWorks";
import Demo from "@/components/home/Demo";
import Report from "@/components/home/Report";
import Skills from "@/components/home/Skills";
import Audience from "@/components/home/Audience";
import Trust from "@/components/home/Trust";
import Faq from "@/components/home/Faq";
import FinalCta from "@/components/home/FinalCta";
export default function Home() { useEffect(() => { const observer = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) {
    e.target.classList.add("hq-revealed");
    observer.unobserve(e.target);
} }), { threshold: .08 }); document.querySelectorAll("[data-home-reveal]").forEach(el => observer.observe(el)); return () => observer.disconnect(); }, []); return <div className="hq-home" data-brand-home><Hero /><Stats /><About /><HowItWorks /><Demo /><Report /><Skills /><Audience /><Trust /><Faq /><FinalCta /></div>; }
