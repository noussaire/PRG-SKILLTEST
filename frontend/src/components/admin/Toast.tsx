"use client";
import { useEffect, useState } from 'react';
export function Toast({ message }: {
    message: string;
}) { const [visible, setVisible] = useState(false); useEffect(() => { if (!message)
    return; setVisible(true); const t = setTimeout(() => setVisible(false), 4000); return () => clearTimeout(t); }, [message]); return <div className={visible ? 'ad-toast' : 'sr-only'} role="status" aria-live="polite">{visible ? message : ''}</div>; }
