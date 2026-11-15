"use client";

import { PropsWithChildren } from "react";

export type GlassPanelProps = {
  children: React.ReactNode;
  className?: string;
  strong?: boolean;
};

export function GlassPanel({
  children,
  className = "",
  strong = false,
}: PropsWithChildren<GlassPanelProps>) {
  return (
    <div
      className={`glass-panel ${strong ? "glass-panel-strong" : ""} ${className}`}
    >
      {children}
    </div>
  );
}