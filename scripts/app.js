/* Chapa 62 — modelo de site para restaurante.
   Tudo que muda de um cliente para outro fica em data/config.json e data/cardapio.json. */
(function () {
  'use strict';

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var CHAVE = 'chapa62-comanda';
  var brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var dinheiro = function (v) { return brl.format(v).replace(/ /g, ' '); };

  var config, cardapio, itensPorId = {};
  var comanda = carregar();
  var mesa = (new URLSearchParams(location.search).get('mesa') || '').replace(/\D/g, '').slice(0, 3);
  var modo = mesa ? 'mesa' : 'entrega';

  Promise.all([
    fetch('data/config.json').then(function (r) { return r.json(); }),
    fetch('data/cardapio.json').then(function (r) { return r.json(); })
  ]).then(function (d) {
    config = d[0]; cardapio = d[1];
    cardapio.categorias.forEach(function (c) { c.itens.forEach(function (i) { itensPorId[i.id] = i; }); });
    Object.keys(comanda).forEach(function (id) { if (!itensPorId[id]) delete comanda[id]; });
    aplicarCores();
    montarCardapio();
    montarInfo();
    montarModo();
    atualizarStatus();
    atualizarBarra();
    setInterval(atualizarStatus, 60000);
  }).catch(function () {
    $('#lista').innerHTML = '<p class="vazio">Não foi possível carregar o cardápio. Verifique a conexão e recarregue a página.</p>';
  });

  /* ---------- Cores do config ---------- */
  function aplicarCores() {
    var c = config.cores || {}, r = document.documentElement.style;
    var mapa = { fundo: '--mostarda', texto: '--cafe', destaque: '--ketchup', detalhe: '--picles', papel: '--papel' };
    Object.keys(mapa).forEach(function (k) { if (c[k]) r.setProperty(mapa[k], c[k]); });
    $('#comanda-casa').textContent = config.nome.toUpperCase();
    document.querySelector('meta[name="theme-color"]').content = c.fundo || '#EDB82E';
  }

  /* ---------- Horários ---------- */
  function minutos(h) { var p = h.split(':'); return +p[0] * 60 + +p[1]; }
  function horaCurta(h) { var p = h.split(':'); return +p[0] + 'h' + (p[1] !== '00' ? p[1] : ''); }

  function situacao(agora) {
    var H = config.horarios, d = agora.getDay(), m = agora.getHours() * 60 + agora.getMinutes();
    var ontem = H[(d + 6) % 7], hoje = H[d];
    if (ontem.abre && minutos(ontem.fecha) < minutos(ontem.abre) && m < minutos(ontem.fecha)) {
      return { aberto: true, texto: 'Aberto até ' + horaCurta(ontem.fecha) };
    }
    if (hoje.abre) {
      var a = minutos(hoje.abre), f = minutos(hoje.fecha);
      if (f < a) f += 1440;
      if (m >= a && m < f) return { aberto: true, texto: 'Aberto até ' + horaCurta(hoje.fecha) };
      if (m < a) return { aberto: false, texto: 'Fechado agora · abre hoje às ' + horaCurta(hoje.abre) };
    }
    for (var i = 1; i <= 7; i++) {
      var p = H[(d + i) % 7];
      if (p.abre) return { aberto: false, texto: 'Fechado agora · abre ' + (i === 1 ? 'amanhã' : p.dia.toLowerCase()) + ' às ' + horaCurta(p.abre) };
    }
    return { aberto: false, texto: 'Fechado' };
  }

  function atualizarStatus() {
    var s = situacao(new Date()), el = $('#status');
    el.textContent = s.texto;
    el.classList.toggle('aberto', s.aberto);
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
      '<button type="button" data-acao="mais" aria-label="Adicionar mais um ' + esc(i.nome) + '">+</button></div>';
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
  function carregar() {
    try { return JSON.parse(localStorage.getItem(CHAVE)) || {}; } catch (e) { return {}; }
  }
  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(comanda)); } catch (e) {}
  }

  function mudarQtd(id, delta) {
    var atual = comanda[id] || { qtd: 0, obs: '' };
    atual.qtd = Math.max(0, Math.min(30, atual.qtd + delta));
    if (atual.qtd) comanda[id] = atual; else delete comanda[id];
    salvar();
    var li = $('.item[data-id="' + id + '"]');
    if (li) {
      var ctrl = $('.ctrl', li), tinhaFoco = ctrl.contains(document.activeElement);
      ctrl.innerHTML = controle(itensPorId[id]);
      if (tinhaFoco) ($('[data-acao="' + (delta > 0 ? 'mais' : 'menos') + '"]', ctrl) || $('button', ctrl)).focus();
    }
    atualizarBarra(delta > 0);
    if ($('#comanda').open) renderComanda();
  }

  function totais() {
    var qtd = 0, sub = 0;
    Object.keys(comanda).forEach(function (id) { qtd += comanda[id].qtd; sub += comanda[id].qtd * itensPorId[id].preco; });
    var taxa = modo === 'entrega' && qtd ? (config.taxaEntrega || 0) : 0;
    return { qtd: qtd, sub: sub, taxa: taxa, total: sub + taxa };
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
    modo = m;
    $$('input[name="modo"], input[name="modo2"]').forEach(function (r) { r.checked = r.value === m; });
    var info = {
      entrega: 'Entrega em ' + config.tempoEntrega + ' · taxa de ' + dinheiro(config.taxaEntrega) + ' · pedido mínimo de ' + dinheiro(config.pedidoMinimo) + '.',
      retirada: 'Retire no balcão: ' + config.endereco + '. Avisamos no WhatsApp quando estiver pronto.',
      mesa: 'O pedido vai direto para a cozinha com o número da mesa ' + mesa + '.'
    };
    $('#modo-info').textContent = info[m];
    $('#campo-endereco').hidden = m !== 'entrega';
    atualizarBarra();
    if ($('#comanda').open) renderContas();
  }

  /* ---------- Comanda (tela) ---------- */
  var dialog = $('#comanda');
  $('#barra').addEventListener('click', abrirComanda);
  $('#fechar').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });

  function abrirComanda() {
    var nomeSalvo = ''; try { nomeSalvo = localStorage.getItem('chapa62-nome') || ''; } catch (e) {}
    if (!$('#nome').value) $('#nome').value = nomeSalvo;
    $('#demo').hidden = true; $('#form-pedido').hidden = false; $('#erro').textContent = '';
    renderComanda();
    dialog.showModal();
  }

  function renderComanda() {
    var ids = Object.keys(comanda), ul = $('#comanda-itens');
    var agora = new Date();
    $('#comanda-data').textContent = agora.toLocaleDateString('pt-BR') + ' · ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    $('#comanda-vazia').hidden = ids.length > 0;
    $('#form-pedido').hidden = !ids.length;
    ul.innerHTML = ids.map(function (id) {
      var c = comanda[id], i = itensPorId[id];
      return '<li class="c-item" data-id="' + id + '">' +
        '<div class="c-linha"><span class="c-nome">' + c.qtd + 'x ' + esc(i.nome) + '</span><span class="c-pontos"></span>' +
        '<span class="c-valor">' + dinheiro(c.qtd * i.preco).replace('R$ ', '') + '</span></div>' +
        '<div class="c-acoes"><div class="passo">' +
        '<button type="button" data-acao="menos" aria-label="Tirar um ' + esc(i.nome) + '">−</button>' +
        '<output>' + c.qtd + '</output>' +
        '<button type="button" data-acao="mais" aria-label="Adicionar mais um ' + esc(i.nome) + '">+</button></div>' +
        (c.obs ? '' : '<button type="button" class="c-obs-btn" data-obs>Observação</button>') + '</div>' +
        (c.obs ? obsCampo(id, c.obs) : '') + '</li>';
    }).join('');
    renderContas();
  }

  function obsCampo(id, valor) {
    return '<label class="sr-only" for="obs-' + id + '">Observação para ' + esc(itensPorId[id].nome) + '</label>' +
      '<input class="c-obs" id="obs-' + id + '" data-obs-input maxlength="120" placeholder="Ex.: sem cebola, ponto da carne" value="' + esc(valor || '') + '">';
  }

  $('#comanda-itens').addEventListener('click', function (e) {
    var li = e.target.closest('.c-item'); if (!li) return;
    var b = e.target.closest('button[data-acao]');
    if (b) {
      var id = li.dataset.id, delta = b.dataset.acao === 'mais' ? 1 : -1;
      mudarQtd(id, delta);
      var nova = $('.c-item[data-id="' + id + '"] [data-acao="' + b.dataset.acao + '"]');
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
    comanda[id].obs = e.target.value; salvar();
  });

  function renderContas() {
    var t = totais(), html = '<dt>Subtotal</dt><dd>' + dinheiro(t.sub) + '</dd>';
    if (modo === 'entrega') html += '<dt>Entrega</dt><dd>' + dinheiro(t.taxa) + '</dd>';
    html += '<dt class="total">Total</dt><dd class="total">' + dinheiro(t.total) + '</dd>';
    $('#contas').innerHTML = html;
  }

  $$('input[name="pagamento"]').forEach(function (r) {
    r.addEventListener('change', function () { $('#campo-troco').hidden = r.value !== 'Dinheiro' || !r.checked; });
  });

  /* ---------- Enviar ---------- */
  $('#form-pedido').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = totais(), erro = $('#erro'), nome = $('#nome').value.trim(), end = $('#endereco-entrega').value.trim();
    var pag = $('input[name="pagamento"]:checked').value, troco = $('#troco').value.trim();
    erro.textContent = '';
    if (!nome) { erro.textContent = 'Escreva seu nome para a cozinha chamar quando ficar pronto.'; $('#nome').focus(); return; }
    if (modo === 'entrega' && !end) { erro.textContent = 'Escreva o endereço de entrega.'; $('#endereco-entrega').focus(); return; }
    if (modo === 'entrega' && t.sub < config.pedidoMinimo) {
      erro.textContent = 'O pedido mínimo para entrega é ' + dinheiro(config.pedidoMinimo) + '. Faltam ' + dinheiro(config.pedidoMinimo - t.sub) + '.'; return;
    }
    try { localStorage.setItem('chapa62-nome', nome); } catch (x) {}

    var receber = { entrega: 'Entrega', retirada: 'Retirada no balcão', mesa: 'Mesa ' + mesa }[modo];
    var linhas = ['*Pedido · ' + config.nome + '*', ''];
    Object.keys(comanda).forEach(function (id) {
      var c = comanda[id], i = itensPorId[id];
      linhas.push(c.qtd + 'x ' + i.nome + ' — ' + dinheiro(c.qtd * i.preco));
      if (c.obs && c.obs.trim()) linhas.push('   obs: ' + c.obs.trim());
    });
    linhas.push('', 'Subtotal: ' + dinheiro(t.sub));
    if (modo === 'entrega') linhas.push('Entrega: ' + dinheiro(t.taxa));
    linhas.push('*Total: ' + dinheiro(t.total) + '*', '');
    linhas.push('Nome: ' + nome, 'Receber: ' + receber);
    if (modo === 'entrega') linhas.push('Endereço: ' + end);
    linhas.push('Pagamento: ' + pag + (pag === 'Dinheiro' && troco ? ' (troco para R$ ' + troco + ')' : ''));
    if (pag === 'Pix' && config.pix) linhas.push('Chave Pix: ' + config.pix);
    var msg = linhas.join('\n');

    var numero = (config.whatsapp || '').replace(/\D/g, '');
    if (numero) {
      window.open('https://wa.me/' + numero + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
    } else {
      $('#demo-msg').textContent = msg;
      $('#form-pedido').hidden = true;
      $('#demo').hidden = false;
      $('#copiar').focus();
    }
  });

  $('#copiar').addEventListener('click', function () {
    var b = this, txt = $('#demo-msg').textContent;
    var ok = function () { b.textContent = 'Mensagem copiada'; setTimeout(function () { b.textContent = 'Copiar mensagem'; }, 2200); };
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(ok, function () {});
  });

  /* ---------- Info ---------- */
  function montarInfo() {
    var d = new Date().getDay();
    $('#horarios').innerHTML = config.horarios.map(function (h, i) {
      return '<tr' + (i === d ? ' class="hoje"' : '') + '><th scope="row">' + h.dia + '</th><td>' +
        (h.abre ? horaCurta(h.abre) + ' às ' + horaCurta(h.fecha) : 'Fechado') + '</td></tr>';
    }).join('');
    $('#endereco').innerHTML = esc(config.endereco) + '<br>' + esc(config.cidade);
    var lat = config.mapa.lat, lon = config.mapa.lon, z = 0.006;
    $('#link-mapa').href = 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '#map=17/' + lat + '/' + lon;
    $('#link-insta').href = 'https://instagram.com/' + config.instagram;
    $('#link-insta').textContent = '@' + config.instagram;
    $('#mapa').innerHTML = '<iframe title="Mapa com a localização da ' + esc(config.nome) + '" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=' +
      (lon - z) + ',' + (lat - z * .6) + ',' + (lon + z) + ',' + (lat + z * .6) + '&layer=mapnik&marker=' + lat + ',' + lon + '"></iframe>';
    if (cardapio.creditos) {
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
