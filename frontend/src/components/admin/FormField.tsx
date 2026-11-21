import type { ReactNode } from 'react';
export function FormField({ id, label, hint, children }: {
    id: string;
    label: string;
    hint?: string;
    children: ReactNode;
}) { return <div className="ad-field"><label htmlFor={id}>{label}</label>{children}{hint && <p id={`${id}-hint`} className="ad-muted">{hint}</p>}</div>; }
