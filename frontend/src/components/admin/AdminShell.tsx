"use client";
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { adminContent as c } from '@/lib/admin-content';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Skeleton } from './Skeleton';
interface AdminUser {
    id: string;
    email: string;
    role: string;
}
export function AdminShell({ children }: {
    children: React.ReactNode;
}) {
    const router = useRouter(), pathname = usePathname(), { lang } = useLanguage();
    const [admin, setAdmin] = useState<AdminUser | null>(null), [loading, setLoading] = useState(true), [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [logoutFailed, setLogoutFailed] = useState(false), [loggingOut, setLoggingOut] = useState(false);
    const drawer = useRef<HTMLDialogElement>(null);
    useEffect(() => { let active = true; void fetch('/api/admin/me', { cache: 'no-store' }).then(async (res) => { if (!res.ok)
        throw Error(); const data = await res.json(); if (!data.admin)
        throw Error(); if (active)
        setAdmin(data.admin); }).catch(() => { if (active)
        router.replace('/admin/login'); }).finally(() => { if (active)
        setLoading(false); }); return () => { active = false; }; }, [router]);
    useEffect(() => { if (mobileMenuOpen && !drawer.current?.open)
        drawer.current?.showModal();
    else if (!mobileMenuOpen && drawer.current?.open)
        drawer.current.close(); }, [mobileMenuOpen]);
    useEffect(() => { const media = matchMedia('(min-width:1100px)'); const close = () => { if (media.matches)
        setMobileMenuOpen(false); }; media.addEventListener('change', close); return () => media.removeEventListener('change', close); }, []);
    async function logout() {
        if (loggingOut) return;
        setLoggingOut(true); setLogoutFailed(false);
        try {
            const response = await fetch('/api/admin/logout', { method: 'POST' });
            if (!response.ok) throw Error();
            setAdmin(null); router.replace('/admin/login');
        } catch { setLogoutFailed(true); }
        finally { setLoggingOut(false); }
    }
    if (loading || !admin)
        return <div className="ad-auth-loading"><Skeleton label={c.loading[lang]}/></div>;
    return <div className="ad-shell"><a href="#admin-content" className="skip-link">{c.skip[lang]}</a><aside className="ad-sidebar"><Sidebar lang={lang} pathname={pathname} email={admin.email} onLogout={logout}/></aside><div className="ad-workarea"><Topbar lang={lang} pathname={pathname} email={admin.email} menuOpen={mobileMenuOpen} onMenu={() => setMobileMenuOpen(true)} onLogout={logout}/><section id="admin-content" tabIndex={-1} aria-label={c.content[lang]} className="admin-content ad-content">{logoutFailed && <p role="alert" className="ad-privacy">{lang === "ar" ? "لم تتأكد عملية تسجيل الخروج. حاول مجددا لإغلاق الجلسة على الخادم." : "Déconnexion non confirmée. Réessayez pour fermer la session sur le serveur."}</p>}{children}</section></div><dialog ref={drawer} id="admin-navigation-drawer" className="admin-drawer ad-navigation-drawer" aria-label={c.navigation[lang]} onCancel={() => setMobileMenuOpen(false)} onClose={() => setMobileMenuOpen(false)} onClick={e => { const b = e.currentTarget.getBoundingClientRect(); if (e.target === e.currentTarget && (e.clientX < b.left || e.clientX > b.right))
        setMobileMenuOpen(false); }}><button className="ad-drawer-close ad-icon-button" onClick={() => setMobileMenuOpen(false)} aria-label={c.close[lang]}><X size={20} aria-hidden="true"/></button><Sidebar lang={lang} pathname={pathname} email={admin.email} onLogout={logout} onNavigate={() => setMobileMenuOpen(false)}/></dialog></div>;
}
