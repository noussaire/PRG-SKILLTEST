"use client";
import Link from 'next/link';
import { RefreshCw, ArrowUpRight } from 'lucide-react';
import type { AdminAdaptiveParticipant } from '@/lib/adaptive-admin-types';
import { adminContent as c, adminDate } from '@/lib/admin-content';
import { Skeleton } from './Skeleton';
import { Button } from './Button';
import { StatusBadge } from './StatusBadge';
export function AdminLoading({ ar }: {
    ar: boolean;
}) { return <Skeleton label={c.loading[ar ? 'ar' : 'fr']}/>; }
export function AdminError({ ar, retry }: {
    ar: boolean;
    retry: () => void;
}) { const lang = ar ? 'ar' : 'fr'; return <div role="alert" className="ad-alert ad-alert-error"><p>{c.failed[lang]}</p><Button onClick={retry}><RefreshCw size={16} aria-hidden="true"/>{c.retry[lang]}</Button></div>; }
export function AIStatus({ participant: p, ar }: {
    participant: AdminAdaptiveParticipant;
    ar: boolean;
}) { const lang = ar ? 'ar' : 'fr', pending = ['PENDING', 'PROCESSING', 'RETRY'].includes(p.aiStatus); return <StatusBadge tone={p.aiGenerated ? 'info' : pending ? 'warning' : 'neutral'}>{(p.aiGenerated ? c.aiReady : pending ? c.aiPending : p.status === 'IN_PROGRESS' ? c.afterTest : c.automatic)[lang]}</StatusBadge>; }
export function ParticipantRows({ participants, ar }: {
    participants: AdminAdaptiveParticipant[];
    ar: boolean;
}) { const lang = ar ? 'ar' : 'fr'; return <ul className="ad-recent-list">{participants.map(p => <li key={p.id}><Link href={`/admin/participants/${p.id}`} data-participant-row><span className="ad-avatar" aria-hidden="true">{p.displayName.slice(0, 2).toUpperCase()}</span><div className="ad-recent-identity"><strong>{p.displayName}</strong><span>{adminDate(p.createdAt, lang)} · {p.answeredCount}/31</span></div><ArrowUpRight size={18} className="ad-direction" aria-hidden="true"/></Link></li>)}</ul>; }
