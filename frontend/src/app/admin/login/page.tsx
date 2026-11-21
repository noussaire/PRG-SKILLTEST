"use client";
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useLanguage } from '@/lib/language-context';
import { adminContent as c } from '@/lib/admin-content';
import { Button } from '@/components/admin/Button';
import { FormField } from '@/components/admin/FormField';
import { BrandArcs } from '@/components/home/shared';
export default function AdminLoginPage() {
    const router = useRouter(), { lang } = useLanguage();
    const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [showPassword, setShowPassword] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
    const errorRef = useRef<HTMLDivElement>(null);
    async function handleSubmit(e: React.FormEvent) { e.preventDefault(); setError(null); setLoading(true); try {
        const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const data: {
            error?: string;
        } = await res.json();
        if (!res.ok) {
            setError(data.error || c.invalid[lang]);
            setLoading(false);
            requestAnimationFrame(() => errorRef.current?.focus());
            return;
        }
        router.push('/admin/dashboard');
        router.refresh();
    }
    catch {
        setError(c.network[lang]);
        setLoading(false);
        requestAnimationFrame(() => errorRef.current?.focus());
    } }
    return <div className="ad-login"><section className="ad-login-brand"><Link href="/" className="ad-login-logo"><BrandLogo /></Link><div><ShieldCheck size={20} aria-hidden="true"/><h2>{c.loginStatement[lang]}</h2><p>{c.loginBrandBody[lang]}</p></div><BrandArcs /><p className="ad-login-signature">{c.association[lang]}</p></section><section className="ad-login-work"><div className="ad-login-top"><Link href="/">{c.backSite[lang]}</Link><LanguageSwitcher /></div><div className="ad-login-form"><h1>{c.loginTitle[lang]}</h1><p className="ad-lead">{c.loginIntro[lang]}</p>{error && <div ref={errorRef} tabIndex={-1} role="alert" id="login-error" className="ad-alert ad-alert-error"><AlertCircle size={18} aria-hidden="true"/><p>{error}</p></div>}<form onSubmit={handleSubmit} aria-busy={loading}><FormField id="email" label={c.email[lang]}><input id="email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} dir="ltr" aria-describedby={error ? 'login-error' : undefined}/></FormField><FormField id="password" label={c.password[lang]}><div className="ad-password"><input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} aria-describedby={error ? 'login-error' : undefined}/><button type="button" aria-label={(showPassword ? c.hidePassword : c.showPassword)[lang]} aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)}>{showPassword ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}</button></div></FormField><Button type="submit" variant="primary" busy={loading}>{(loading ? c.logging : c.login)[lang]}{!loading && <ArrowRight size={18} className="ad-direction" aria-hidden="true"/>}</Button></form><p className="ad-login-notice"><ShieldCheck size={16} aria-hidden="true"/>{c.restricted[lang]}</p></div></section></div>;
}
