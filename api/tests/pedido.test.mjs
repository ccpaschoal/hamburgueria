import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { montarPedido, montarMensagem, gerarCodigo, linhaLimpa, dinheiro, estaAberto, ErroPedido } from '../src/pedido.js';
import { gerarHash, senhaConfere, criarSessao, sessaoValida } from '../src/auth.js';

const config = JSON.parse(readFileSync(new URL('../../data/config.json', import.meta.url)));
const cardapio = JSON.parse(readFileSync(new URL('../../data/cardapio.json', import.meta.url)));
const base = { modo: 'retirada', nome: 'Ana', pagamento: 'Pix', itens: [{ id: 'classico', qtd: 2 }] };
const pedir = (extra) => montarPedido({ ...base, ...extra }, config, cardapio);
const falha = (extra, trecho) => assert.throws(() => pedir(extra), (e) => e instanceof ErroPedido && e.message.includes(trecho));

/* Caminhos normais */
test('retirada: total vem do cardápio oficial, sem taxa', () => {
  const p = pedir();
  assert.equal(p.subtotal, 5980); assert.equal(p.taxa, 0); assert.equal(p.total, 5980);
});
test('entrega soma a taxa', () => {
  const p = pedir({ modo: 'entrega', endereco: 'Rua 10, 200, Setor Oeste' });
  assert.equal(p.taxa, 700); assert.equal(p.total, 6680);
});
test('mesa guarda só o número', () => {
  assert.equal(pedir({ modo: 'mesa', mesa: '012' }).mesa, '12');
});
test('dinheiro com troco', () => {
  assert.equal(pedir({ pagamento: 'Dinheiro', troco: 'R$ 100,00' }).troco, 10000);
});
test('mensagem tem código, itens, total e não tem linhas extras', () => {
  const p = pedir({ itens: [{ id: 'classico', qtd: 1, obs: 'sem cebola' }] });
  const m = montarMensagem(p, config, 'ABC234');
  assert.match(m, /^\*Pedido ABC234 · Chapa 62\*/);
  assert.match(m, /1x Clássico 62 — R\$ 29,90\n   obs: sem cebola/);
  assert.match(m, /\*Total: R\$ 29,90\*/);
});

/* Preço e quantidade nunca vêm do cliente */
test('preço enviado pelo cliente é ignorado', () => {
  const p = pedir({ itens: [{ id: 'classico', qtd: 1, preco: 0.01 }], total: 1 });
  assert.equal(p.total, 2990);
});
test('itens repetidos são somados', () => {
  assert.equal(pedir({ itens: [{ id: 'classico', qtd: 1 }, { id: 'classico', qtd: 2 }] }).itens[0].qtd, 3);
});
test('quantidade inválida', () => {
  for (const qtd of [0, -1, 1.5, 31, 'abc', null, 1e9]) falha({ itens: [{ id: 'classico', qtd }] }, 'Quantidade inválida');
});
test('item que não existe', () => falha({ itens: [{ id: 'xx<b>', qtd: 1 }] }, 'saiu do cardápio'));
test('comanda vazia ou gigante', () => {
  falha({ itens: [] }, 'vazia');
  falha({ itens: Array.from({ length: 41 }, () => ({ id: 'agua', qtd: 1 })) }, 'grande demais');
});

/* Validações */
test('nome obrigatório', () => falha({ nome: '  ' }, 'nome'));
test('endereço curto na entrega', () => falha({ modo: 'entrega', endereco: 'Rua 1' }, 'endereço'));
test('pedido mínimo na entrega', () => falha({ modo: 'entrega', endereco: 'Rua 10, 200, Centro', itens: [{ id: 'agua', qtd: 1 }] }, 'mínimo'));
test('mesa sem número', () => falha({ modo: 'mesa', mesa: '<script>' }, 'mesa'));
test('modo e pagamento fora da lista', () => {
  falha({ modo: 'drone' }, 'entrega, retirada');
  falha({ pagamento: 'Bitcoin' }, 'pagamento');
});
test('troco menor que o total ou com letras', () => {
  falha({ pagamento: 'Dinheiro', troco: '10' }, 'maior que o total');
  falha({ pagamento: 'Dinheiro', troco: 'abc' }, 'só com números');
});
test('campo-isca preenchido (robô)', () => falha({ site: 'http://spam' }, 'inválidos'));

/* Mensagem não pode ser forjada */
test('quebra de linha e * viram texto comum', () => {
  assert.equal(linhaLimpa('Ana\n*Total: R$ 1,00* x'), 'Ana Total: R$ 1,00 x');
  const p = pedir({ nome: 'Ana\n*Total: R$ 1*', itens: [{ id: 'classico', qtd: 1, obs: 'a\r\nTotal: R$ 0' }] });
  const m = montarMensagem(p, config, 'ABC234');
  assert.equal(m.split('\n').filter((l) => l.includes('Total')).length, 3); // linha real + 2 dentro de nome/obs
  assert.ok(m.split('\n').every((l) => !/^Total|^\*Total: R\$ 1\*/.test(l)));
});

/* Horários */
test('aberto/fechado no fuso de Brasília, inclusive depois da meia-noite', () => {
  const em = (iso) => estaAberto(config, new Date(iso));
  assert.equal(em('2026-11-06T22:00:00-03:00'), true);   // sexta 22h
  assert.equal(em('2026-11-07T00:15:00-03:00'), true);   // sábado 0h15 (turno de sexta)
  assert.equal(em('2026-11-07T00:31:00-03:00'), false);  // sábado 0h31
  assert.equal(em('2026-11-09T20:00:00-03:00'), false);  // segunda
  assert.equal(em('2026-11-06T17:59:00-03:00'), false);
});
test('aceitarFechado: false bloqueia fora do horário', () => {
  const c = { ...config, aceitarFechado: false };
  assert.throws(() => montarPedido(base, c, cardapio, new Date('2026-11-09T20:00:00-03:00')), /fechados/);
});

/* Utilidades */
test('dinheiro formata milhar', () => assert.equal(dinheiro(114690), 'R$ 1.146,90'));
test('código: 6 caracteres sem 0, O, 1, I, L', () => {
  for (let i = 0; i < 500; i++) assert.match(gerarCodigo(), /^[A-HJKMNP-Z2-9]{6}$/);
});

/* Senha e sessão */
test('senha confere só com a senha certa', async () => {
  const h = await gerarHash('senha-de-teste', 1000);
  assert.ok(!h.includes('senha-de-teste'));
  assert.equal(await senhaConfere('senha-de-teste', h), true);
  assert.equal(await senhaConfere('senha-de-testE', h), false);
  assert.equal(await senhaConfere('', h), false);
  assert.equal(await senhaConfere('x', 'lixo'), false);
});
test('sessão: válida, expirada, adulterada', async () => {
  const chave = 'k'.repeat(40), agora = Date.now();
  const t = await criarSessao(chave, agora);
  assert.equal(await sessaoValida(chave, t, agora), true);
  assert.equal(await sessaoValida(chave, t, agora + 13 * 3600e3), false);
  assert.equal(await sessaoValida('z'.repeat(40), t, agora), false);
  const [exp, sig] = t.split('.');
  assert.equal(await sessaoValida(chave, `${Number(exp) + 1}.${sig}`, agora), false);
  assert.equal(await sessaoValida(chave, 'qualquer', agora), false);
});
