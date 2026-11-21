export function Skeleton({ label, rows = 4 }: {
    label: string;
    rows?: number;
}) { return <div role="status" className="ad-skeleton"><span className="sr-only">{label}</span><div className="ad-skeleton-title"/>{Array.from({ length: rows }, (_, i) => <div className="ad-skeleton-row" key={i}><span /><span /><span /></div>)}</div>; }
