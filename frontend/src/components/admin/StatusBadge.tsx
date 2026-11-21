import type { ReactNode } from 'react';
export function StatusBadge({ tone = 'neutral', children }: {
    tone?: 'neutral' | 'info' | 'success' | 'warning' | 'error';
    children: ReactNode;
}) { return <span className={`ad-badge ad-badge-${tone}`}>{children}</span>; }
