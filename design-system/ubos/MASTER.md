# UBOS Design System — Dark Premium Spatial Business OS

**Version:** 1.0.0  
**Status:** Draft — Implementation Phase  
**Project:** UBOS — Universal Business Operating System  
**Last Updated:** 2026-11-14

## 1. Brand Identity

**Name:** UBOS — Universal Business Operating System  
**Design Name:** Dark Premium Spatial Business OS  
**Visual Direction:** Dark Premium Spatial UI + Glassmorphism + Layered Depth + Floating Panels + Ambient Lighting + Central Business Intelligence Workspace  
**Tone:** Professional, sophisticated, enterprise-grade, trustworthy, calm, focused

**What this is NOT:**
- A generic flat admin template
- A gaming or futuristic sci-fi interface
- A heart-themed or romantic interface
- A visual experiment at the expense of usability

---

## 2. Spatial UI Principles

### 2.1 Core Principles

| Principle | Description |
|-----------|-------------|
| **Layered Interface** | Content exists in discrete layers with clear z-ordering. Navigation is the base layer, content panels float above, modals sit on top. |
| **Floating Workspace Panels** | Panels appear to float above the ambient background with subtle depth and elevation. |
| **Subtle 3D Depth** | Depth is achieved through shadows, blur, and subtle scale transforms — never excessive 3D rotations. |
| **Ambient Lighting** | A soft ambient glow establishes visual depth without distracting from business content. |
| **Premium Glassmorphism** | Selective use of translucent surfaces with background blur, thin borders, and controlled transparency. |
| **Central Business Intelligence Workspace** | The center of the screen presents real business metrics from actual API data — never fabricated. |

### 2.2 Layer Hierarchy

| Layer | Component | Z-Index | Characteristics |
|-------|-----------|---------|-----------------|
| 0 | Ambient background | 0 | Deep navy/charcoal, subtle gradient, static |
| 1 | Navigation shell | 10 | Semi-transparent glass, fixed position |
| 2 | Content panels | 20 | Glass or solid surfaces, floating cards |
| 3 | Overlay panels / drawers | 30 | Elevated glass, backdrop blur |
| 4 | Modals / dialogs | 40 | Solid surface, strong backdrop blur, focus trap |
| 5 | Toasts / notifications | 50 | Highest elevation, temporary |
| 6 | Focus indicators | 60 | Always on top, high contrast |

---

## 3. Color Tokens

### 3.1 Semantic Color Palette (Dark Premium)

| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg-primary` | `#0a0e17` | Primary page background (near-black) |
| `--color-bg-secondary` | `#111827` | Secondary surfaces, panel backgrounds |
| `--color-bg-surface` | `#181f2e` | Elevated surfaces, cards |
| `--color-bg-glass` | `rgba(24, 31, 46, 0.65)` | Glassmorphism surfaces |
| `--color-bg-glass-strong` | `rgba(24, 31, 46, 0.85)` | Stronger glass for modals |
| `--color-bg-input` | `#1f2937` | Form input backgrounds |
| `--color-border` | `#374151` | Subtle borders |
| `--color-border-glass` | `rgba(255, 255, 255, 0.08)` | Glass panel borders |
| `--color-border-focus` | `#60a5fa` | Focus ring color |
| `--color-text-primary` | `#f8fafc` | Primary text |
| `--color-text-secondary` | `#cbd5e1` | Secondary text |
| `--color-text-muted` | `#94a3b8` | Muted/helper text |
| `--color-text-inverse` | `#0a0e17` | Text on light/accent backgrounds |
| `--color-accent-primary` | `#3b82f6` | Primary accent (blue) |
| `--color-accent-secondary` | `#8b5cf6` | Secondary accent (violet) |
| `--color-accent-cyan` | `#06b6d4` | Restrained cyan highlight |
| `--color-success` | `#10b981` | Success states |
| `--color-warning` | `#f59e0b` | Warning states |
| `--color-error` | `#ef4444` | Error states |
| `--color-financial` | `#22d3ee` | Financial values (cyan) |
| `--color-shadow-deep` | `rgba(0, 0, 0, 0.5)` | Deep shadows |
| `--color-shadow-medium` | `rgba(0, 0, 0, 0.3)` | Medium shadows |
| `--color-shadow-soft` | `rgba(0, 0, 0, 0.2)` | Soft shadows |
| `--color-ambient-glow` | `rgba(59, 130, 246, 0.15)` | Ambient lighting accent |

### 3.2 Glassmorphism Rules

