"use client";

import { PropsWithChildren } from "react";

export type SpatialCardProps = {
  children: React.ReactNode;
  className?: string;
  hoverable?: boolean;
};

export function SpatialCard({
  children,
  className = "",
  hoverable = true,
}: PropsWithChildren<SpatialCardProps>) {
  return (
    <div
      className={`spatial-card ${hoverable ? "" : ""} ${className}`}
    >
      {hoverable && <div className="card-elevation" />}
      {children}
    </div>
  );
}