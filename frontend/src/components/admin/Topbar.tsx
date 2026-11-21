"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Menu, Search, UserRound, LogOut, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { LanguageSwitcher } from '@/components/language-switcher';
import { adminContent as c, AdminLanguage } from '@/lib/admin-content';
import { Breadcrumbs } from './Breadcrumbs';
export function Topbar({ lang, pathname, email, menuOpen, onMenu, onLogout }: {
    lang: AdminLanguage;
    pathname: string;
    email: string;
    menuOpen: boolean;
    onMenu: () => void;
    onLogout: () => void;
}) { const router = useRouter(), [q, setQ] = useState(''); const detail = pathname.startsWith('/admin/participants/'); const items = [{ label: c.admin[lang], href: '/admin/dashboard' }, { label: (pathname.startsWith('/admin/participants') ? c.participants : c.overview)[lang], ...(detail ? { href: '/admin/participants' } : {}) }, ...(detail ? [{ label: c.participant[lang] }] : [])]; return <header className="ad-topbar"><button className="ad-mobile-menu ad-icon-button" onClick={onMenu} aria-label={c.openMenu[lang]} aria-expanded={menuOpen} aria-controls="admin-navigation-drawer"><Menu size={20} aria-hidden="true"/></button><Breadcrumbs label={c.breadcrumb[lang]} items={items}/><form className="ad-global-search" role="search" onSubmit={e => { e.preventDefault(); router.push(`/admin/participants?search=${encodeURIComponent(q.trim())}`); }}><label htmlFor="admin-global-search" className="sr-only">{c.searchHint[lang]}</label><Search size={18} aria-hidden="true"/><input id="admin-global-search" value={q} maxLength={100} onChange={e => setQ(e.target.value)} placeholder={c.searchHint[lang]}/><button type="submit" aria-label={c.searchGo[lang]}><ArrowUpRight size={18} className="ad-direction" aria-hidden="true"/></button></form><div className="ad-topbar-tools"><LanguageSwitcher /><details className="ad-profile"><summary aria-label={c.profile[lang]}><UserRound size={18} aria-hidden="true"/></summary><div className="ad-profile-menu"><strong>{c.profile[lang]}</strong><p dir="ltr">{email}</p><Link href="/">{c.site[lang]}</Link><button onClick={onLogout}><LogOut size={16} aria-hidden="true"/>{c.logout[lang]}</button></div></details></div></header>; }
