"use client";
import Link from 'next/link';
import { LayoutDashboard, Users, CalendarDays, Search, ArrowUpRight, LogOut, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { adminContent as c, AdminLanguage } from '@/lib/admin-content';
export const adminNav = [
  { href: '/admin/dashboard', key: 'overview' as const, icon: LayoutDashboard },
  { href: '/admin/sessions', key: 'sessions' as const, icon: CalendarDays },
  { href: '/admin/participants', key: 'participants' as const, icon: Users },
];
export function Sidebar({ lang, pathname, email, onLogout, onNavigate }: {
    lang: AdminLanguage;
    pathname: string;
    email: string;
    onLogout: () => void;
    onNavigate?: () => void;
}) { return <div className="ad-sidebar-inner"><Link href="/" className="ad-logo-surface" aria-label="SkillQuest"><BrandLogo /></Link><p className="ad-workspace"><ShieldCheck size={16} aria-hidden="true"/>{c.workspace[lang]}</p><form action="/admin/participants" role="search" className="ad-drawer-search"><label htmlFor="admin-drawer-search">{c.searchHint[lang]}</label><div><input id="admin-drawer-search" name="search" maxLength={100}/><button aria-label={c.searchGo[lang]}><Search size={18} aria-hidden="true"/></button></div></form><nav aria-label={c.navigation[lang]}><p className="ad-nav-group">{c.follow[lang]}</p>{adminNav.map(item => <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={pathname.startsWith(item.href) ? 'page' : undefined}><item.icon size={18} strokeWidth={1.7} aria-hidden="true"/>{c[item.key][lang]}</Link>)}</nav><div className="ad-sidebar-foot"><Link className="ad-site-link" href="/" target="_blank" rel="noreferrer">{c.site[lang]}<ArrowUpRight size={16} className="ad-direction" aria-hidden="true"/></Link><div className="ad-user"><span className="ad-avatar" aria-hidden="true">{email.slice(0, 2).toUpperCase()}</span><div><p dir="ltr" title={email}>{email}</p><span>{c.connected[lang]}</span></div><button aria-label={c.logout[lang]} onClick={onLogout}><LogOut size={18} aria-hidden="true"/></button></div></div></div>; }
