import type { Metadata } from "next";
import { LanguageProvider } from "@/lib/language-context";
import { PublicHeader, PublicFooter } from "@/components/public-header";
import "./globals.css";
import "./editorial.css";
import "./assessment.css";
import "./home.css";

export const metadata: Metadata = {
  title: "SkillQuest | Chabab Connect",
  description: "Parcours interactif d'évaluation et de développement des soft skills.",
  icons: { icon: "/brand/skillquest-logo.png", apple: "/brand/skillquest-logo.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen antialiased flex flex-col justify-between">
        <LanguageProvider>
          <PublicHeader />
          <main id="main-content" tabIndex={-1} className="flex-1">{children}</main>
          <PublicFooter />
        </LanguageProvider>
      </body>
    </html>
  );
}

