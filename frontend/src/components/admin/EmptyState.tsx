import type { ReactNode } from 'react';
export function EmptyState({ title, body, children }: {
    title: string;
    body?: string;
    children?: ReactNode;
}) { return <div className="ad-empty"><svg viewBox="0 0 100 44" fill="none" aria-hidden="true"><path d="M8 40a42 42 0 0 1 84 0M24 40a26 26 0 0 1 52 0M40 40a10 10 0 0 1 20 0"/><circle cx="78" cy="11" r="3"/></svg><h3>{title}</h3>{body && <p>{body}</p>}{children}</div>; }
