"use client";
import { useEffect, useRef, useId } from 'react';
import { Button } from './Button';
export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel, onConfirm, onClose, danger = false, busy = false, error }: {
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
    onClose: () => void;
    danger?: boolean;
    busy?: boolean;
    error?: string | null;
}) { const ref = useRef<HTMLDialogElement>(null), id = useId(); useEffect(() => { if (open && !ref.current?.open)
    ref.current?.showModal(); if (!open && ref.current?.open)
    ref.current.close(); }, [open]); return <dialog ref={ref} className="ad-confirm" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy || undefined} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><h2 id={`${id}-title`}>{title}</h2><p id={`${id}-description`}>{description}</p>{error && <p role="alert" className="ad-delete-error">{error}</p>}<div className="ad-dialog-actions"><Button autoFocus disabled={busy} onClick={onClose}>{cancelLabel}</Button><Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>{confirmLabel}</Button></div></dialog>; }
