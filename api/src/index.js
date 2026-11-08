/* Chapa 62 · API de pedidos (Cloudflare Worker + D1)
   POST  /pedidos                    cliente manda a comanda → servidor recalcula com o cardápio oficial, guarda e devolve código + mensagem
   POST  /admin/login                { senha } → token de 12 h (máx. 10 erros em 15 min por conexão)
   GET   /admin/pedidos?status=&q=   lista dos pedidos (token)
   PATCH /admin/pedidos/:codigo      { status } (token)
   GET   /saude                      teste rápido
   Cron diário: apaga pedidos com mais de 30 dias e tentativas de login antigas. */
import { montarPedido, montarMensagem, gerarCodigo, ErroPedido } from './pedido.js';
import { senhaConfere, criarSessao, sessaoValida, HORAS_SESSAO } from './auth.js';

const LIMITE_PEDIDOS = 6;          // por conexão, a cada 10 minutos
const LIMITE_ERROS_SENHA = 10;     // por conexão, a cada 15 minutos
const DIAS_GUARDADOS = 30;
const STATUS = ['novo', 'confirmado', 'pronto', 'concluido', 'cancelado'];
const MAX_CORPO = 16 * 1024;

/* ---------- Respostas ---------- */
function origemPermitida(req, env) {
  const o = req.headers.get('Origin') || '';
  const lista = String(env.ORIGENS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return lista.includes(o) ? o : '';
}
function json(dados, status, req, env) {
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    Vary: 'Origin',
  };
  const o = origemPermitida(req, env);
  if (o) {
    h['Access-Control-Allow-Origin'] = o;
    h['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    h['Access-Control-Max-Age'] = '600';
  }
  return new Response(dados === null ? null : JSON.stringify(dados), { status, headers: h });
}

async function lerCorpo(req) {
  if (!(req.headers.get('Content-Type') || '').includes('application/json')) throw new ErroPedido('Envie os dados em JSON.', 415);
  const reader = req.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_CORPO) {
          await reader.cancel();
          throw new ErroPedido('Dados grandes demais.', 413);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new ErroPedido('Dados inválidos.'); }
}

// Resumo do IP: serve para limitar abusos sem guardar o endereço de ninguém
async function ipHash(req) {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('chapa62:' + ip));
  return [...new Uint8Array(b)].slice(0, 16).map((x) => x.toString(16).padStart(2, '0')).join('');
}

/* ---------- Cardápio oficial (lido do próprio site, guardado 60 s na memória) ---------- */
let cache = { ate: 0, dados: null };
async function dadosOficiais(env) {
  if (cache.dados && cache.ate > Date.now()) return cache.dados;
  const base = String(env.SITE_URL || '').replace(/\/$/, '');
  const pegar = async (arq) => {
    const r = await fetch(`${base}/data/${arq}`, { cf: { cacheTtl: 60 } });
    if (!r.ok) throw new Error(`${arq} respondeu ${r.status}`);
    return r.json();
  };
  try {
    const [config, cardapio] = await Promise.all([pegar('config.json'), pegar('cardapio.json')]);
    cache = { ate: Date.now() + 60000, dados: { config, cardapio } };
    return cache.dados;
  } catch (e) {
    console.error('cardápio oficial indisponível:', e.message);
    if (cache.dados) return cache.dados; // usa a última versão boa
    throw new ErroPedido('Não foi possível conferir o cardápio agora. Tente de novo em instantes.', 503);
  }
}

