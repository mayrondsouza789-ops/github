import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'app/api/[...path]/route.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6iUAAAAASUVORK5CYII=', 'base64');

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(resolve(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(resolve(root, 'drizzle', file), 'utf8'));
  }
  const db = {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async run() { return sqlite.prepare(sql).run(...values); },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const objects = new Map();
  const bucket = {
    async put(key, value) { objects.set(key, new Uint8Array(value)); },
    async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; },
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
    async list({ prefix = '', limit = 1000, cursor }) {
      const keys = [...objects.keys()].filter(key => key.startsWith(prefix) && (!cursor || key > cursor)).sort();
      const selected = keys.slice(0, limit);
      return { objects: selected.map(key => ({ key })), truncated: keys.length > limit, cursor: selected.at(-1) };
    },
  };
  let identity = null;
  const env = { DB: db, BUCKET: bucket };
  const exports = {};
  const context = vm.createContext({ exports, Request, Response, File, FormData, TextDecoder, TextEncoder, URL,
    Uint8Array, crypto: webcrypto,
    require(name) {
      if (name === 'cloudflare:workers') return { env };
      if (name === '../../chatgpt-auth') return { getChatGPTUser: async () => identity };
      throw new Error('Unexpected import: ' + name);
    },
  });
  vm.runInContext(compiled, context);
  return {
    env, objects,
    as(id) { identity = id ? { userId: id, displayName: id + ' name', email: id + '@example.test' } : null; },
    request(method, path, body, headers = {}) {
      const options = { method, headers: { ...(method === 'GET' ? {} : { origin: 'https://preview.example' }), ...headers } };
      if (body !== undefined) {
        options.body = typeof body === 'string' || body instanceof FormData ? body : JSON.stringify(body);
        if (!(body instanceof FormData)) options.headers['content-type'] = 'application/json';
      }
      return exports[method](new Request('https://preview.example' + path, options));
    },
    async upload(id, bytes = png, mime = 'image/png') {
      const form = new FormData();
      form.append('file', new File([bytes], 'check-in.png', { type: mime }));
      form.append('id', id);
      return this.request('POST', '/api/photos', form);
    },
  };
}

test('unauthenticated requests fail before storage access', async () => {
  const app = harness();
  app.env.DB = undefined;
  for (const [method, path] of [['GET', '/api/workspace'], ['GET', '/api/photos/photo-a'], ['GET', '/api/export'], ['GET', '/api/health'], ['PUT', '/api/workspace'], ['POST', '/api/photos'], ['DELETE', '/api/workspace'], ['DELETE', '/api/photos/photo-a']]) {
    const response = await app.request(method, path);
    assert.equal(response.status, 401, method + ' ' + path);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
});

test('workspace ownership and stale revisions prevent lost updates', async () => {
  const app = harness();
  app.as('alice');
  assert.deepEqual((await (await app.request('GET', '/api/workspace')).json()).state, null);
  assert.deepEqual(await (await app.request('PUT', '/api/workspace', { state: { notes: 'alice private', role: 'doctor' }, revision: 0 })).json(), { revision: 1 });
  assert.equal((await app.request('PUT', '/api/workspace', { state: { notes: 'stale' }, revision: 0 })).status, 409);
  assert.deepEqual(await (await app.request('PUT', '/api/workspace', { state: { notes: 'alice latest' }, revision: 1 })).json(), { revision: 2 });
  assert.equal((await app.request('PUT', '/api/workspace', { state: { notes: 'stale again' }, revision: 1 })).status, 409);
  app.as('bob');
  const empty = await (await app.request('GET', '/api/workspace')).json();
  assert.equal(empty.state, null); assert.equal(empty.revision, 0); assert.equal(empty.user.id, 'bob');
  assert.equal((await app.request('PUT', '/api/workspace', { state: { owner: 'alice', notes: 'attack' }, revision: 2 })).status, 409);
  assert.equal((await app.request('PUT', '/api/workspace', { state: { owner: 'alice', notes: 'bob own' }, revision: 0 })).status, 200);
  app.as('alice');
  assert.equal((await (await app.request('GET', '/api/workspace')).json()).state.notes, 'alice latest');
});

test('same-origin checks and reserved JSON properties are enforced', async () => {
  const app = harness(); app.as('alice');
  const data = { state: {}, revision: 0 };
  assert.equal((await app.request('PUT', '/api/workspace', data, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await app.request('PUT', '/api/workspace', data, { 'sec-fetch-site': 'cross-site' })).status, 403);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    assert.equal((await app.request('PUT', '/api/workspace', '{"state":{"nested":{"' + key + '":{}}},"revision":0}')).status, 400);
  }
  assert.equal((await app.request('PUT', '/api/workspace', '{broken')).status, 400);
  assert.equal((await app.request('PUT', '/api/workspace', { state: {}, revision: -1 })).status, 400);
  assert.equal((await app.request('PUT', '/api/workspace', { state: { large: 'x'.repeat(2 * 1024 * 1024) }, revision: 0 })).status, 413);
});

test('photos use owner scope even when two users choose the same id', async () => {
  const app = harness(); app.as('alice');
  const upload = await app.upload('shared-id'); assert.equal(upload.status, 201);
  assert.equal((await upload.json()).url, '/api/photos/shared-id');
  assert.equal((await app.upload('shared-id')).status, 409); assert.equal(app.objects.size, 1);
  app.as('bob');
  assert.equal((await app.request('GET', '/api/photos/shared-id')).status, 404);
  assert.equal((await app.upload('shared-id')).status, 201); assert.equal(app.objects.size, 2);
  const photo = await app.request('GET', '/api/photos/shared-id');
  assert.equal(photo.status, 200); assert.equal(photo.headers.get('content-type'), 'image/png');
  assert.match(photo.headers.get('cache-control'), /private, no-store/);
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);
  assert.equal((await app.upload('../alice')).status, 400);
  assert.equal((await app.upload('bad-type', Buffer.from('<svg/>'), 'image/png')).status, 415);
  assert.equal((await app.upload('bad-mime', png, 'image/jpeg')).status, 415);
});

