"use client";

import { useState } from "react";
import { SpatialSidebar } from "./SpatialSidebar";
import { WorkspaceHeader } from "./WorkspaceHeader";

type AppShellProps = {
  children: React.ReactNode;
  user: { name: string; email: string } | null;
  onSignOut: () => void;
};

export function SpatialAppShell({
  children,
  user,
  onSignOut,
}: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const initials =
    user?.name
      .split(" ")
      .map((p) => p[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U";

  return (
    <div className="app-shell" style={{ background: "var(--color-bg-primary)", minHeight: "100vh" }}>
      <div className="ambient-bg" />
      {user && (
        <WorkspaceHeader
          user={{ name: user.name, email: user.email, initials }}
          onSignOut={onSignOut}
        />
      )}
      <main className="main-panel" style={{ padding: "var(--space-4)" }}>
        {children}
      </main>
    </div>
  );
}