# Retention Radar visual release - 4 November 2026

Refreshed all ten workspaces and settings with shared typography and spacing, restrained navigation, chart sections, customer drawers, comparison tables, report previews and export history. Cohort rows open customer drill-downs. Motion respects reduced-motion preferences.

The synthetic dataset, exported model predictions, API and backend remain intact. JavaScript syntax checks and analytics reconciliation checks pass. All desktop workspaces were visually reviewed during implementation. Final mobile browser checks remain pending because browser automation became unavailable.

## Hosting

Vercel publishes only dist/. Its build runs node analytics-check.cjs. Select retention-radar as the root directory when importing the parent GitHub repository. No dependencies or secrets are needed for the hosted demo.

The included FastAPI/PostgreSQL backend is a separate local installation. Browser-local actions, simulated campaigns and demo role switching are not production database operations or authentication. See TRANSFORMATION.md for model and production limitations.