```css
.glass-panel {
  background: var(--color-bg-glass);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--color-border-glass);
  box-shadow: 0 8px 32px var(--color-shadow-deep);
}

.glass-panel-strong {
  background: var(--color-bg-glass-strong);
  backdrop-filter: blur(28px) saturate(200%);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.glass-card {
  background: rgba(24, 31, 46, 0.5);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 4px 16px var(--color-shadow-medium);
}
```

**Glassmorphism restrictions:**
- NOT on data-heavy tables, accounting statements, or financial forms
- NOT on small text or dense information panels
- Use only for navigation shells, overview cards, and decorative containers
- Text on glass must maintain 4.5:1 contrast minimum

---

## 4. Typography

### 4.1 Font Stack

| Role | Font Family | Weights | Usage |
|------|-------------|---------|-------|
| UI Sans | Inter | 400, 500, 600, 700 | Body, headings, navigation |
| Data Mono | JetBrains Mono | 400, 500 | Financial values, codes, labels |
| Display | Plus Jakarta Sans | 600, 700, 800 | Page titles, hero text |

### 4.2 Type Scale

| Token | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| `--text-xs` | 0.75rem (12px) | 400 | 1.4 | Captions, helper text |
| `--text-sm` | 0.875rem (14px) | 400 | 1.5 | Body text, table content |
| `--text-base` | 1rem (16px) | 400 | 1.6 | Primary body |
| `--text-lg` | 1.125rem (18px) | 500 | 1.5 | Subheadings |
| `--text-xl` | 1.25rem (20px) | 600 | 1.4 | Section titles |
| `--text-2xl` | 1.5rem (24px) | 700 | 1.3 | Page titles |
| `--text-3xl` | 1.875rem (30px) | 700 | 1.2 | H1 headings |
| `--text-4xl` | 2.25rem (36px) | 800 | 1.1 | Hero/display text |

### 4.3 Financial Number Typography

| Token | Size | Weight | Family | Usage |
|-------|------|--------|--------|-------|
| `--financial-sm` | 0.875rem | 500 | JetBrains Mono | Small monetary values |
| `--financial-base` | 1rem | 500 | JetBrains Mono | Standard monetary values |
| `--financial-lg` | 1.25rem | 600 | JetBrains Mono | Prominent totals |
| `--financial-xl` | 1.5rem | 700 | JetBrains Mono | Key metrics in overview |

**Rule:** Financial values always use monospace for digit alignment. Never use display fonts for currency.

---

## 5. Spacing

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 0.25rem (4px) | Tight spacing, form element gaps |
| `--space-2` | 0.5rem (8px) | Component padding, touch target gaps |
| `--space-3` | 0.75rem (12px) | Card internal padding, list gaps |
| `--space-4` | 1rem (16px) | Section padding, component margins |
| `--space-5` | 1.25rem (20px) | Large section gaps |
| `--space-6` | 1.5rem (24px) | Panel margins, major section spacing |
| `--space-8` | 2rem (32px) | Page-level padding, hero spacing |
| `--space-10` | 2.5rem (40px) | Major layout divisions |
| `--space-12` | 3rem (48px) | Full-page section spacing |

**Touch rule:** Minimum 8px gap between touch targets (WCAG 2.2 AA). Minimum touch target 44×44px.

---

## 6. Layout Rules

### 6.1 Breakpoints

| Token | Value | Device |
|-------|-------|--------|
| `--bp-mobile` | 375px | Mobile small |
| `--bp-mobile-lg` | 390px | Mobile large |
| `--bp-tablet` | 768px | Tablet |
| `--bp-laptop` | 1024px | Laptop / small desktop |
| `--bp-desktop` | 1440px | Desktop |

### 6.2 Layout Patterns

- **Desktop (≥1024px):** Fixed left navigation (260px), top header (64px), main content area fills remaining space, central business workspace prominent
- **Tablet (768px–1023px):** Collapsible navigation, header 56px, content stacks vertically when narrow
- **Mobile (<768px):** Bottom navigation or hamburger, full-width panels stacked, no fixed sidebars

### 6.3 Container Widths

| Token | Value |
|-------|-------|
| `--container-sm` | 640px |
| `--container-md` | 768px |
| `--container-lg` | 1024px |
| `--container-xl` | 1280px |
| `--container-full` | 100% |

---

## 7. Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 4px | Small elements, badges |
| `--radius-base` | 6px | Inputs, buttons, table cells |
| `--radius-md` | 8px | Cards, panels |
| `--radius-lg` | 12px | Large cards, modals |
| `--radius-xl` | 16px | Prominent containers |
| `--radius-full` | 9999px | Pills, avatars |

---

