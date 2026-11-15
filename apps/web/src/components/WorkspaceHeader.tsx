"use client";

import { useState } from "react";

type UserProfile = {
  name: string;
  email: string;
  initials: string;
};

export type WorkspaceHeaderProps = {
  user: UserProfile | null;
  onSignOut: () => void;
  className?: string;
};

export function WorkspaceHeader({
  user,
  onSignOut,
  className = "",
}: WorkspaceHeaderProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const initials =
    user?.initials ||
    user?.name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U";

  return (
    <header className={`topbar ${className}`}>
      <div className="topbar-left">
        <button
          className="btn btn-ghost btn-sm"
          aria-label="Toggle navigation"
        >
          ☰
        </button>
        <div className="brand-mark" style={{ background: "transparent", boxShadow: "none", width: "auto", height: "auto", fontSize: "17px" }}>
          U
        </div>
        <span className="brand-text" style={{ fontSize: "var(--text-lg)" }}>UBOS</span>
      </div>
      <div className="topbar-right">
        {user ? (
          <div className="user-profile" onClick={() => setUserMenuOpen(!userMenuOpen)}>
            <div className="user-avatar">{initials}</div>
            <div className="user-meta">
              <div className="user-name">{user.name}</div>
              <div className="user-email">{user.email}</div>
            </div>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={onSignOut}>
            Sign in
          </button>
        )}
        <button className="notification-bell" aria-label="Notifications">
          🔔
        </button>
      </div>
    </header>
  );
}