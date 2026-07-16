"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { SessionGate } from "../auth/SessionGate";
import { useAuthSession } from "../../state/auth-session";
import {
  navigationForRole,
  type NavigationGroup,
  type NavigationItem,
} from "../../services/role-navigation.ts";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [administrationPreference, setAdministrationPreference] = useState<boolean | null>(null);
  const { session, logout } = useAuthSession();
  const pathname = usePathname();
  const navigation = useMemo(() => navigationForRole(session.role), [session.role]);
  const administration = navigation.groups.find(group => group.collapsible);
  const primaryGroups = navigation.groups.filter(group => !group.collapsible);
  const administrationActive = administration?.items.some(item => active(item, pathname)) ?? false;
  const administrationOpen = administrationPreference ?? administrationActive;

  const hotelName = session.propertyNameZh ?? "当前酒店";
  const hotelNameEn = session.propertyNameEn ?? "Hotel property";
  const roleLabel =
    session.role === "property_ld_manager"
      ? "酒店学习与发展经理"
      : "部门培训负责人";
  const scope = session.departmentScopes[0] ?? null;
  const scopeTitle =
    session.departmentScopes.length > 1
      ? `${session.departmentScopes.length} 个授权部门分支`
      : scope?.departmentNameZh ?? "授权范围待确认";
  const scopePath = scope?.breadcrumb.join(" › ") ?? "请联系酒店学习与发展经理";

  const closeMenu = () => setMenuOpen(false);
  const signOut = async () => {
    await logout();
    window.location.assign("/login");
  };

  return (
    <SessionGate>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div className="app-shell recovery-app-shell">
        {menuOpen && (
          <button
            className="navigation-scrim"
            aria-label="关闭导航"
            onClick={closeMenu}
          />
        )}
        <aside
          id="app-navigation"
          className={`sidebar recovery-sidebar ${menuOpen ? "open" : ""}`}
          aria-label="应用导航"
        >
          {menuOpen && (
            <button
              className="sidebar-close"
              aria-label="关闭导航"
              onClick={closeMenu}
            >
              关闭
            </button>
          )}
          <div className="brand brand-signature">
            <div className="brand-mark" aria-hidden="true">
              <span>澜</span>
            </div>
            <div>
              <strong>酒店学习与发展</strong>
              <small>Hotel L&amp;D Operations</small>
            </div>
          </div>

          <nav aria-label="日常运营、周期复盘与管理设置">
            {primaryGroups.map(group => (
              <NavigationSection
                group={group}
                pathname={pathname}
                onNavigate={closeMenu}
                key={group.label}
              />
            ))}
            {administration && (
              <section className="navigation-group administration-group">
                <button
                  className="navigation-group-toggle"
                  onClick={() => setAdministrationPreference(!administrationOpen)}
                  aria-expanded={administrationOpen}
                  aria-controls="administration-navigation"
                >
                  <span>
                    <strong>{administration.label}</strong>
                    <small>{administration.en}</small>
                  </span>
                  <b aria-hidden="true">{administrationOpen ? "收起" : "展开"}</b>
                </button>
                {administrationOpen && (
                  <div id="administration-navigation" className="administration-navigation">
                    {administration.items.map(item => (
                      <NavigationLink
                        item={item}
                        pathname={pathname}
                        onNavigate={closeMenu}
                        key={item.zh}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </nav>

          <div className="sidebar-foot">
            <div className="hotel-card">
              <span aria-hidden="true">{hotelName.slice(0, 1)}</span>
              <div>
                <strong>{hotelName}</strong>
                <small>{hotelNameEn}</small>
              </div>
            </div>
          </div>
        </aside>

        <div className="main-column">
          <header className="topbar recovery-topbar">
            <button
              className="mobile-menu"
              onClick={() => setMenuOpen(value => !value)}
              aria-label={menuOpen ? "关闭导航" : "打开导航"}
              aria-expanded={menuOpen}
              aria-controls="app-navigation"
            >
              {menuOpen ? "关闭" : "导航"}
            </button>
            <div className="workspace-context">
              <small>
                {session.role === "property_ld_manager"
                  ? "当前酒店 / CURRENT PROPERTY"
                  : "授权部门范围 / AUTHORIZED SCOPE"}
              </small>
              <strong>
                {session.role === "property_ld_manager" ? hotelName : scopeTitle}
              </strong>
              <span>
                {session.role === "property_ld_manager" ? hotelNameEn : scopePath}
              </span>
            </div>
            <div className="account-cluster">
              <span className="account-avatar" aria-hidden="true">
                {session.displayName?.slice(0, 1) ?? "管"}
              </span>
              <span className="account-role">
                <strong>{session.displayName ?? roleLabel}</strong>
                <small>{roleLabel}</small>
              </span>
              <button className="logout-button" onClick={() => void signOut()}>
                退出
              </button>
            </div>
          </header>
          <main id="main-content">{children}</main>
        </div>
      </div>
    </SessionGate>
  );
}

function NavigationSection({
  group,
  pathname,
  onNavigate,
}: {
  group: NavigationGroup;
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <section className="navigation-group">
      <header>
        <strong>{group.label}</strong>
        <small>{group.en}</small>
      </header>
      <div>
        {group.items.map(item => (
          <NavigationLink
            item={item}
            pathname={pathname}
            onNavigate={onNavigate}
            key={item.zh}
          />
        ))}
      </div>
    </section>
  );
}

function NavigationLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavigationItem;
  pathname: string;
  onNavigate: () => void;
}) {
  const selected = active(item, pathname);
  return (
    <Link
      className={`nav-item ${selected ? "active" : ""}`}
      href={item.href}
      aria-current={selected ? "page" : undefined}
      onClick={onNavigate}
    >
      <span>
        <strong>{item.zh}</strong>
        <small>{item.en}</small>
      </span>
      {item.availability === "unavailable" && <em>未接入</em>}
    </Link>
  );
}

function active(item: NavigationItem, pathname: string) {
  const parsed = new URL(item.href, "https://hotel.invalid");
  if (parsed.pathname === "/") return pathname === "/";
  if (pathname !== parsed.pathname && !pathname.startsWith(`${parsed.pathname}/`)) {
    return false;
  }
  if (!parsed.search) return true;
  if (typeof window === "undefined") return false;
  const current = new URLSearchParams(window.location.search);
  return [...parsed.searchParams].every(([key, value]) => current.get(key) === value);
}
