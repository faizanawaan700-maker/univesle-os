"use client";

import { PropsWithChildren } from "react";

export type BusinessIntelligenceWorkspaceProps = {
  children: React.ReactNode;
  className?: string;
  loading?: boolean;
  error?: string | null;
};

export function BusinessIntelligenceWorkspace({
  children,
  className = "",
  loading = false,
  error = null,
}: PropsWithChildren<BusinessIntelligenceWorkspaceProps>) {
  if (loading) {
    return (
      <div className="glass-panel" style={{ padding: "var(--space-6)", minHeight: "400px" }}>
        <div className="loading-state">
          <div className="spinner" />
          <div>Loading business intelligence…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel" style={{ padding: "var(--space-6)", minHeight: "400px" }}>
        <div className="alert error">{error}</div>
      </div>
    );
  }

  return (
    <div className={`glass-panel ${className}`} style={{ padding: "var(--space-6)", minHeight: "400px" }}>
      {children}
    </div>
  );
}