/* ---------- Rotas ---------- */
async function criarPedido(req, env) {
  const ip = await ipHash(req);
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE ip_hash = ? AND criado_em > datetime('now', '-10 minutes')").bind(ip).first();
  if (n >= LIMITE_PEDIDOS) throw new ErroPedido('Muitos pedidos seguidos. Espere alguns minutos ou fale com o restaurante pelo WhatsApp.', 429);

  const entrada = await lerCorpo(req);
  const { config, cardapio } = await dadosOficiais(env);
  const p = montarPedido(entrada, config, cardapio);

  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const codigo = gerarCodigo();
    const mensagem = montarMensagem(p, config, codigo);
    try {
      await env.DB.prepare(
        `INSERT INTO pedidos (codigo, modo, mesa, nome, endereco, pagamento, troco_centavos, itens, subtotal_centavos, taxa_centavos, total_centavos, mensagem, ip_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(codigo, p.modo, p.mesa || null, p.nome, p.endereco || null, p.pagamento, p.troco, JSON.stringify(p.itens),
        p.subtotal, p.taxa, p.total, mensagem, ip).run();
      const whatsapp = String(config.whatsapp || '').replace(/\D/g, '');
      return json({ codigo, total: p.total, mensagem, whatsapp }, 201, req, env);
    } catch (e) {
      if (!String(e.message).includes('UNIQUE')) throw e; // código repetido: tenta outro
    }
  }
  throw new ErroPedido('Não foi possível registrar o pedido. Tente de novo.', 503);
}

async function login(req, env) {
  const ip = await ipHash(req);
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM tentativas WHERE ip_hash = ? AND criado_em > datetime('now', '-15 minutes')").bind(ip).first();
  if (n >= LIMITE_ERROS_SENHA) throw new ErroPedido('Muitas tentativas erradas. Espere 15 minutos.', 429);
  const { senha } = await lerCorpo(req);
  if (!env.ADMIN_SENHA_HASH || !env.SESSAO_CHAVE) throw new ErroPedido('Admin ainda não configurado.', 503);
  if (!(await senhaConfere(senha, env.ADMIN_SENHA_HASH))) {
    await env.DB.prepare('INSERT INTO tentativas (ip_hash) VALUES (?)').bind(ip).run();
    throw new ErroPedido('Senha incorreta.', 401);
  }
  return json({ token: await criarSessao(env.SESSAO_CHAVE), horas: HORAS_SESSAO }, 200, req, env);
}

async function exigirAdmin(req, env) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(await sessaoValida(env.SESSAO_CHAVE, token))) throw new ErroPedido('Sessão expirada. Entre de novo.', 401);
}

async function listar(req, env) {
  await exigirAdmin(req, env);
  const u = new URL(req.url);
  const status = u.searchParams.get('status');
  const q = (u.searchParams.get('q') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  let sql = `SELECT codigo, criado_em, status, modo, mesa, nome, endereco, pagamento, troco_centavos, itens,
             subtotal_centavos, taxa_centavos, total_centavos, mensagem FROM pedidos WHERE 1 = 1`;
  const args = [];
  if (STATUS.includes(status)) { sql += ' AND status = ?'; args.push(status); }
  if (q) { sql += ' AND codigo LIKE ?'; args.push(q + '%'); }
  sql += ' ORDER BY id DESC LIMIT 200';
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  return json({ pedidos: results.map((r) => ({ ...r, itens: JSON.parse(r.itens) })) }, 200, req, env);
}

async function mudarStatus(req, env, codigo) {
  await exigirAdmin(req, env);
  const { status } = await lerCorpo(req);
  if (!STATUS.includes(status)) throw new ErroPedido('Status inválido.');
  const r = await env.DB.prepare("UPDATE pedidos SET status = ?, atualizado_em = datetime('now') WHERE codigo = ?").bind(status, codigo).run();
  if (!r.meta.changes) throw new ErroPedido('Pedido não encontrado.', 404);
  return json({ codigo, status }, 200, req, env);
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    try {
      if (req.method === 'OPTIONS') return json(null, 204, req, env);
      if (pathname === '/saude' && req.method === 'GET') return json({ ok: true }, 200, req, env);
      if (pathname === '/pedidos' && req.method === 'POST') return await criarPedido(req, env);
      if (pathname === '/admin/login' && req.method === 'POST') return await login(req, env);
      if (pathname === '/admin/pedidos' && req.method === 'GET') return await listar(req, env);
      const m = pathname.match(/^\/admin\/pedidos\/([A-Z0-9]{6})$/);
      if (m && req.method === 'PATCH') return await mudarStatus(req, env, m[1]);
      return json({ erro: 'Rota não encontrada.' }, 404, req, env);
    } catch (e) {
      if (e instanceof ErroPedido) return json({ erro: e.message }, e.status, req, env);
      console.error('erro inesperado:', e && e.stack || e);
      return json({ erro: 'Erro interno. Tente de novo em instantes.' }, 500, req, env);
    }
  },

  async scheduled(_evento, env) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM pedidos WHERE criado_em < datetime('now', '-${DIAS_GUARDADOS} days')`),
      env.DB.prepare("DELETE FROM tentativas WHERE criado_em < datetime('now', '-1 day')"),
    ]);
  },
};
