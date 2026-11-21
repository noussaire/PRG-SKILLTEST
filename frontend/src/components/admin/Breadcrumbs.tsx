import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
export function Breadcrumbs({ label, items }: {
    label: string;
    items: {
        label: string;
        href?: string;
    }[];
}) { return <nav aria-label={label} className="ad-breadcrumbs"><ol>{items.map((item, i) => <li key={i}>{i > 0 && <ChevronRight size={16} className="ad-direction" aria-hidden="true"/>}{item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}</li>)}</ol></nav>; }
