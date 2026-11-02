# Handoff Spec: Retention Radar web app

## Overview
Internal analytics workspace. Core flow: Detect (Overview) > Understand (Customer profile, explanations) > Prioritise (Intervention queue) > Intervene (assign, note, status) > Measure (outcome tracker, campaigns).

## Layout
Dark navy collapsible sidebar (232px), top bar with breadcrumb and user, amber demo banner pinned above everything, content max 1440px, 24px gutter (`--s5`).

| Breakpoint | Changes |
|---|---|
| >1100px | Sidebar expanded, 4-column KPI grid, two-column detail pages |
| 900-1100px | Grids reduce columns (see `@media (max-width: 1100px)`) |
| 600-900px | Further stacking (`max-width: 900px`) |
| <600px | Sidebar becomes a menu button, filters stack full width, tables scroll inside `.table-wrap`; no page-level horizontal scroll (verified at 375px on overview, customers, profile, interventions, cohorts) |

## Design tokens
| Token | Value | Usage |
|---|---|---|
| `--s1..--s7` | 4, 8, 12, 16, 24, 32, 48px | 4/8pt spacing rhythm |
| `--t-meta` | 12px | timestamps, helper text only |
| `--t-secondary` | 14px | table cells, key/value rows |
| `--t-body` | 16px | body, card titles |
| weights | 400 / 500 / 600 | nothing above 600 |
| risk colours | green / amber / orange / red | always paired with a text label and a shape glyph, never colour alone |

## Components and states
| Component | States covered |
|---|---|
| KPI card | value, delta vs previous period, tooltip, loading state |
| Data table | sort, pagination, empty (filtered zero) with clear-filters action, error with retry |
| Charts (line, bar, donut, heatmap) | hover tooltip, keyboard-readable labels, thinned axis labels on narrow widths |
| Intervention row | Pending, Assigned, In Progress, Contacted, Resolved, Unsuccessful; role-gated edit |
| Customer profile | scored, and "Not scored" for lapsed customers with reason |

## Motion
Web build. Motion is minimal by design: no animation on tab or page switches, tooltips and hover states only. `prefers-reduced-motion` honoured. The Expo animation skill applies to React Native and was not used because this is a web product; if a mobile companion is built, follow its press-feedback (scale 0.97, 100-150ms) and native-stack transition rules.

## Accessibility
Visible labels on all inputs; icons only where functional (search, clear, sidebar toggle); focus rings; risk never conveyed by colour alone; 44px minimum control height.

## Edge cases
Missing features are shown as unavailable rather than imputed silently; customers with one order show "n/a" for average gap; cohort cells for months not yet observed are blank, not zero.