## 8. Shadows & Elevation

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-xs` | 0 1px 2px rgba(0,0,0,0.05) | Subtle elevation |
| `--shadow-sm` | 0 4px 6px rgba(0,0,0,0.1) | Card hover |
| `--shadow-md` | 0 8px 24px rgba(0,0,0,0.15) | Floating panels |
| `--shadow-lg` | 0 16px 48px rgba(0,0,0,0.25) | Modals, drawers |
| `--shadow-glass` | 0 8px 32px rgba(0,0,0,0.4) | Glass panels |

---

## 9. Components

### 9.1 Buttons

| Variant | Background | Text | Border | Hover |
|---------|-----------|------|--------|-------|
| Primary | `--color-accent-primary` | White | None | `--color-accent-primary` +8% brightness |
| Secondary | `--color-bg-surface` | `--color-text-primary` | `--color-border` | `--color-border` brighter |
| Ghost | Transparent | `--color-text-secondary` | None | `--color-bg-secondary` |
| Danger | `--color-error` | White | None | `--color-error` +8% brightness |

**Specs:** Height 40px (sm) / 44px (md), padding 0–1.5rem, radius `--radius-base`, font weight 500, all buttons have visible focus rings.

### 9.2 Inputs

| Property | Value |
|----------|-------|
| Background | `--color-bg-input` |
| Border | 1px solid `--color-border` |
| Border radius | `--radius-base` |
| Height | 40px |
| Padding | 0 12px |
| Font size | 0.875rem |
| Focus border | `--color-accent-primary` |
| Focus ring | 0 0 0 3px `rgba(59, 130, 246, 0.2)` |

### 9.3 Cards

- **Glass card:** `bg rgba(24,31,46,0.5)`, `backdrop-filter: blur(12px)`, `border: 1px solid rgba(255,255,255,0.06)`
- **Solid card:** `bg var(--color-bg-surface)`, `border: 1px solid var(--color-border)`
- **Metric card:** Glass card with prominent financial value, subtle icon, trend indicator

### 9.4 Tables

- **Background:** `--color-bg-surface` (NOT glass — readability priority)
- **Border:** 1px solid `--color-border`
- **Header background:** `--color-bg-secondary`
- **Header text:** `--color-text-secondary`, uppercase, 0.75rem, letter-spacing 0.05em
- **Row hover:** `--color-bg-glass` subtle
- **Zebra striping:** Optional, very subtle
- **Financial columns:** Monospace font, right-aligned

### 9.5 Navigation

- **Sidebar:** Fixed width 260px, `bg var(--color-bg-secondary)`, glass effect, border-right 1px solid `--color-border`
- **Nav items:** Height 44px, padding 0 1rem, radius `--radius-md` on active, transition background 150ms
- **Active state:** `bg var(--color-accent-primary)` with 10% opacity, left border accent
- **Collapsed state:** Width 72px, icon-only, tooltip on hover

### 9.6 Modals & Drawers

- **Modal backdrop:** `rgba(0,0,0,0.6)`, `backdrop-filter: blur(8px)`
- **Modal surface:** `bg var(--color-bg-surface)`, `border: 1px solid var(--color-border)`, `shadow-lg`
- **Drawer:** Same as modal but slides from right, width 420px desktop, full height mobile
- **Focus management:** Trap focus inside modal, return focus on close

### 9.7 Alerts & Toasts

| Variant | Background | Text | Border | Icon |
|---------|-----------|------|--------|------|
| Success | `rgba(16, 185, 129, 0.1)` | `--color-success` | `rgba(16, 185, 129, 0.3)` | Checkmark |
| Warning | `rgba(245, 158, 11, 0.1)` | `--color-warning` | `rgba(245, 158, 11, 0.3)` | Alert triangle |
| Error | `rgba(239, 68, 68, 0.1)` | `--color-error` | `rgba(239, 68, 68, 0.3)` | Exclamation |
| Info | `rgba(59, 130, 246, 0.1)` | `--color-accent-primary` | `rgba(59, 130, 246, 0.3)` | Information |

### 9.8 Loading States

- **Skeleton:** Pulse animation on `--color-bg-secondary` to `--color-bg-surface`
- **Spinner:** 24×24px, 2px stroke, `--color-accent-primary`, 0.8s linear infinite
- **Page loading:** Centered spinner + subtle text, no full-page overlays for partial loads

### 9.9 Empty States

- **Icon:** 48×48px, muted color
- **Heading:** `--text-xl`, `--color-text-primary`
- **Description:** `--text-sm`, `--color-text-muted`
- **Action:** Primary button if applicable

---

## 10. Central Business Intelligence Workspace

The central workspace is the focal point of the dashboard. It presents:

| Metric | Source | Format |
|--------|--------|--------|
| Sales invoiced | `/business/reports/summary` | Financial (monospace, currency) |
| Customer balances | `/business/reports/summary` | Financial |
| Purchases received | `/business/reports/summary` | Financial |
| Supplier balances | `/business/reports/summary` | Financial |
| Units in stock | `/business/reports/summary` | Integer |
| Inventory at cost | `/business/reports/summary` | Financial |
| Low stock items | `/business/reports/summary` | List with count |
| Recent activity | `/business/inventory/movements` | Timestamped list |

**Rules:**
- Never fabricate metrics — only display data from real API responses
- Show loading state while data is fetching
- Show empty state when no data exists
- Show error state on API failure
- Financial values use monospace typography

---

## 11. Responsive Rules

| Breakpoint | Navigation | Panels | Tables | Central Workspace |
|------------|-----------|--------|--------|-------------------|
| ≥1440px | Fixed sidebar, full header | Floating glass panels | Full columns | Full layout |
| 1024–1439px | Fixed sidebar, compact header | Glass panels, reduced blur | Full columns | Full layout |
| 768–1023px | Collapsible sidebar | Stacked panels | Horizontal scroll | Stacked cards |
| 390–767px | Bottom nav / hamburger | Full-width stacked | Stacked rows | Single column |
| 375px | Bottom nav / hamburger | Full-width stacked | Stacked rows | Single column |

**Mobile conversion:**
- Sidebar → Bottom tab bar or hamburger menu
- Floating panels → Full-width cards stacked vertically
- Tables → Card-based list view
- Multi-column grids → Single column

---

## 12. Accessibility Rules (WCAG 2.2 AA)

| Requirement | Specification |
|-------------|---------------|
| Color contrast | 4.5:1 normal text, 3:1 large text, 3:1 UI components |
| Focus visible | 2–4px ring, `--color-border-focus`, never removed |
| Touch targets | Minimum 44×44px, 8px spacing |
| Keyboard navigation | Tab order matches visual order, no traps |
| ARIA labels | All icon buttons, custom controls |
| Form labels | Visible `<label>` with `for` attribute, never placeholder-only |
| Error announcements | `role="alert"` for errors, `role="status"` for success |
| Reduced motion | Respect `prefers-reduced-motion`, disable animations |
| Screen readers | Semantic HTML, logical heading hierarchy (h1→h6) |
| Skip links | "Skip to main content" for keyboard users |
| Glass text | Never place low-contrast text on glass surfaces |

---

## 13. Motion Guidelines

| Transition | Duration | Easing | Usage |
|------------|----------|--------|-------|
| Page enter | 300ms | ease-out | New page load |
| Panel entrance | 200ms | ease-out | Panel appears |
| Hover elevation | 150ms | ease-out | Card/button hover |
| Focus state | 150ms | ease-out | Keyboard focus |
| Modal open | 250ms | ease-out | Modal appears |
| Drawer slide | 300ms | ease-out | Drawer enters |
| Loading fade | 200ms | ease-in-out | Loading state |

**Restrictions:**
- No constant moving backgrounds
- No unnecessary 3D rotations
- No animation that interferes with data entry
- Respect `prefers-reduced-motion` — reduce or disable all animations
- No autoplaying video or audio

---

## 14. Implementation Notes

### 14.1 CSS Strategy

- CSS custom properties (variables) for all design tokens
- No arbitrary hardcoded values in components
- Tailwind-compatible class naming where applicable
- Dark mode only — no light mode toggle needed

### 14.2 Component Boundaries

- Reuse existing components where appropriate
- Avoid creating duplicates of existing functionality
- Preserve all existing API contracts and data shapes
- Maintain server/client component boundaries

### 14.3 Backend Preservation

- No changes to API contracts
- No changes to authentication (session cookies)
- No changes to RBAC/permissions
- No changes to financial policies (OPS-08)
- No database modifications

---

## 15. File Structure

```
design-system/
  ubos/
    MASTER.md          # This document
    tokens.css         # CSS custom properties
    components.css     # Component-level styles
apps/web/src/
  app/
    layout.tsx         # Root layout with shell
    page.tsx           # Auth + dashboard entry
    globals.css        # Global styles (updated)
    components/        # Spatial UI components
      SpatialAppShell.tsx
      SpatialSidebar.tsx
      WorkspaceHeader.tsx
      BusinessIntelligenceWorkspace.tsx
      GlassPanel.tsx
      SpatialCard.tsx
      MetricCard.tsx
      DataTable.tsx
      ...
  business-operations.tsx  # Existing, preserved API integration
```