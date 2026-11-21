"use client";
import type { ButtonHTMLAttributes } from 'react';
import { LoaderCircle } from 'lucide-react';
export function Button({ variant = 'secondary', busy = false, className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    busy?: boolean;
}) { return <button {...props} className={`ad-button ad-button-${variant} ${className}`} disabled={props.disabled || busy} aria-busy={busy || undefined}>{busy && <LoaderCircle size={18} className="ad-spin" aria-hidden="true"/>}{children}</button>; }
