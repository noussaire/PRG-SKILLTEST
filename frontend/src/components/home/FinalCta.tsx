"use client";
import { StartLink, useHome } from "./shared";

export default function FinalCta() {
    const { c, lang, ar } = useHome();
    return <section className="hq-final" aria-labelledby="final-title">
        <div className="hq-container">
            <div className="hq-final-card" data-home-reveal>
                <span className="hq-final-arc" aria-hidden="true" />
                <div className="hq-final-copy">
                    <h2 id="final-title">{c.final.title[lang]}</h2>
                    <p>{c.final.body[lang]}</p>
                </div>
                <div className="hq-final-actions">
                    <StartLink />
                    <span>{ar ? "مجاني · دون بطاقة بنكية" : "Gratuit · Sans carte bancaire"}</span>
                </div>
            </div>
        </div>
    </section>;
}
