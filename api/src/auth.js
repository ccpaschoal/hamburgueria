/* Senha do admin e sessão.
   A senha nunca fica guardada: o segredo ADMIN_SENHA_HASH tem só "pbkdf2$iteracoes$sal$hash" (gerado por scripts/gerar-hash.mjs).
   Depois do login, o admin recebe um token assinado (HMAC) que vale 12 horas. */

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const HORAS_SESSAO = 12;

export async function pbkdf2(senha, sal, iteracoes) {
  const chave = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteracoes }, chave, 256);
}

export async function gerarHash(senha, iteracoes = 100000) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iteracoes}$${b64(sal)}$${b64(await pbkdf2(senha, sal, iteracoes))}`;
}

// Comparação em tempo constante (não revela quantos caracteres batem)
export function iguais(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let dif = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) dif |= (x[i] || 0) ^ (y[i] || 0);
  return dif === 0;
}

export async function senhaConfere(senha, guardado) {
  const partes = String(guardado || '').split('$');
  if (partes.length !== 4 || partes[0] !== 'pbkdf2' || typeof senha !== 'string' || !senha || senha.length > 200) return false;
  const calc = b64(await pbkdf2(senha, deB64(partes[2]), Number(partes[1])));
  return iguais(calc, partes[3]);
}

async function assinar(chave, texto) {
  const k = await crypto.subtle.importKey('raw', enc.encode(chave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(texto)));
}

export async function criarSessao(chave, agora = Date.now()) {
  if (!chave || chave.length < 32) throw new Error('SESSAO_CHAVE ausente ou curta');
  const exp = agora + HORAS_SESSAO * 3600 * 1000;
  return `${exp}.${await assinar(chave, 'admin.' + exp)}`;
}

export async function sessaoValida(chave, token, agora = Date.now()) {
  if (!chave || chave.length < 32 || typeof token !== 'string') return false;
  const partes = token.split('.');
  if (partes.length !== 2) return false;
  const [exp, assinatura] = partes;
  if (!/^\d{13}$/.test(exp || '') || Number(exp) <= agora || Number(exp) > agora + HORAS_SESSAO * 3600e3) return false;
  return iguais(await assinar(chave, 'admin.' + exp), assinatura || '');
}
