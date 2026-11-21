import type { ReactNode } from 'react';
export function FilterBar({ label, children }: {
    label: string;
    children: ReactNode;
}) { return <section className="ad-filter-bar" aria-label={label}>{children}</section>; }
