import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { setupModel } from '../scripts/setup-model.mjs';

const bytes = Buffer.from('Synthetic setup test asset.');
const fixture = { name: 'fixture.wasm', url: 'https://example.invalid/fixture.wasm', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const silent = () => {};
const testRoot = fileURLToPath(new URL('../.sites-runtime/model-setup-tests/', import.meta.url));
async function freshDirectory() {
  await mkdir(testRoot, { recursive: true });
  return mkdtemp(join(testRoot, 'progresscheck-model-'));
}
async function cleanup(destination) {
  const target = resolve(destination);
  assert.equal(dirname(target), resolve(testRoot));
  assert.ok(basename(target).startsWith('progresscheck-model-'));
  await rm(target, { recursive: true, force: true });
}

test('missing assets are verified before installation and valid assets skip downloads', async () => {
  const destination = await freshDirectory();
  let requests = 0;
  try {
    const fetchImpl = async () => { requests++; return new Response(bytes); };
    const installed = await setupModel(destination, { assets: [fixture], fetchImpl, log: silent });
    assert.equal(installed[0].status, 'downloaded');
    assert.deepEqual(await readFile(join(destination, fixture.name)), bytes);
    const verified = await setupModel(destination, { assets: [fixture], fetchImpl, log: silent });
    assert.equal(verified[0].status, 'verified');
    assert.equal(requests, 1);
    await writeFile(join(destination, fixture.name), 'Corrupted previous asset.');
    const repaired = await setupModel(destination, { assets: [fixture], fetchImpl, log: silent });
    assert.equal(repaired[0].status, 'downloaded');
    assert.equal(requests, 2);
    assert.deepEqual(await readFile(join(destination, fixture.name)), bytes);
  } finally { await cleanup(destination); }
});

test('checksum failure preserves the previous file and removes partial downloads', async () => {
  const destination = await freshDirectory();
  const previous = Buffer.from('Previous asset remains until verified replacement.');
  try {
    await writeFile(join(destination, fixture.name), previous);
    await assert.rejects(setupModel(destination, { assets: [{ ...fixture, sha256: '0'.repeat(64) }], fetchImpl: async () => new Response(bytes), log: silent }), /Integrity check failed/);
    assert.deepEqual(await readFile(join(destination, fixture.name)), previous);
    assert.deepEqual(await readdir(destination), [fixture.name]);
  } finally { await cleanup(destination); }
});

test('failed downloads leave no new target or partial file and can be retried', async () => {
  const destination = await freshDirectory();
  try {
    await assert.rejects(setupModel(destination, { assets: [fixture], fetchImpl: async () => new Response('Unavailable', { status: 503 }), log: silent }), /HTTP 503/);
    assert.deepEqual(await readdir(destination), []);
    const installed = await setupModel(destination, { assets: [fixture], fetchImpl: async () => new Response(bytes), log: silent });
    assert.equal(installed[0].status, 'downloaded');
  } finally { await cleanup(destination); }
});
