import Image from "next/image";

// Only the transparent outside margins are framed in CSS; the supplied asset is unchanged.
export function BrandLogo({ className = "", priority = false }: { className?: string; priority?: boolean }) {
  return <span className={`brand-logo ${className}`}>
    <Image src="/brand/skillquest-logo.png" alt="SkillQuest — Chabab Connect" width={500} height={500} priority={priority} sizes="(max-width: 640px) 140px, 180px" />
  </span>;
}
