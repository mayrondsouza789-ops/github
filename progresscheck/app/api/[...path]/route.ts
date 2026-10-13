import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

const MAX_JSON = 2 * 1024 * 1024;
const MAX_PHOTO = 12 * 1024 * 1024;
const PHOTO_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, oai-authenticated-user-id",
};

class ApiError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { ...PRIVATE_HEADERS, ...headers } });
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin !== null && origin !== new URL(request.url).origin) ||
      fetchSite === "cross-site" || fetchSite === "same-site" ||
      (origin === null && fetchSite !== "same-origin")) {
    throw new ApiError(403, "This action must be requested from this website.", "cross_origin");
  }
}

async function readLimited(request: Request, limit: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    throw new ApiError(413, "The request is too large.", "body_too_large");
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ApiError(413, "The request is too large.", "body_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function assertSafeDocument(value: unknown) {
  let nodes = 0;
  function visit(item: unknown, depth: number) {
    if (++nodes > 100000 || depth > 40) {
      throw new ApiError(400, "The document is too complex.", "invalid_document");
    }
    if (!item || typeof item !== "object") return;
    for (const key of Object.keys(item)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new ApiError(400, "The document contains a reserved property.", "invalid_document");
      }
      visit((item as Record<string, unknown>)[key], depth + 1);
    }
  }
  visit(value, 0);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "Send an application/json request.", "unsupported_type");
  }
  const bytes = await readLimited(request, MAX_JSON);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, "The request is not valid JSON.", "invalid_json"); }
  assertSafeDocument(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "Send a JSON object.", "invalid_document");
  }
  return value as Record<string, unknown>;
}

function imageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

async function ownerPrefix(owner: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(owner));
  return "owners/" + Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("") + "/photos/";
}

type WorkspaceRow = { state: string; revision: number; updated_at: string };
type PhotoRow = { id: string; key: string; mime: string; name: string };

