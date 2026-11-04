# V2 verification

V2 syntax, calculation reconciliation, and API integration checks passed. Browser checks covered grounded product analytics, model diagnostics, saved customer views, expanded columns, selection, bulk action creation, and board rendering. Phone-sized action-board layout was inspected at 390px; no horizontal document overflow was detected. The desktop overview was visually inspected. Full requirements and verification gaps are recorded in TRANSFORMATION.md.

# Build verification — 1 November 2026

Passed:

- JavaScript syntax and Python compilation.
- Seed generation: 5,000 fictional customers, 11,081 orders, six product cycles.
- Logistic Regression versus Random Forest with chronological, customer-disjoint train/validation/test sets.
- Model selected by validation PR-AUC: Random Forest. Held-out test precision 86.7%, recall 92.1%, F1 89.3%, ROC-AUC 87.7%, PR-AUC 97.3%; these are synthetic-data results.
- FastAPI integration check: login, invalid credentials, token requirement, analyst write denial, pagination validation, customer filtering, relational histories, intervention create/update, campaign create/simulate, CSV export, prediction inference.
- Browser walkthrough: overview loads dataset-derived metrics; all ten sections open; exact customer-ID search returns one record; profile shows purchase and support history, risk factors, and action rationale; creating an assigned intervention updates the operational workspace; campaign simulation produces labelled results; summary CSV download completes.
- No browser error logs during the navigation walkthrough.

Verification limits:

- API integration checks used isolated SQLite with the same SQLAlchemy models. PostgreSQL/Docker are not installed in this environment, so Compose/PostgreSQL execution is not verified.
- Static hosting publishes the interactive demo, not the Python server. Its intervention and campaign records are browser-local. Full-stack setup and authentication are included in the source.
- Responsive CSS was implemented, but a dedicated mobile-device browser walkthrough was not performed.
- No real CRM, outbound communication, customer records, or controlled intervention experiment is connected.

See README.md for metric definitions, model scope, configuration, and production prerequisites.