test('individual photo deletion enforces ownership and same-origin requests', async () => {
  const app = harness();
  app.as('alice');
  assert.equal((await app.upload('alice-only')).status, 201);
  assert.equal((await app.upload('shared-id')).status, 201);
  app.as('bob');
  assert.equal((await app.upload('shared-id')).status, 201);
  assert.equal((await app.request('DELETE', '/api/photos/alice-only')).status, 404);
  assert.equal((await app.request('DELETE', '/api/photos/shared-id', undefined, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await app.request('DELETE', '/api/photos/shared-id', undefined, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal(app.objects.size, 3);
  const deleted = await app.request('DELETE', '/api/photos/shared-id');
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true, id: 'shared-id' });
  assert.equal(app.objects.size, 2);
  assert.equal((await app.request('GET', '/api/photos/shared-id')).status, 404);
  assert.equal((await app.request('DELETE', '/api/photos/shared-id')).status, 404);
  app.as('alice');
  assert.equal((await app.request('GET', '/api/photos/shared-id')).status, 200);
  assert.equal((await app.request('GET', '/api/photos/alice-only')).status, 200);
});

test('exports and confirmed deletion affect only the signed-in owner', async () => {
  const app = harness();
  for (const owner of ['alice', 'bob']) {
    app.as(owner);
    assert.equal((await app.request('PUT', '/api/workspace', { state: { notes: owner }, revision: 0 })).status, 200);
    assert.equal((await app.upload(owner + '-photo')).status, 201);
  }
  app.as('alice');
  const exported = await (await app.request('GET', '/api/export')).json();
  assert.equal(exported.state.notes, 'alice'); assert.equal(exported.photos.length, 1); assert.equal(exported.photos[0].id, 'alice-photo');
  assert.equal((await app.request('DELETE', '/api/workspace', {})).status, 400);
  assert.equal((await app.request('DELETE', '/api/workspace', { confirm: 'DELETE' })).status, 200);
  assert.equal((await (await app.request('GET', '/api/workspace')).json()).state, null);
  assert.equal((await app.request('GET', '/api/photos/alice-photo')).status, 404);
  assert.equal(app.objects.size, 1);
  app.as('bob');
  assert.equal((await (await app.request('GET', '/api/workspace')).json()).state.notes, 'bob');
  assert.equal((await app.request('GET', '/api/photos/bob-photo')).status, 200);
});

test('health verifies storage and reports unavailable bindings truthfully', async () => {
  const app = harness(); app.as('alice');
  assert.equal((await app.request('GET', '/api/health')).status, 200);
  app.env.BUCKET = undefined;
  assert.equal((await app.request('GET', '/api/health')).status, 503);
});
