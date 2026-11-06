/* Regras do pedido (sem acesso a rede ou banco, para dar para testar com node --test).
   O servidor confia só no id e na quantidade de cada item: preço, taxa e total saem do cardápio oficial. */

export const MAX_QTD = 30;
export const MAX_LINHAS = 40;
export const MAX_OBS = 120;
export const ID_OK = /^[a-z0-9-]{1,40}$/;
const HORA_OK = /^([01]\d|2[0-3]):[0-5]\d$/;
const MODOS = ['entrega', 'retirada', 'mesa'];
const PAGAMENTOS = ['Pix', 'Cartão', 'Dinheiro'];
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I/L

export class ErroPedido extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

/* ---------- Texto e dinheiro ---------- */
// Uma linha só, sem os símbolos que formatam texto no WhatsApp (impede forjar "Total: R$ 1,00")
export function linhaLimpa(s, max = 200) {
  return String(s ?? '').replace(/[^\S ]+/g, ' ').replace(/[*_~`]/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, max);
}
export const centavos = (reais) => Math.round(Number(reais) * 100);
export function dinheiro(c) {
  const v = (c / 100).toFixed(2).split('.');
  return 'R$ ' + v[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + v[1];
}
export function lerValor(s) {
  let limpo = String(s ?? '').replace(/[^\d,.]/g, '');
  if (!limpo) return NaN;
  if (limpo.includes(',')) limpo = limpo.replace(/\./g, '').replace(',', '.');
  return Number(limpo);
}

/* ---------- Cardápio e config oficiais ---------- */
export function indexarCardapio(cardapio) {
  const itens = new Map();
  for (const c of cardapio?.categorias || []) {
    for (const i of c.itens || []) {
      if (ID_OK.test(i.id) && typeof i.nome === 'string' && Number(i.preco) > 0 && !itens.has(i.id) && i.disponivel !== false) {
        itens.set(i.id, { id: i.id, nome: i.nome, preco: centavos(i.preco) });
      }
    }
  }
  if (!itens.size) throw new ErroPedido('Cardápio oficial sem itens válidos.', 503);
  return itens;
}

/* ---------- Horários (sempre no fuso do restaurante) ---------- */
const minutos = (h) => { const [a, b] = h.split(':'); return +a * 60 + +b; };
const horaCurta = (h) => { const [a, b] = h.split(':'); return +a + 'h' + (b !== '00' ? b : ''); };

export function agoraLocal(fuso, data = new Date()) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: fuso, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(data).forEach((x) => { p[x.type] = x.value; });
  return {
    dia: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
    min: (+p.hour % 24) * 60 + +p.minute,
    texto: `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`,
  };
}

export function estaAberto(config, data = new Date()) {
  const H = config.horarios;
  if (!Array.isArray(H) || H.length !== 7) return true; // sem horários válidos, não bloqueia
  const { dia, min } = agoraLocal(config.fuso || 'America/Sao_Paulo', data);
  const ontem = H[(dia + 6) % 7], hoje = H[dia];
  const valido = (h) => h && HORA_OK.test(h.abre) && HORA_OK.test(h.fecha);
  if (valido(ontem) && minutos(ontem.fecha) < minutos(ontem.abre) && min < minutos(ontem.fecha)) return true;
  if (valido(hoje)) {
    const a = minutos(hoje.abre); let f = minutos(hoje.fecha);
    if (f < a) f += 1440;
    if (min >= a && min < f) return true;
  }
  return false;
}

/* ---------- Validação e cálculo ---------- */
export function montarPedido(entrada, config, cardapio, data = new Date()) {
  if (!entrada || typeof entrada !== 'object') throw new ErroPedido('Dados inválidos.');
  if (entrada.site) throw new ErroPedido('Dados inválidos.'); // campo-isca contra robôs

  const itensOficiais = indexarCardapio(cardapio);
  const modo = MODOS.includes(entrada.modo) ? entrada.modo : null;
  if (!modo) throw new ErroPedido('Escolha entrega, retirada ou mesa.');
  const mesa = modo === 'mesa' ? String(entrada.mesa ?? '').replace(/\D/g, '').slice(0, 3).replace(/^0+/, '') : '';
  if (modo === 'mesa' && !mesa) throw new ErroPedido('Número da mesa inválido. Leia o QR code da mesa de novo.');

  const nome = linhaLimpa(entrada.nome, 60);
  if (!nome) throw new ErroPedido('Escreva seu nome.');
  const endereco = modo === 'entrega' ? linhaLimpa(entrada.endereco, 200) : '';
  if (modo === 'entrega' && endereco.length < 8) throw new ErroPedido('Escreva o endereço de entrega com rua, número e bairro.');

  const pagamento = PAGAMENTOS.includes(entrada.pagamento) ? entrada.pagamento : null;
  if (!pagamento) throw new ErroPedido('Escolha a forma de pagamento.');

  if (!Array.isArray(entrada.itens) || !entrada.itens.length) throw new ErroPedido('A comanda está vazia.');
  if (entrada.itens.length > MAX_LINHAS) throw new ErroPedido('Pedido grande demais. Fale com o restaurante pelo WhatsApp.');

  const juntos = new Map();
  for (const bruto of entrada.itens) {
    const id = String(bruto?.id ?? '');
    const oficial = itensOficiais.get(id);
    if (!oficial) throw new ErroPedido('Um item da comanda saiu do cardápio. Recarregue a página e confira.', 409);
    const qtd = Number(bruto.qtd);
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > MAX_QTD) throw new ErroPedido(`Quantidade inválida em ${oficial.nome}.`);
    const obs = linhaLimpa(bruto.obs, MAX_OBS);
    const ja = juntos.get(id);
    if (ja) { ja.qtd = Math.min(MAX_QTD, ja.qtd + qtd); if (obs && !ja.obs) ja.obs = obs; }
    else juntos.set(id, { id, nome: oficial.nome, preco: oficial.preco, qtd, obs });
  }
  const itens = [...juntos.values()];

  const subtotal = itens.reduce((s, i) => s + i.preco * i.qtd, 0);
  const taxa = modo === 'entrega' ? centavos(config.taxaEntrega || 0) : 0;
  const total = subtotal + taxa;
  const minimo = centavos(config.pedidoMinimo || 0);
  if (modo === 'entrega' && subtotal < minimo) {
    throw new ErroPedido(`O pedido mínimo para entrega é ${dinheiro(minimo)}. Faltam ${dinheiro(minimo - subtotal)}.`);
  }

  let troco = null;
  if (pagamento === 'Dinheiro' && String(entrada.troco ?? '').trim()) {
    const v = lerValor(entrada.troco);
    if (!Number.isFinite(v)) throw new ErroPedido('Escreva o troco só com números, ex.: 100.');
    troco = centavos(v);
    if (troco <= total) throw new ErroPedido(`O troco precisa ser para um valor maior que o total (${dinheiro(total)}).`);
    if (troco > 100000) throw new ErroPedido('Troco acima de R$ 1.000,00. Combine pelo WhatsApp.');
  }

  if (config.aceitarFechado === false && !estaAberto(config, data)) {
    throw new ErroPedido('Estamos fechados agora. Os pedidos ficam disponíveis no horário de funcionamento.', 409);
  }

  return { modo, mesa, nome, endereco, pagamento, troco, itens, subtotal, taxa, total };
}

export function montarMensagem(p, config, codigo) {
  const receber = { entrega: 'Entrega', retirada: 'Retirada no balcão', mesa: 'Mesa ' + p.mesa }[p.modo];
  const linhas = [`*Pedido ${codigo} · ${linhaLimpa(config.nome, 60)}*`, ''];
  for (const i of p.itens) {
    linhas.push(`${i.qtd}x ${i.nome} — ${dinheiro(i.preco * i.qtd)}`);
    if (i.obs) linhas.push(`   obs: ${i.obs}`);
  }
  linhas.push('', `Subtotal: ${dinheiro(p.subtotal)}`);
  if (p.modo === 'entrega') linhas.push(`Entrega: ${dinheiro(p.taxa)}`);
  linhas.push(`*Total: ${dinheiro(p.total)}*`, '');
  linhas.push(`Nome: ${p.nome}`, `Receber: ${receber}`);
  if (p.modo === 'entrega') linhas.push(`Endereço: ${p.endereco}`);
  linhas.push(`Pagamento: ${p.pagamento}${p.troco ? ` (troco para ${dinheiro(p.troco)})` : ''}`);
  if (p.pagamento === 'Pix' && config.pix) linhas.push(`Chave Pix: ${linhaLimpa(config.pix, 80)}`);
  linhas.push('', `Código ${codigo}: o restaurante confere este pedido no painel.`);
  return linhas.join('\n');
}

export function gerarCodigo(bytes = crypto.getRandomValues(new Uint8Array(12))) {
  // 31 símbolos; descarta bytes >= 248 para todos os símbolos terem a mesma chance
  let s = '';
  for (const b of bytes) { if (b < 248) s += ALFABETO[b % 31]; }
  return s.length >= 6 ? s.slice(0, 6) : gerarCodigo();
}