async function route(request: Request): Promise<Response> {
  try {
    const user = await getChatGPTUser();
    if (!user) return json({ error: "Sign in with ChatGPT to access your workspace.", code: "unauthenticated" }, 401);
    if (request.method !== "GET") assertSameOrigin(request);
    const db = env.DB;
    const bucket = env.BUCKET;
    if (!db || !bucket) throw new ApiError(503, "Workspace storage is not connected yet.", "storage_unavailable");
    const owner = user.userId;
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    const current = () => db.prepare("SELECT state, revision, updated_at FROM workspaces WHERE owner = ?").bind(owner).first<WorkspaceRow>();

    if (path === "/api/health" && request.method === "GET") {
      await db.prepare("SELECT owner FROM workspaces WHERE owner = ? LIMIT 1").bind(owner).first();
      await bucket.list({ prefix: await ownerPrefix(owner), limit: 1 });
      return json({ ok: true, backend: "sites", authenticated: true, storage: { records: "D1", photos: "R2" } });
    }

    if (path === "/api/workspace" && request.method === "GET") {
      const row = await current();
      return json({ state: row ? JSON.parse(row.state) : null, revision: row?.revision ?? 0,
        user: { id: user.userId, name: user.displayName, email: user.email } });
    }

    if (path === "/api/workspace" && request.method === "PUT") {
      const payload = await readJson(request);
      const { state, revision } = payload;
      if (!state || typeof state !== "object" || Array.isArray(state) ||
          typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
        throw new ApiError(400, "Provide an object state and a non-negative integer revision.", "invalid_workspace");
      }
      const serialized = JSON.stringify(state);
      const updatedAt = new Date().toISOString();
      // Conditional writes prevent a stale tab from overwriting a newer save.
      const saved = revision === 0
        ? await db.prepare("INSERT INTO workspaces (owner, state, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(owner) DO NOTHING RETURNING revision")
            .bind(owner, serialized, updatedAt).first<{ revision: number }>()
        : await db.prepare("UPDATE workspaces SET state = ?, revision = revision + 1, updated_at = ? WHERE owner = ? AND revision = ? RETURNING revision")
            .bind(serialized, updatedAt, owner, revision).first<{ revision: number }>();
      if (!saved) {
        const latest = await current();
        return json({ error: "Your workspace changed in another session. Reload before saving.", code: "revision_conflict", revision: latest?.revision ?? 0 }, 409);
      }
      return json({ revision: saved.revision });
    }

    if (path === "/api/photos" && request.method === "POST") {
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
        throw new ApiError(415, "Upload a JPEG, PNG, or WebP using form data.", "unsupported_type");
      }
      const bytes = await readLimited(request, MAX_PHOTO + 64 * 1024);
      let form: FormData;
      try { form = await new Response(bytes as BodyInit, { headers: { "content-type": contentType } }).formData(); }
      catch { throw new ApiError(400, "The upload form is invalid.", "invalid_upload"); }
      if (Array.from(form.keys()).some((key) => key !== "file" && key !== "id") || form.getAll("file").length !== 1 || form.getAll("id").length > 1) {
        throw new ApiError(400, "Provide one file and an optional photo id.", "invalid_upload");
      }
      const file = form.get("file");
      const requestedId = form.get("id");
      const id = requestedId === null || requestedId === "" ? crypto.randomUUID() : requestedId;
      if (typeof id !== "string" || !PHOTO_ID.test(id)) throw new ApiError(400, "The photo id is invalid.", "invalid_photo_id");
      if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "Choose an image file.", "invalid_upload");
      if (file.size > MAX_PHOTO) throw new ApiError(413, "Photos must be 12 MB or smaller.", "photo_too_large");
      const image = new Uint8Array(await file.arrayBuffer());
      const mime = imageMime(image);
      if (!mime || (file.type && file.type !== mime)) throw new ApiError(415, "The file must contain a JPEG, PNG, or WebP image.", "unsupported_image");
      const name = file.name.split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 180).trim() || "photo";
      const key = (await ownerPrefix(owner)) + id + "/" + crypto.randomUUID();
      await bucket.put(key, image, { httpMetadata: { contentType: mime } });
      let inserted: { id: string } | null;
      try {
        inserted = await db.prepare("INSERT INTO photo_assets (owner, id, key, mime, name) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner, id) DO NOTHING RETURNING id")
          .bind(owner, id, key, mime, name).first<{ id: string }>();
      } catch (error) {
        await bucket.delete(key);
        throw error;
      }
      if (!inserted) {
        await bucket.delete(key);
        throw new ApiError(409, "A photo with that id already exists in your workspace.", "photo_conflict");
      }
      return json({ id, name, mime, size: file.size, url: "/api/photos/" + encodeURIComponent(id) }, 201);
    }

    if (path.startsWith("/api/photos/") && (request.method === "GET" || request.method === "DELETE")) {
      let id: string;
      try { id = decodeURIComponent(path.slice("/api/photos/".length)); }
      catch { throw new ApiError(400, "The photo id is invalid.", "invalid_photo_id"); }
      if (!PHOTO_ID.test(id)) throw new ApiError(400, "The photo id is invalid.", "invalid_photo_id");
      const photo = await db.prepare("SELECT id, key, mime, name FROM photo_assets WHERE owner = ? AND id = ?").bind(owner, id).first<PhotoRow>();
      if (!photo || !photo.key.startsWith(await ownerPrefix(owner))) throw new ApiError(404, "Photo not found.", "not_found");
      if (request.method === "DELETE") {
        await bucket.delete(photo.key);
        await db.prepare("DELETE FROM photo_assets WHERE owner = ? AND id = ? AND key = ?").bind(owner, id, photo.key).run();
        return json({ deleted: true, id });
      }
      const object = await bucket.get(photo.key);
      if (!object) throw new ApiError(404, "Photo not found.", "not_found");
      return new Response(object.body, { headers: { ...PRIVATE_HEADERS, "Content-Type": photo.mime,
        "Content-Disposition": "inline; filename*=UTF-8''" + encodeURIComponent(photo.name),
        "Content-Security-Policy": "default-src 'none'; sandbox" } });
    }

    if (path === "/api/export" && request.method === "GET") {
      const row = await current();
      const photos = await db.prepare("SELECT id, mime, name FROM photo_assets WHERE owner = ? ORDER BY id").bind(owner).all<{ id: string; mime: string; name: string }>();
      return json({ format: "progresscheck-workspace-v1", exportedAt: new Date().toISOString(),
        state: row ? JSON.parse(row.state) : null, revision: row?.revision ?? 0, photos: photos.results }, 200,
        { "Content-Disposition": 'attachment; filename="progresscheck-workspace.json"' });
    }

    if (path === "/api/workspace" && request.method === "DELETE") {
      const payload = await readJson(request);
      if (payload.confirm !== "DELETE") throw new ApiError(400, 'Confirm deletion with {"confirm":"DELETE"}.', "confirmation_required");
      // List only this owner's prefix, including orphaned uploads from interrupted saves.
      const prefix = await ownerPrefix(owner);
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix, limit: 1000, cursor });
        const keys = page.objects.map((object) => object.key);
        if (keys.length) await bucket.delete(keys);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      await db.batch([
        db.prepare("DELETE FROM photo_assets WHERE owner = ?").bind(owner),
        db.prepare("DELETE FROM workspaces WHERE owner = ?").bind(owner),
      ]);
      return json({ deleted: true, revision: 0 });
    }

    return json({ error: "API route not found.", code: "not_found" }, 404);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status);
    return json({ error: "The workspace service could not complete this request. Try again shortly.", code: "storage_error" }, 503);
  }
}

export const GET = route;
export const PUT = route;
export const POST = route;
export const DELETE = route;
