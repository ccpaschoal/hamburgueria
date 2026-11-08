import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { criarSessao, sessaoValida } from '../src/auth.js';

const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => ({ n: 0 }) }) }) } };
const login = body => new Request('https://api.test/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

test('sessão não aceita segmentos extras nem chave curta', async () => {
  const key = 'k'.repeat(40), now = Date.now();
  const token = await criarSessao(key, now);
  assert.equal(await sessaoValida(key, token + '.extra', now), false);
  assert.equal(await sessaoValida('curta', token, now), false);
});

test('JSON deve ser objeto e limite é contado em bytes UTF-8', async () => {
  for (const body of ['null', '[]', '"texto"']) {
    assert.equal((await worker.fetch(login(body), env)).status, 400);
  }
  const body = JSON.stringify({ senha: 'á'.repeat(9000) });
  assert.equal((await worker.fetch(login(body), env)).status, 413);
});

test('corpo em fluxo é cancelado ao ultrapassar o limite', async () => {
  let chunks = 0, cancelled = false;
  const body = new ReadableStream({ pull(c) { if (chunks >= 20) return c.close(); chunks++; c.enqueue(new Uint8Array(4096)); }, cancel() { cancelled = true; } });
  const req = new Request('https://api.test/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half' });
  assert.equal((await worker.fetch(req, env)).status, 413);
  assert.equal(cancelled, true);
  assert.ok(chunks < 10);
});
