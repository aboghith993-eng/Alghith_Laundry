"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  ChartColumn,
  CloudUpload,
  ClipboardList,
  Home,
  Lock,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  UserRound,
  WashingMachine,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useApp } from "@/lib/store";
import { canCreateOrder, canViewSettings, roleLabel } from "@/lib/permissions";
import { timeAgo } from "@/lib/format";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  visible: boolean;
  badge?: number;
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, online, syncing, pending, pendingServices, lastSync, lastError, syncNow, lock, signOut, toast } =
    useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const admin = canViewSettings(session);
  const creator = canCreateOrder(session);

  const nav = useMemo<NavItem[]>(() => {
    return [
      { href: "/home", label: "الرئيسية", icon: Home, visible: true },
      { href: "/new", label: "طلب جديد", icon: Plus, visible: creator },
      {
        href: "/orders",
        label: "الطلبات",
        icon: ClipboardList,
        visible: true,
        badge: pending,
      },
      { href: "/reports", label: "التقارير", icon: ChartColumn, visible: true },
      { href: "/settings", label: "الإعدادات", icon: Settings, visible: admin },
    ].filter((item) => item.visible);
  }, [admin, creator, pending]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const companyName =
    (session?.company as string | undefined) ||
    (typeof session?.company === "object" && session?.company
      ? String((session.company as Record<string, unknown>).name || "")
      : "") ||
    "";

  const displayName = session?.full_name || session?.name || session?.username || "المستخدم";
  const pendingTotal = pending + pendingServices;

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="topbar-inner">
          <Link href="/home" className="brand">
            <span className="brand-icon">
              <WashingMachine size={21} />
            </span>
            <span className="brand-text">
              <strong>مغسلة الغيث</strong>
              <small>{companyName || "إدارة المغسلة"}</small>
            </span>
          </Link>

          <div className="topbar-actions">
            <span className={online ? "net-chip online" : "net-chip offline"} title={online ? "متصل بالإنترنت" : "دون اتصال"}>
              {online ? <Wifi size={14} /> : <WifiOff size={14} />}
              {online ? "متصل" : "دون اتصال"}
            </span>
            <button
              type="button"
              className="sync-btn"
              onClick={() => void syncNow()}
              disabled={syncing}
              title={lastSync ? `آخر مزامنة ${timeAgo(lastSync)}` : "مزامنة البيانات"}
            >
              <CloudUpload size={18} className={syncing ? "spin" : ""} />
              {pendingTotal > 0 && <b className="sync-count">{pendingTotal}</b>}
            </button>

            <div className="menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="avatar-btn"
                onClick={() => setMenuOpen((value) => !value)}
                aria-label="قائمة المستخدم"
                aria-expanded={menuOpen}
              >
                {menuOpen ? <X size={18} /> : <UserRound size={18} />}
              </button>
              {menuOpen && (
                <div className="user-menu">
                  <div className="user-menu-head">
                    <span className="avatar large">{displayName.slice(0, 1)}</span>
                    <div>
                      <strong>{displayName}</strong>
                      <small>{roleLabel(session)}</small>
                    </div>
                  </div>
                  <div className="user-menu-status">
                    <span className={online ? "live-dot" : "live-dot off"} />
                    {online ? "متصل — المزامنة التلقائية مفعّلة" : "دون اتصال — يعمل التطبيق محلياً"}
                    <small>{lastSync ? `آخر مزامنة ${timeAgo(lastSync)}` : "لم تتم مزامنة بعد"}</small>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      void syncNow();
                    }}
                    disabled={syncing}
                  >
                    <RefreshCw size={16} className={syncing ? "spin" : ""} /> مزامنة الآن
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      lock();
                    }}
                  >
                    <Lock size={16} /> قفل التطبيق
                  </button>
                  <Link href="/account" onClick={() => setMenuOpen(false)}>
                    <UserRound size={16} /> حسابي
                  </Link>
                  {admin && (
                    <Link href="/settings" onClick={() => setMenuOpen(false)}>
                      <Settings size={16} /> الإعدادات
                    </Link>
                  )}
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      if (window.confirm("تسجيل الخروج سيمسح بيانات الجلسة من هذا الجهاز. هل تريد المتابعة؟")) {
                        signOut();
                      }
                    }}
                  >
                    <LogOut size={16} /> تسجيل الخروج
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {!online && (
          <div className="offline-bar">
            <WifiOff size={15} />
            <span>أنت دون اتصال — كل الإجراءات تُحفظ على الجهاز وتُزامَن تلقائياً عند عودة الإنترنت.</span>
          </div>
        )}
        {online && lastError && (
          <div className="sync-warning">
            <ShieldCheck size={15} />
            <span>{lastError}</span>
          </div>
        )}
      </header>

      <main className="app-main">{children}</main>

      <nav className="bottom-nav" aria-label="التنقل الرئيسي">
        {nav.map(({ href, label, icon: Icon, badge }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} className={active ? "nav-item active" : "nav-item"}>
              <span className="nav-icon">
                <Icon size={20} />
                {!!badge && badge > 0 && <b className="nav-badge">{badge > 99 ? "99+" : badge}</b>}
              </span>
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
