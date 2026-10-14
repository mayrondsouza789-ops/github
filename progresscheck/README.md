# ProgressCheck

A working demonstration of photo check-ins, experimental hair-image segmentation, reports, and a mock doctor review workflow.


## Live Vercel deployment

[Open ProgressCheck](https://progresscheck.vercel.app). The guest demo saves only in the browser. Signed-in accounts save their workspace in Supabase PostgreSQL and photos in a private Supabase Storage bucket. For this mock demo, Supabase email confirmation is disabled so public accounts can be created without an email sender. Email ownership is not verified. Add custom SMTP in Supabase Authentication → Emails → SMTP Settings and re-enable confirmation before using real personal data.

Deploy from the `progresscheck` repository directory. Vercel uses `npm ci`, `npm run build:vercel`, and `.vercel/output` via `vercel.json`. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as Production server environment variables. Apply `supabase/migrations/202610140001_progresscheck.sql` to a new Supabase project before deploying, and set the Supabase Auth Site URL to `https://progresscheck.vercel.app/account.html`. Keep row level security enabled. Email confirmation is disabled only for this demo; turn it on after configuring SMTP. The publishable key is public by design, but this application only passes it to server functions. Never use a service role key in frontend code.
## Features

Browser-local guest demo with optional Sites sign-in; owner-scoped D1 records and R2 photographs for signed-in accounts; camera/file selection; file validation and duplicate checks; saved drafts; real on-device MediaPipe HairSegmenter inference; stored derived masks; same-view comparison; report downloads; mock review drafts and guidance publishing; sharing preferences; export and confirmed deletion.

## Run locally

Use Node.js 22.13 or newer. Run `npm ci`, `npm run build`, then apply the local migration:

```
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_moaning_roulette.sql
npm run dev
```

Open `http://127.0.0.1:5173/signin-with-chatgpt?return_to=%2Fworkspace.html` to use the portable starter's local development identity. Hosted authentication is supplied by Sites. Local and hosted databases are separate. On Windows with an npm shim issue, run `node scripts/run-framework.mjs build` or `node scripts/run-framework.mjs dev --hostname 127.0.0.1` after installing dependencies.

## Source

- `public/workspace.html`, `app.js`, `customer.js`, `capture.js`, `clinical.js`, `public.js`, `app.css`: UI.
- `public/ml.js`, `public/ml-worker.js`, `public/vendor/`: pinned model/runtime, licenses, and provenance.
- `app/api/[...path]/route.ts`: authenticated record/image/export/deletion APIs.
- `db/schema.ts`, `drizzle/`: schema and migration.
- `.openai/hosting.json`: Site identity and D1/R2 bindings.
- `tests/backend.test.mjs`: ownership, revisions, request limits, deletion, export, and origin checks.

Run `node --test tests/backend.test.mjs` and `npx tsc --noEmit`.

## Demonstration boundary

Doctor and administrator views operate on the same owner's demonstration workspace, not separate verified clinical roles. No clinician or email service receives information.

The model reports `100 * hair-labelled pixels / complete-image pixels`. It is not validated for scalp progress. Framing, lighting, styling and model errors affect it. There is no density, follicle count, regrowth, diagnosis, treatment assessment, alignment or automatic retraining. See `public/vendor/SOURCES.md`.

Inference runs while the browser stays open. Failed/interrupted runs retain originals and can be retried. An explicit unauthenticated API response opens the guest demo. Guest records and photographs stay in this browser, do not sync or transfer into a signed-in account, and are removed when browser data is cleared. Storage failures disable saving and uploads. Service errors and malformed account responses block access rather than silently switching to guest storage.

## Verification

A nonpatient geometric fixture completed upload, genuine inference, mask storage, report generation, mock review, guidance publication, reload persistence and download. Twenty screens passed at 390px without page overflow or script errors. CPU/GPU model execution, cancellation/retry, seven backend tests, TypeScript and production build passed. These tests do not constitute clinical validation.
