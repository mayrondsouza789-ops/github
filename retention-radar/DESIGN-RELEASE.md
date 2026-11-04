# Retention Radar — product interface release

## Design
Warm neutral surfaces, dark ink typography, forest interaction accents, grouped navigation, a radar identity, readable typographic KPI bands, and a shared table/form/board system across all ten workspaces and settings. Existing data relationships, ML outputs and API contracts are preserved.

Charts use bounded cubic segments through actual data points, responsive SVGs, keyboard-focusable points and custom hover/focus tooltips. Metric transitions settle in 420 ms, retain the final accessible value, and skip unchanged values. Reduced-motion preferences disable animation. The sidebar remembers its collapsed state. Mobile navigation provides a scrim, Escape dismissal and keyboard focus containment.

## Verification
- JavaScript syntax and analytics reconciliation checks passed.
- All eleven screens rendered at desktop and 390 px mobile widths without page-level horizontal overflow; tables scroll within their containers.
- Overview checked at 820 px tablet width.
- Exact customer search, no-results recovery, customer profile, keyboard cohort drill-down, revenue cohort view, analytical question, action board/table, model tabs, sidebar collapse and CSV download verified in the browser.
- Fixed Enter opening and immediately closing cohort drawers by preventing the key default action before moving focus.
- No browser console errors were reported during the checks.

## Hosting boundaries
The public Vercel build serves the synthetic demonstration in dist/. Operations remain browser-local. The included FastAPI/PostgreSQL backend remains a separate installation; it is not deployed with the static frontend. See TRANSFORMATION.md for model and production limitations.
