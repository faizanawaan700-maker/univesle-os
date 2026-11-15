"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

type NavItem = {
  href: string;
  label: string;
  icon: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: "📊" },
  { href: "/products", label: "Products", icon: "📦" },
  { href: "/inventory", label: "Inventory", icon: "📋" },
  { href: "/customers", label: "Customers", icon: "👥" },
  { href: "/suppliers", label: "Suppliers", icon: "🏢" },
  { href: "/sales", label: "Sales", icon: "💰" },
  { href: "/purchases", label: "Purchases", icon: "🛒" },
  { href: "/payments", label: "Payments", icon: "💳" },
  { href: "/analytics", label: "Analytics", icon: "📈" },
  { href: "/audit", label: "Audit History", icon: "📜" },
  { href: "/branches", label: "Branches", icon: "🏢" },
  { href: "/accounting", label: "Accounting", icon: "🧾" },
  { href: "/team", label: "Team", icon: "👤" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export type SpatialSidebarProps = {
  className?: string;
  collapsed?: boolean;
};

export function SpatialSidebar({
  className = "",
  collapsed = false,
}: SpatialSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  return (
    <aside
      className={`sidebar ${className} ${collapsed && !isOpen ? "" : "open"}`}
      style={
        collapsed && !isOpen ? { transform: "translateX(-100%)" } : {}
      }
    >
      <div className="sidebar-brand">
        <div className="brand-mark">U</div>
        <div className="brand-text">UBOS</div>
      </div>
      <nav className="sidebar-nav" role="navigation" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.href}
            className="nav-item"
            onClick={() => {
              if (collapsed) setIsOpen(false);
            }}
          >
            <span className="nav-item-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button
          className="nav-item"
          onClick={toggle}
          title={isOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          <span className="nav-item-icon">◀</span>
          <span className="nav-label">
            {isOpen ? "Collapse" : "Expand"}
          </span>
        </button>
      </div>
    </aside>
  );
}