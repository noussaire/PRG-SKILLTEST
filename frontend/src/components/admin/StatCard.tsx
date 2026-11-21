import type { ReactNode } from 'react';
export function StatCard({ label, value, note, lead = false }: {
    label: string;
    value: ReactNode;
    note?: string;
    lead?: boolean;
}) { return <div data-kpi className={`ad-stat ${lead ? 'ad-stat-lead' : ''}`}><dt>{label}</dt><dd data-kpi-value>{value}</dd>{note && <p>{note}</p>}</div>; }
