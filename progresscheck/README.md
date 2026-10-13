# ProgressCheck

A working demonstration of photo check-ins, experimental hair-image segmentation, reports, and a mock doctor review workflow.

## Features

Browser-local guest demo with optional Sites sign-in; owner-scoped D1 records and R2 photographs for signed-in accounts; camera/file selection; file validation and duplicate checks; saved drafts; real on-device MediaPipe HairSegmenter inference; stored derived masks; same-view comparison; report downloads; mock review drafts and guidance publishing; sharing preferences; export and confirmed deletion.

## Deployment status

The working demo is deployed at [ProgressCheck](https://progresscheck-hair-journal.fitcove4.chatgpt.site). It is public and works without signing in. Guest records stay in the current browser; optional sign-in opens a separate account workspace. Sites supplies hosted identity and Cloudflare D1/R2 storage. GitHub contains the source; GitHub Pages alone does not run this backend.

## Run locally

Use Node.js 22.13 or newer. Run `npm ci`, `npm run build`, then apply the local migration:

`npm ci` runs a postinstall step that downloads six pinned MediaPipe model/runtime files (about 20 MB) from the documented official model host and package CDN. Each file must match its committed SHA-256 and size before it is installed. Verified existing files are reused. The download origins receive no photographs. These generated assets are excluded from Git; licenses and provenance remain tracked.

If installation is interrupted, network access fails, or lifecycle scripts were disabled, run `npm run setup:model` before building. A failed integrity check preserves the existing file and makes the command fail. Do not bypass checksum failures; restore the source or investigate the pinned upstream asset. See `public/vendor/SOURCES.md` for exact versions, origins and hashes.

```
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_moaning_roulette.sql
npm run dev
```

Open `http://127.0.0.1:5173/signin-with-chatgpt?return_to=%2Fworkspace.html` to use the portable starter's local development identity. Hosted authentication is supplied by Sites. Local and hosted databases are separate. On Windows with an npm shim issue, run `node scripts/run-framework.mjs build` or `node scripts/run-framework.mjs dev --hostname 127.0.0.1` after installing dependencies.

## Source

- `public/workspace.html`, `app.js`, `customer.js`, `capture.js`, `clinical.js`, `public.js`, `app.css`: UI.
- `public/ml.js`, `public/ml-worker.js`: on-device inference module.
- `scripts/setup-model.mjs`: pinned download manifest and integrity-checked asset setup.
- `public/vendor/`: downloaded runtime/model assets plus tracked licenses and provenance.
- `app/api/[...path]/route.ts`: authenticated record/image/export/deletion APIs.
- `db/schema.ts`, `drizzle/`: schema and migration.
- `.openai/hosting.json`: Site identity and D1/R2 bindings.
- `tests/backend.test.mjs`: ownership, revisions, request limits, deletion, export, and origin checks.

Run `node --test tests/backend.test.mjs tests/setup-model.test.mjs` and `npx tsc --noEmit`. The setup tests use synthetic bytes and no network; the setup command downloads the actual pinned assets only when missing or mismatched.

## Demonstration boundary

Doctor and administrator views operate on the same owner's demonstration workspace, not separate verified clinical roles. No clinician or email service receives information.

The model reports `100 * hair-labelled pixels / complete-image pixels`. It is not validated for scalp progress. Framing, lighting, styling and model errors affect it. There is no density, follicle count, regrowth, diagnosis, treatment assessment, alignment or automatic retraining. See `public/vendor/SOURCES.md`.

Inference runs while the browser stays open. Failed/interrupted runs retain originals and can be retried. An explicit unauthenticated API response opens the guest demo. Guest records and photographs stay in this browser, do not sync or transfer into a signed-in account, and are removed when browser data is cleared. Storage failures disable saving and uploads. Service errors and malformed account responses block access rather than silently switching to guest storage.

## Verification

A nonpatient geometric fixture completed upload, genuine inference, mask storage, report generation, mock review, guidance publication, reload persistence and download. Twenty screens passed at 390px without page overflow or script errors. CPU/GPU model execution, cancellation/retry, seven backend tests, TypeScript and production build passed. These tests do not constitute clinical validation.
