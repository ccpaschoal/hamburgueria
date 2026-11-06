/* Admin da Chapa 62: lista os pedidos registrados na API, muda o status e confere mensagens do WhatsApp.
   O token de acesso fica só nesta aba (sessionStorage) e vale 12 horas. */
(function () {
  'use strict';

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var API = '', token = '', filtro = '', pedidos = [], timer = null, ultimoNovo = null;
  var NOMES = { novo: 'Novo', confirmado: 'Confirmado', pronto: 'Pronto', concluido: 'Concluído', cancelado: 'Cancelado' };
  var PROXIMO = { novo: ['confirmado', 'Confirmar'], confirmado: ['pronto', 'Marcar como pronto'], pronto: ['concluido', 'Concluir'] };

  try { token = sessionStorage.getItem('chapa62-admin') || ''; } catch (e) {}

  fetch('data/config.json').then(function (r) { return r.json(); }).then(function (c) {
    API = /^(https:\/\/[\w.-]+|http:\/\/localhost:\d+)$/.test(c.api || '') ? c.api : '';
    if (!API) { $('#login-erro').textContent = 'A API não está configurada no data/config.json.'; return; }
    if (token) entrar(); else $('#senha').focus();
  }).catch(function () { $('#login-erro').textContent = 'Não foi possível carregar a configuração. Recarregue a página.'; });

  /* ---------- Chamada à API ---------- */
  function api(caminho, opcoes) {
    opcoes = opcoes || {};
    var h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    return fetch(API + caminho, { method: opcoes.method || 'GET', headers: h, body: opcoes.body ? JSON.stringify(opcoes.body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (r.status === 401 && caminho !== '/admin/login') { sair('Sua sessão expirou. Entre de novo.'); throw new Error('sessao'); }
          if (!r.ok) throw new Error(d.erro || 'Erro ' + r.status + '. Tente de novo.');
          return d;
        });
      }, function () { throw new Error('Sem conexão com o servidor. Verifique a internet.'); });
  }

  /* ---------- Login ---------- */
  $('#login').addEventListener('submit', function (e) {
    e.preventDefault();
    var senha = $('#senha').value, erro = $('#login-erro'), botao = $('#login button');
    if (!senha) { erro.textContent = 'Digite a senha.'; return; }
    botao.disabled = true; erro.textContent = '';
    api('/admin/login', { method: 'POST', body: { senha: senha } }).then(function (d) {
      token = d.token;
      try { sessionStorage.setItem('chapa62-admin', token); } catch (x) {}
      $('#senha').value = '';
      entrar();
    }).catch(function (x) { erro.textContent = x.message; $('#senha').select(); })
      .then(function () { botao.disabled = false; });
  });

  function entrar() {
    $('#login').hidden = true; $('#painel').hidden = false; $('#sair').hidden = false;
    carregar();
    clearInterval(timer);
    timer = setInterval(function () { if (!document.hidden) carregar(); }, 20000);
  }

  function sair(motivo) {
    token = ''; clearInterval(timer);
    try { sessionStorage.removeItem('chapa62-admin'); } catch (e) {}
    $('#painel').hidden = true; $('#sair').hidden = true; $('#login').hidden = false;
    $('#login-erro').textContent = motivo || '';
    $('#senha').focus();
  }
  $('#sair').addEventListener('click', function () { sair(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && token) carregar(); });

  /* ---------- Lista ---------- */
  function carregar() {
    var q = $('#busca-codigo').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    var params = [];
    if (filtro) params.push('status=' + filtro);
    if (q) params.push('q=' + q);
    return api('/admin/pedidos' + (params.length ? '?' + params.join('&') : '')).then(function (d) {
      pedidos = d.pedidos || [];
      desenhar();
      var novos = pedidos.filter(function (p) { return p.status === 'novo'; }).length;
      document.title = (novos ? '(' + novos + ') ' : '') + 'Admin · Chapa 62';
      var maisRecente = pedidos.length ? pedidos[0].codigo : null;
      if (ultimoNovo && maisRecente && maisRecente !== ultimoNovo && pedidos[0].status === 'novo') avisarNovo();
      ultimoNovo = maisRecente || ultimoNovo;
      $('#info').textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' · atualiza sozinho a cada 20 s';
    }).catch(function (x) { if (x.message !== 'sessao') $('#info').textContent = x.message; });
  }

  function avisarNovo() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)(), o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = .08; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + .25);
    } catch (e) {}
  }

  function reais(c) { return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function hora(s) {
    var d = new Date(String(s).replace(' ', 'T') + 'Z');
    return isNaN(d) ? s : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function desenhar() {
    $('#vazio').hidden = pedidos.length > 0;
    $('#lista').innerHTML = pedidos.map(function (p) {
      var receber = p.modo === 'mesa' ? 'Mesa ' + esc(p.mesa) : p.modo === 'entrega' ? 'Entrega' : 'Retirada';
      var prox = PROXIMO[p.status];
      return '<li class="adm-pedido st-' + p.status + '" data-codigo="' + esc(p.codigo) + '">' +
        '<div class="adm-cab"><strong class="adm-codigo">' + esc(p.codigo) + '</strong>' +
        '<span class="adm-status">' + NOMES[p.status] + '</span><time>' + esc(hora(p.criado_em)) + '</time></div>' +
        '<p class="adm-quem"><strong>' + esc(p.nome) + '</strong> · ' + receber + '</p>' +
        (p.endereco ? '<p class="adm-end">' + esc(p.endereco) + '</p>' : '') +
        '<ul class="adm-itens">' + p.itens.map(function (i) {
          return '<li><span>' + i.qtd + 'x ' + esc(i.nome) + '</span><span>' + reais(i.preco * i.qtd) + '</span>' +
            (i.obs ? '<em>obs: ' + esc(i.obs) + '</em>' : '') + '</li>';
        }).join('') + '</ul>' +
        '<p class="adm-total"><span>Total' + (p.taxa_centavos ? ' (com entrega ' + reais(p.taxa_centavos) + ')' : '') + '</span><strong>' + reais(p.total_centavos) + '</strong></p>' +
        '<p class="adm-pag">' + esc(p.pagamento) + (p.troco_centavos ? ' · troco para ' + reais(p.troco_centavos) : '') + '</p>' +
        '<div class="adm-acoes">' +
        (prox ? '<button type="button" class="enviar" data-status="' + prox[0] + '">' + prox[1] + '</button>' : '') +
        (p.status !== 'cancelado' && p.status !== 'concluido' ? '<button type="button" class="adm-cancelar" data-status="cancelado">Cancelar</button>' : '') +
        (p.status === 'cancelado' ? '<button type="button" class="adm-cancelar" data-status="novo">Reabrir</button>' : '') +
        '</div></li>';
    }).join('');
  }

  $('#lista').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-status]'); if (!b) return;
    var codigo = b.closest('[data-codigo]').dataset.codigo, status = b.dataset.status;
    if (status === 'cancelado' && !window.confirm('Cancelar o pedido ' + codigo + '?')) return;
    b.disabled = true;
    api('/admin/pedidos/' + codigo, { method: 'PATCH', body: { status: status } })
      .then(carregar)
      .catch(function (x) { if (x.message !== 'sessao') { $('#info').textContent = x.message; b.disabled = false; } });
  });

  $('#filtros').addEventListener('click', function (e) {
    var a = e.target.closest('a[data-status]'); if (!a) return;
    e.preventDefault();
    filtro = a.dataset.status;
    $$('#filtros a').forEach(function (x) { if (x === a) x.setAttribute('aria-current', 'true'); else x.removeAttribute('aria-current'); });
    carregar();
  });

  var espera;
  $('#busca-codigo').addEventListener('input', function () { clearTimeout(espera); espera = setTimeout(carregar, 350); });

  /* ---------- Conferir mensagem ---------- */
  function normal(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  $('#colar').addEventListener('input', function () {
    var txt = this.value, out = $('#resultado');
    out.className = 'adm-resultado';
    if (!txt.trim()) { out.textContent = ''; return; }
    var m = txt.match(/Pedido ([A-HJKMNP-Z2-9]{6})\b/);
    if (!m) { out.textContent = 'Esta mensagem não tem código de pedido. Ela não passou pelo site: confira os valores pelo cardápio antes de aceitar.'; out.classList.add('ruim'); return; }
    var codigo = m[1];
    api('/admin/pedidos?q=' + codigo).then(function (d) {
      var p = (d.pedidos || []).filter(function (x) { return x.codigo === codigo; })[0];
      if (!p) { out.textContent = 'O código ' + codigo + ' não existe no sistema. Não aceite sem conferir: a mensagem pode ter sido inventada.'; out.classList.add('ruim'); return; }
      if (normal(txt) === normal(p.mensagem)) {
        out.textContent = 'Confere: a mensagem é igual ao pedido ' + codigo + ' registrado (total ' + reais(p.total_centavos) + ').'; out.classList.add('bom');
      } else {
        out.textContent = 'Atenção: a mensagem é diferente do pedido ' + codigo + ' registrado. Vale o que está no admin: total ' + reais(p.total_centavos) + '.'; out.classList.add('ruim');
      }
      $('#busca-codigo').value = codigo; carregar();
    }).catch(function (x) { if (x.message !== 'sessao') out.textContent = x.message; });
  });

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
})();
