/* Chapa 62 — modelo de site para restaurante.
   Tudo que muda de um cliente para outro fica em data/config.json e data/cardapio.json.
   Atenção: o total é calculado no aparelho do cliente e vai como texto pelo WhatsApp.
   O restaurante deve sempre conferir os valores pela própria tabela. */
(function () {
  'use strict';

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var CHAVE = 'chapa62-comanda';
  var MAX_QTD = 30, MAX_OBS = 120;
  var ID_OK = /^[a-z0-9-]{1,40}$/;
  var HORA_OK = /^([01]\d|2[0-3]):[0-5]\d$/;
  var brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var dinheiro = function (v) { return brl.format(v).replace(/ /g, ' '); };

  var config, cardapio, itensPorId = {};
  var comanda = carregar();
  var mesa = (new URLSearchParams(location.search).get('mesa') || '').replace(/\D/g, '').slice(0, 3).replace(/^0+/, '');
  var modo = mesa ? 'mesa' : 'entrega';
  var enviando = false;

  /* ---------- Carregar dados ---------- */
  function pegarJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new ErroDados(url + ' respondeu ' + r.status, 'rede');
      return r.json().catch(function () { throw new ErroDados(url + ' não é um JSON válido', 'dados'); });
    }, function () { throw new ErroDados('sem conexão ao buscar ' + url, 'rede'); });
  }
  function ErroDados(msg, tipo) { this.message = msg; this.tipo = tipo; }

  Promise.all([pegarJSON('data/config.json'), pegarJSON('data/cardapio.json')]).then(function (d) {
    config = validarConfig(d[0]);
    cardapio = validarCardapio(d[1]);
    Object.keys(comanda).forEach(function (id) { if (!itensPorId[id]) delete comanda[id]; });
    salvar();
    aplicarCores();
    montarCardapio();
    montarInfo();
    montarModo();
    atualizarStatus();
    atualizarBarra();
    setInterval(atualizarStatus, 60000);
  }).catch(function (e) {
    console.error('[Chapa 62] ' + (e && e.message || e));
    var txt = e && e.tipo === 'rede'
      ? 'Não foi possível carregar o cardápio. Verifique a conexão e recarregue a página.'
      : 'O cardápio está com um problema de configuração. Chame o restaurante pelo WhatsApp ou Instagram enquanto corrigimos.';
    $('#lista').innerHTML = '<p class="vazio">' + txt + '</p>';
    $('#status').textContent = '';
  });

  /* ---------- Validação dos JSON ---------- */
  function falha(msg) { throw new ErroDados(msg, 'dados'); }
  function texto(v, campo) { if (typeof v !== 'string' || !v.trim()) falha('config: falta "' + campo + '"'); return v.trim(); }
  function numero(v, campo, padrao) {
    if (v === undefined || v === null) return padrao;
    var n = Number(v); if (!isFinite(n) || n < 0) falha('"' + campo + '" precisa ser um número positivo'); return n;
  }

  function validarConfig(c) {
    if (!c || typeof c !== 'object') falha('config.json vazio');
    c.nome = texto(c.nome, 'nome');
    c.endereco = texto(c.endereco, 'endereco');
    c.cidade = texto(c.cidade, 'cidade');
    c.tempoEntrega = typeof c.tempoEntrega === 'string' ? c.tempoEntrega : '40 a 60 min';
    c.taxaEntrega = numero(c.taxaEntrega, 'taxaEntrega', 0);
    c.pedidoMinimo = numero(c.pedidoMinimo, 'pedidoMinimo', 0);
    c.fuso = typeof c.fuso === 'string' ? c.fuso : 'America/Sao_Paulo';
    try { new Intl.DateTimeFormat('pt-BR', { timeZone: c.fuso }); } catch (e) { falha('fuso "' + c.fuso + '" inválido'); }
    c.aceitarFechado = c.aceitarFechado !== false;
    c.whatsapp = String(c.whatsapp || '').replace(/\D/g, '');
    if (c.whatsapp && (c.whatsapp.length < 12 || c.whatsapp.length > 13)) falha('whatsapp precisa ter DDI + DDD + número, ex.: 5562999999999');
    c.instagram = String(c.instagram || '').replace(/[^\w.]/g, '').slice(0, 30);
    c.pix = typeof c.pix === 'string' ? c.pix.trim() : '';
    var lat = Number(c.mapa && c.mapa.lat), lon = Number(c.mapa && c.mapa.lon);
    c.mapa = (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) ? { lat: lat, lon: lon } : null;
    if (!Array.isArray(c.horarios) || c.horarios.length !== 7) falha('"horarios" precisa ter 7 dias, começando no domingo');
    c.horarios.forEach(function (h, i) {
      h.dia = texto(h.dia, 'horarios[' + i + '].dia');
      if (h.abre === null && h.fecha === null) return;
      if (!HORA_OK.test(h.abre) || !HORA_OK.test(h.fecha) || h.abre === h.fecha) falha('horário de ' + h.dia + ' inválido (use "18:00" e "23:00", ou null nos dois para fechado)');
    });
    return c;
  }

  function validarCardapio(d) {
    if (!d || !Array.isArray(d.categorias) || !d.categorias.length) falha('cardapio.json sem "categorias"');
    d.categorias = d.categorias.filter(function (c) {
      if (!ID_OK.test(c.id) || !c.nome || !Array.isArray(c.itens)) { console.warn('[Chapa 62] categoria ignorada:', c.id); return false; }
      c.itens = c.itens.filter(function (i) {
        var ok = ID_OK.test(i.id) && !itensPorId[i.id] && typeof i.nome === 'string' && isFinite(i.preco) && i.preco > 0 &&
          (!i.foto || ID_OK.test(i.foto));
        if (!ok) { console.warn('[Chapa 62] item ignorado (id repetido/inválido, sem nome ou preço):', i.id); return false; }
        i.desc = typeof i.desc === 'string' ? i.desc : '';
        i.preco = Math.round(Number(i.preco) * 100) / 100;
        itensPorId[i.id] = i;
        return true;
      });
      return c.itens.length > 0;
    });
    if (!d.categorias.length) falha('nenhum item válido no cardápio');
    return d;
  }

  /* ---------- Cores do config ---------- */
  function aplicarCores() {
    var c = config.cores || {}, r = document.documentElement.style;
    var mapa = { fundo: '--mostarda', texto: '--cafe', destaque: '--ketchup', detalhe: '--picles', papel: '--papel' };
    Object.keys(mapa).forEach(function (k) { if (/^#[0-9a-f]{3,8}$/i.test(c[k] || '')) r.setProperty(mapa[k], c[k]); });
    $('#comanda-casa').textContent = config.nome.toUpperCase();
    if (/^#[0-9a-f]{3,8}$/i.test(c.fundo || '')) $('meta[name="theme-color"]').content = c.fundo;
  }

  /* ---------- Horários (sempre no fuso do restaurante) ---------- */
  function minutos(h) { var p = h.split(':'); return +p[0] * 60 + +p[1]; }
  function horaCurta(h) { var p = h.split(':'); return +p[0] + 'h' + (p[1] !== '00' ? p[1] : ''); }

  function agoraLocal() {
    var partes = {};
    new Intl.DateTimeFormat('en-US', { timeZone: config.fuso, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', day: '2-digit', month: '2-digit', year: 'numeric' })
      .formatToParts(new Date()).forEach(function (p) { partes[p.type] = p.value; });
    return {
      dia: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.weekday),
      min: (+partes.hour % 24) * 60 + +partes.minute,
      texto: partes.day + '/' + partes.month + '/' + partes.year + ' · ' + partes.hour + ':' + partes.minute
    };
  }

  function situacao() {
    var H = config.horarios, agora = agoraLocal(), d = agora.dia, m = agora.min;
    var ontem = H[(d + 6) % 7], hoje = H[d];
    if (ontem.abre && minutos(ontem.fecha) < minutos(ontem.abre) && m < minutos(ontem.fecha)) {
      return { aberto: true, texto: 'Aberto até ' + horaCurta(ontem.fecha) };
    }
    if (hoje.abre) {
      var a = minutos(hoje.abre), f = minutos(hoje.fecha);
      if (f < a) f += 1440;
      if (m >= a && m < f) return { aberto: true, texto: 'Aberto até ' + horaCurta(hoje.fecha) };
      if (m < a) return { aberto: false, texto: 'Fechado agora · abre hoje às ' + horaCurta(hoje.abre), abre: 'hoje às ' + horaCurta(hoje.abre) };
    }
    for (var i = 1; i <= 7; i++) {
      var p = H[(d + i) % 7];
      if (p.abre) {
        var quando = (i === 1 ? 'amanhã' : p.dia.toLowerCase()) + ' às ' + horaCurta(p.abre);
        return { aberto: false, texto: 'Fechado agora · abre ' + quando, abre: quando };
      }
    }
    return { aberto: false, texto: 'Fechado' };
  }

  function atualizarStatus() {
    var s = situacao(), el = $('#status');
    el.textContent = s.texto;
    el.classList.toggle('aberto', s.aberto);
    montarHorarios();
    if (estaAberta()) avisoFechado();
  }

  function montarHorarios() {
    var d = agoraLocal().dia;
    $('#horarios').innerHTML = config.horarios.map(function (h, i) {
      return '<tr' + (i === d ? ' class="hoje"' : '') + '><th scope="row">' + esc(h.dia) + '</th><td>' +
        (h.abre ? horaCurta(h.abre) + ' às ' + horaCurta(h.fecha) : 'Fechado') + '</td></tr>';
    }).join('');
  }

  /* ---------- Cardápio ---------- */
  function montarCardapio() {
    var lista = $('#lista'), chips = $('#chips');
    lista.innerHTML = cardapio.categorias.map(function (c) {
      return '<section class="categoria" id="cat-' + c.id + '" aria-labelledby="h-' + c.id + '">' +
        '<h3 id="h-' + c.id + '">' + esc(c.nome) + '</h3><ul class="itens">' +
        c.itens.map(linhaItem).join('') + '</ul></section>';
    }).join('');
    chips.innerHTML = cardapio.categorias.map(function (c, i) {
      return '<a href="#cat-' + c.id + '"' + (i === 0 ? ' aria-current="true"' : '') + '>' + esc(c.nome) + '</a>';
    }).join('');

    lista.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-acao]');
      if (!b) return;
      mudarQtd(b.closest('[data-id]').dataset.id, b.dataset.acao === 'mais' ? 1 : -1);
    });

    $('#busca').addEventListener('input', filtrar);
    $('#so-veggie').addEventListener('change', filtrar);
    observarCategorias();
  }

  // ids e fotos já passaram por ID_OK (só a-z, 0-9 e hífen), então podem ir direto no HTML
  function linhaItem(i) {
    var foto = i.foto
      ? '<img class="item-foto" src="assets/fotos/mini/' + i.foto + '.jpg" width="112" height="112" loading="lazy" alt="' + esc(i.nome) + '">'
      : '';
    return '<li class="item" data-id="' + i.id + '" data-busca="' + esc(normal(i.nome + ' ' + i.desc)) + '"' + (i.veggie ? ' data-veggie' : '') + '>' +
      '<div><h4>' + esc(i.nome) + (i.veggie ? '<span class="veg">veggie</span>' : '') + '</h4>' +
      '<p>' + esc(i.desc) + '</p>' +
      '<div class="item-rodape"><span class="preco">' + dinheiro(i.preco) + '</span></div></div>' +
      '<div class="item-direita">' + foto + '<div class="ctrl">' + controle(i) + '</div></div></li>';
  }

  function controle(i) {
    var q = comanda[i.id] ? comanda[i.id].qtd : 0;
    if (!q) return '<button class="add" type="button" data-acao="mais" aria-label="Adicionar ' + esc(i.nome) + '">+</button>';
    return '<div class="passo"><button type="button" data-acao="menos" aria-label="Tirar um ' + esc(i.nome) + '">−</button>' +
      '<output aria-live="polite" aria-label="' + q + ' na comanda">' + q + '</output>' +
      '<button type="button" data-acao="mais" aria-label="Adicionar mais um ' + esc(i.nome) + '"' + (q >= MAX_QTD ? ' disabled' : '') + '>+</button></div>';
  }

  function filtrar() {
    var t = normal($('#busca').value.trim()), veg = $('#so-veggie').checked, algum = false;
    $$('.categoria').forEach(function (cat) {
      var visiveis = 0;
      $$('.item', cat).forEach(function (li) {
        var ok = (!t || li.dataset.busca.indexOf(t) > -1) && (!veg || li.hasAttribute('data-veggie'));
        li.hidden = !ok; if (ok) visiveis++;
      });
      cat.hidden = !visiveis; if (visiveis) algum = true;
    });
    $('#vazio').hidden = algum;
    $$('#chips a').forEach(function (a) { a.hidden = $(a.getAttribute('href')).hidden; });
  }

  function observarCategorias() {
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (e) {
        if (!e.isIntersecting) return;
        $$('#chips a').forEach(function (a) {
          var ativo = a.getAttribute('href') === '#' + e.target.id;
          if (ativo) { a.setAttribute('aria-current', 'true'); mostrarChip(a); }
          else a.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-140px 0px -60% 0px' });
    $$('.categoria').forEach(function (c) { io.observe(c); });
  }

  // Rola só a fileira de chips na horizontal (scrollIntoView mexia na rolagem da página)
  function mostrarChip(a) {
    var chips = $('#chips'), c = chips.getBoundingClientRect(), r = a.getBoundingClientRect();
    if (r.left >= c.left && r.right <= c.right) return;
    chips.scrollTo({ left: chips.scrollLeft + (r.left - c.left) - 8, behavior: 'smooth' });
  }

  /* ---------- Comanda (estado) ---------- */
  // O que vem do navegador pode ter sido alterado: só aceita quantidade inteira de 1 a 30 e observação curta
  function carregar() {
    var bruto, limpo = {};
    try { bruto = JSON.parse(localStorage.getItem(CHAVE)); } catch (e) { bruto = null; }
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return limpo;
    Object.keys(bruto).forEach(function (id) {
      var c = bruto[id], q = c && Number(c.qtd);
      if (!ID_OK.test(id) || !Number.isInteger(q) || q < 1) return;
      limpo[id] = { qtd: Math.min(q, MAX_QTD), obs: typeof c.obs === 'string' ? c.obs.slice(0, MAX_OBS) : '' };
    });
    return limpo;
  }
  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(comanda)); } catch (e) {}
  }

  function mudarQtd(id, delta) {
    if (!itensPorId[id]) return;
    var atual = comanda[id] || { qtd: 0, obs: '' };
    atual.qtd = Math.max(0, Math.min(MAX_QTD, atual.qtd + delta));
    if (atual.qtd) comanda[id] = atual; else delete comanda[id];
    salvar();
    var li = $('.item[data-id="' + id + '"]');
    if (li) {
      var ctrl = $('.ctrl', li), tinhaFoco = ctrl.contains(document.activeElement);
      ctrl.innerHTML = controle(itensPorId[id]);
      if (tinhaFoco) {
        var alvo = $('[data-acao="' + (delta > 0 ? 'mais' : 'menos') + '"]:not([disabled])', ctrl) || $('button:not([disabled])', ctrl);
        if (alvo) alvo.focus();
      }
    }
    atualizarBarra(delta > 0);
    if (estaAberta()) renderComanda();
  }

  // Soma em centavos para não acumular erro de casas decimais
  function totais() {
    var qtd = 0, sub = 0;
    Object.keys(comanda).forEach(function (id) { qtd += comanda[id].qtd; sub += comanda[id].qtd * Math.round(itensPorId[id].preco * 100); });
    var taxa = modo === 'entrega' && qtd ? Math.round(config.taxaEntrega * 100) : 0;
    return { qtd: qtd, sub: sub / 100, taxa: taxa / 100, total: (sub + taxa) / 100 };
  }

  function atualizarBarra(pular) {
    var t = totais(), barra = $('#barra');
    barra.hidden = !t.qtd;
    $('#barra-qtd').textContent = t.qtd + (t.qtd === 1 ? ' item' : ' itens');
    $('#barra-total').textContent = dinheiro(t.sub);
    if (pular) { barra.classList.remove('pulo'); void barra.offsetWidth; barra.classList.add('pulo'); }
  }

  /* ---------- Modo de pedido ---------- */
  function montarModo() {
    if (mesa) {
      $$('.modo-mesa').forEach(function (l) { l.hidden = false; });
      $('#modo-mesa-txt').textContent = 'Mesa ' + mesa;
      $$('.mesa-txt').forEach(function (s) { s.textContent = 'Mesa ' + mesa; });
      $('#sub').textContent = 'Você está na mesa ' + mesa + '. Escolha no cardápio e mande o pedido; a gente leva até você.';
    }
    $$('input[name="modo"], input[name="modo2"]').forEach(function (r) {
      r.addEventListener('change', function () { definirModo(r.value); });
    });
    definirModo(modo);
  }

  function definirModo(m) {
    if (m === 'mesa' && !mesa) m = 'entrega';
    modo = m;
    $$('input[name="modo"], input[name="modo2"]').forEach(function (r) { r.checked = r.value === m; });
    var info = {
      entrega: 'Entrega em ' + config.tempoEntrega + ' · taxa de ' + dinheiro(config.taxaEntrega) +
        (config.pedidoMinimo ? ' · pedido mínimo de ' + dinheiro(config.pedidoMinimo) : '') + '.',
      retirada: 'Retire no balcão: ' + config.endereco + '. Avisamos no WhatsApp quando estiver pronto.',
      mesa: 'O pedido vai direto para a cozinha com o número da mesa ' + mesa + '.'
    };
    $('#modo-info').textContent = info[m];
    $('#campo-endereco').hidden = m !== 'entrega';
    atualizarBarra();
    if (estaAberta()) renderContas();
  }

  /* ---------- Comanda (janela) — com plano B para navegador sem <dialog> ---------- */
  var dialog = $('#comanda');
  var temDialog = typeof dialog.showModal === 'function';
  var focoAntes = null;

  function estaAberta() { return dialog.hasAttribute('open'); }
  function abrirJanela() {
    focoAntes = document.activeElement;
    if (temDialog) dialog.showModal();
    else { dialog.setAttribute('open', ''); dialog.classList.add('sem-dialog'); document.body.classList.add('travado'); $('#fechar').focus(); }
  }
  function fecharJanela() {
    if (temDialog) dialog.close();
    else { dialog.removeAttribute('open'); document.body.classList.remove('travado'); }
    if (focoAntes && focoAntes.focus) focoAntes.focus();
  }

  $('#barra').addEventListener('click', abrirComanda);
  $('#fechar').addEventListener('click', fecharJanela);
  dialog.addEventListener('click', function (e) { if (e.target === dialog) fecharJanela(); });
  document.addEventListener('keydown', function (e) { if (!temDialog && e.key === 'Escape' && estaAberta()) fecharJanela(); });

  function abrirComanda() {
    if (!config) return;
    var nomeSalvo = ''; try { nomeSalvo = localStorage.getItem('chapa62-nome') || ''; } catch (e) {}
    if (!$('#nome').value) $('#nome').value = nomeSalvo.slice(0, 60);
    mostrarFormulario();
    renderComanda();
    abrirJanela();
  }

  function mostrarFormulario() {
    $('#demo').hidden = true; $('#erro').textContent = '';
  }

  function renderComanda() {
    var ids = Object.keys(comanda), ul = $('#comanda-itens');
    $('#comanda-data').textContent = agoraLocal().texto;
    $('#comanda-vazia').hidden = ids.length > 0;
    $('#form-pedido').hidden = !ids.length || !$('#demo').hidden;
    ul.innerHTML = ids.map(function (id) {
      var c = comanda[id], i = itensPorId[id];
      return '<li class="c-item" data-id="' + id + '">' +
        '<div class="c-linha"><span class="c-nome">' + c.qtd + 'x ' + esc(i.nome) + '</span><span class="c-pontos"></span>' +
        '<span class="c-valor">' + dinheiro(c.qtd * i.preco).replace('R$ ', '') + '</span></div>' +
        '<div class="c-acoes"><div class="passo">' +
        '<button type="button" data-acao="menos" aria-label="Tirar um ' + esc(i.nome) + '">−</button>' +
        '<output>' + c.qtd + '</output>' +
        '<button type="button" data-acao="mais" aria-label="Adicionar mais um ' + esc(i.nome) + '"' + (c.qtd >= MAX_QTD ? ' disabled' : '') + '>+</button></div>' +
        (c.obs ? '' : '<button type="button" class="c-obs-btn" data-obs>Observação</button>') + '</div>' +
        (c.obs ? obsCampo(id, c.obs) : '') + '</li>';
    }).join('');
    renderContas();
    avisoFechado();
  }

  function obsCampo(id, valor) {
    return '<label class="sr-only" for="obs-' + id + '">Observação para ' + esc(itensPorId[id].nome) + '</label>' +
      '<input class="c-obs" id="obs-' + id + '" data-obs-input maxlength="' + MAX_OBS + '" placeholder="Ex.: sem cebola, ponto da carne" value="' + esc(valor || '') + '">';
  }

  $('#comanda-itens').addEventListener('click', function (e) {
    var li = e.target.closest('.c-item'); if (!li) return;
    var b = e.target.closest('button[data-acao]');
    if (b) {
      var id = li.dataset.id, delta = b.dataset.acao === 'mais' ? 1 : -1;
      mudarQtd(id, delta);
      var nova = $('.c-item[data-id="' + id + '"] [data-acao="' + b.dataset.acao + '"]:not([disabled])') ||
        $('.c-item[data-id="' + id + '"] button:not([disabled])');
      (nova || $('#fechar')).focus();
      return;
    }
    if (e.target.closest('[data-obs]')) {
      e.target.closest('[data-obs]').remove();
      li.insertAdjacentHTML('beforeend', obsCampo(li.dataset.id, ''));
      $('.c-obs', li).focus();
    }
  });
  $('#comanda-itens').addEventListener('input', function (e) {
    if (!e.target.matches('[data-obs-input]')) return;
    var id = e.target.closest('.c-item').dataset.id;
    if (comanda[id]) { comanda[id].obs = e.target.value.slice(0, MAX_OBS); salvar(); }
  });

  function renderContas() {
    var t = totais(), html = '<dt>Subtotal</dt><dd>' + dinheiro(t.sub) + '</dd>';
    if (modo === 'entrega') html += '<dt>Entrega</dt><dd>' + dinheiro(t.taxa) + '</dd>';
    html += '<dt class="total">Total</dt><dd class="total">' + dinheiro(t.total) + '</dd>';
    $('#contas').innerHTML = html;
  }

  function avisoFechado() {
    var s = situacao(), el = $('#aviso-fechado');
    if (s.aberto) { el.hidden = true; $('#enviar').disabled = enviando; return; }
    el.hidden = false;
    el.textContent = config.aceitarFechado
      ? 'Estamos fechados agora' + (s.abre ? ' (abre ' + s.abre + ')' : '') + '. Você pode mandar o pedido, mas ele só será preparado quando abrirmos.'
      : 'Estamos fechados agora' + (s.abre ? ' e abrimos ' + s.abre : '') + '. Os pedidos ficam disponíveis no horário de funcionamento.';
    $('#enviar').disabled = enviando || !config.aceitarFechado;
  }

  $$('input[name="pagamento"]').forEach(function (r) {
    r.addEventListener('change', function () { $('#campo-troco').hidden = !(r.value === 'Dinheiro' && r.checked); });
  });

  /* ---------- Enviar ---------- */
  // Uma linha só, sem os símbolos que formatam texto no WhatsApp: impede forjar linhas como "Total: R$ 1,00"
  function linhaLimpa(s, max) {
    return String(s || '').replace(/[^\S ]+/g, ' ').replace(/[*_~`]/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, max || 200);
  }
  function lerValor(s) {
    var limpo = String(s).replace(/[^\d,.]/g, '');
    if (!limpo) return NaN;
    if (limpo.indexOf(',') > -1) limpo = limpo.replace(/\./g, '').replace(',', '.');
    return Number(limpo);
  }

  $('#form-pedido').addEventListener('submit', function (e) {
    e.preventDefault();
    if (enviando) return;
    var t = totais(), erro = $('#erro');
    var nome = linhaLimpa($('#nome').value, 60), end = linhaLimpa($('#endereco-entrega').value, 200);
    var pag = ($('input[name="pagamento"]:checked') || {}).value || 'Pix';
    var trocoTxt = $('#troco').value.trim(), troco = lerValor(trocoTxt);
    erro.textContent = '';

    if (!t.qtd) { erro.textContent = 'A comanda está vazia. Adicione itens no cardápio.'; return; }
    if (!nome) { erro.textContent = 'Escreva seu nome para a cozinha chamar quando ficar pronto.'; $('#nome').focus(); return; }
    if (modo === 'entrega' && end.length < 8) { erro.textContent = 'Escreva o endereço de entrega com rua, número e bairro.'; $('#endereco-entrega').focus(); return; }
    if (modo === 'entrega' && t.sub < config.pedidoMinimo) {
      erro.textContent = 'O pedido mínimo para entrega é ' + dinheiro(config.pedidoMinimo) + '. Faltam ' + dinheiro(config.pedidoMinimo - t.sub) + '.'; return;
    }
    if (pag === 'Dinheiro' && trocoTxt) {
      if (!isFinite(troco)) { erro.textContent = 'Escreva o troco só com números, ex.: 100.'; $('#troco').focus(); return; }
      if (troco <= t.total) { erro.textContent = 'O troco precisa ser para um valor maior que o total (' + dinheiro(t.total) + '). Se não precisa de troco, deixe em branco.'; $('#troco').focus(); return; }
    }
    if (!situacao().aberto && !config.aceitarFechado) { erro.textContent = 'Estamos fechados agora.'; return; }
    try { localStorage.setItem('chapa62-nome', nome); } catch (x) {}

    var receber = { entrega: 'Entrega', retirada: 'Retirada no balcão', mesa: 'Mesa ' + mesa }[modo];
    var linhas = ['*Pedido · ' + config.nome + '*', ''];
    Object.keys(comanda).forEach(function (id) {
      var c = comanda[id], i = itensPorId[id], obs = linhaLimpa(c.obs, MAX_OBS);
      linhas.push(c.qtd + 'x ' + i.nome + ' — ' + dinheiro(c.qtd * i.preco));
      if (obs) linhas.push('   obs: ' + obs);
    });
    linhas.push('', 'Subtotal: ' + dinheiro(t.sub));
    if (modo === 'entrega') linhas.push('Entrega: ' + dinheiro(t.taxa));
    linhas.push('*Total: ' + dinheiro(t.total) + '*', '');
    linhas.push('Nome: ' + nome, 'Receber: ' + receber);
    if (modo === 'entrega') linhas.push('Endereço: ' + end);
    linhas.push('Pagamento: ' + pag + (pag === 'Dinheiro' && trocoTxt ? ' (troco para ' + dinheiro(troco) + ')' : ''));
    if (pag === 'Pix' && config.pix) linhas.push('Chave Pix: ' + config.pix);
    var msg = linhas.join('\n');

    // Evita toque duplo abrindo duas conversas
    enviando = true; $('#enviar').disabled = true;
    setTimeout(function () { enviando = false; avisoFechado(); }, 3000);

    var link = config.whatsapp ? 'https://wa.me/' + config.whatsapp + '?text=' + encodeURIComponent(msg) : '';
    if (link) window.open(link, '_blank', 'noopener');
    mostrarEnviado(msg, link);
  });

  function mostrarEnviado(msg, link) {
    var p = $('#enviado-txt');
    if (link) {
      p.innerHTML = '<strong>Pedido pronto no WhatsApp.</strong> É só tocar em enviar na conversa. Se ela não abriu, ' +
        '<a href="' + esc(link) + '" target="_blank" rel="noopener">abra o WhatsApp por aqui</a>.';
    } else {
      p.innerHTML = '<strong>Modo demonstração.</strong> Este modelo não tem número de WhatsApp configurado. Esta é a mensagem que o restaurante receberia:';
    }
    $('#demo-msg').textContent = msg;
    $('#copiar-dica').textContent = '';
    $('#form-pedido').hidden = true;
    $('#demo').hidden = false;
    $('#copiar').focus();
  }

  $('#copiar').addEventListener('click', function () {
    var b = this, pre = $('#demo-msg'), dica = $('#copiar-dica');
    var ok = function () { b.textContent = 'Mensagem copiada'; dica.textContent = ''; setTimeout(function () { b.textContent = 'Copiar mensagem'; }, 2200); };
    var manual = function () {
      var sel = window.getSelection(), r = document.createRange();
      r.selectNodeContents(pre); sel.removeAllRanges(); sel.addRange(r);
      dica.textContent = 'Não deu para copiar sozinho. O texto está selecionado: copie com Ctrl+C ou segure e toque em Copiar.';
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(pre.textContent).then(ok, manual);
    else manual();
  });

  $('#novo').addEventListener('click', function () {
    comanda = {}; salvar();
    $$('.item .ctrl').forEach(function (ctrl) { ctrl.innerHTML = controle(itensPorId[ctrl.closest('.item').dataset.id]); });
    $('#troco').value = ''; $('#endereco-entrega').value = '';
    atualizarBarra();
    fecharJanela();
  });
  $('#editar').addEventListener('click', function () {
    mostrarFormulario(); renderComanda(); $('#nome').focus();
  });

  /* ---------- Info ---------- */
  function montarInfo() {
    montarHorarios();
    $('#endereco').innerHTML = esc(config.endereco) + '<br>' + esc(config.cidade);
    if (config.instagram) {
      $('#link-insta').href = 'https://instagram.com/' + config.instagram;
      $('#link-insta').textContent = '@' + config.instagram;
    } else $('#link-insta').hidden = true;
    if (config.mapa) {
      var lat = config.mapa.lat, lon = config.mapa.lon, z = 0.006;
      $('#link-mapa').href = 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '#map=17/' + lat + '/' + lon;
      $('#mapa').innerHTML = '<iframe title="Mapa com a localização da ' + esc(config.nome) + '" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=' +
        (lon - z) + ',' + (lat - z * .6) + ',' + (lon + z) + ',' + (lat + z * .6) + '&amp;layer=mapnik&amp;marker=' + lat + ',' + lon + '"></iframe>';
    } else {
      $('#link-mapa').href = 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(config.endereco + ', ' + config.cidade);
      $('#mapa').hidden = true;
    }
    if (Array.isArray(cardapio.creditos)) {
      $('#creditos').innerHTML = cardapio.creditos.map(function (c) {
        return '<li>' + esc(c.titulo) + ', ' + esc(c.autor) + ' (' + esc(c.licenca) + '), via Wikimedia Commons</li>';
      }).join('');
    }
  }

  /* ---------- Util ---------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function normal(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
