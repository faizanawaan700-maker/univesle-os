"use client";

import { PropsWithChildren } from "react";

export type MetricCardProps = {
  value: string;
  label: string;
  trend?: "positive" | "negative" | "neutral";
  trendValue?: string;
  icon?: React.ReactNode;
  className?: string;
};

export function MetricCard({
  value,
  label,
  trend,
  trendValue,
  icon,
  className = "",
}: MetricCardProps) {
  return (
    <div className={`metric-card ${className}`}>
      {icon && <div className="metric-icon">{icon}</div>}
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      {trend && trendValue && (
        <span className={`metric-trend ${trend}`}>
          {trend === "positive" ? "↑" : trend === "negative" ? "↓" : "→"}
          {trendValue}
        </span>
      )}
    </div>
  );
}