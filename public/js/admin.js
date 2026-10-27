(function () {
  'use strict';
  var TIPOS = { imovel: 'Imóvel', veiculo: 'Veículo', moto: 'Moto', pesados: 'Pesados', servicos: 'Serviços' };
  var KEY = 'consorcio-admin-token';
  var db = null;
  var editando = null; // id do grupo em edição (null = novo)

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(v) { return v == null || v === '' ? '' : String(v).replace('.', ','); }
  function dec(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    // Aceita "1.234,5" (pt-BR) e "1234.5".
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }
  function pct(v) { return v == null ? '–' : fmt(Math.round(v * 10) / 10) + '%'; }

  function getToken() { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } }
  function setToken(t) { try { if (t) sessionStorage.setItem(KEY, t); else sessionStorage.removeItem(KEY); } catch (e) { /* sem storage */ } }
  var token = getToken();

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || '') },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401 && url.indexOf('/login') < 0) { sair(); throw new Error(data.error || 'Sessão expirada'); }
        if (!r.ok) throw new Error(data.error || 'Erro ' + r.status);
        return data;
      });
    });
  }

  function msg(id, texto, tipo) {
    var e = $(id);
    e.textContent = texto || '';
    e.className = 'form-msg' + (tipo ? ' ' + tipo : '');
  }

  // ---------- Login ----------
  $('form-login').addEventListener('submit', function (e) {
    e.preventDefault();
    msg('login-msg', 'Entrando…');
    api('POST', 'api/admin/login', { password: $('senha').value })
      .then(function (r) { token = r.token; setToken(token); $('senha').value = ''; msg('login-msg', ''); carregar(); })
      .catch(function (err) { msg('login-msg', err.message, 'erro'); });
  });
  function sair() {
    token = null; setToken(null);
    $('painel').hidden = true; $('login').hidden = false; $('btn-sair').hidden = true;
  }
  $('btn-sair').addEventListener('click', sair);

  function carregar() {
    api('GET', 'api/admin/data').then(function (data) {
      db = data;
      $('login').hidden = true; $('painel').hidden = false; $('btn-sair').hidden = false;
      renderLista();
      preencherConfig();
    }).catch(function () { /* tela de login permanece */ });
  }
  if (token) carregar();

  // ---------- Abas ----------
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) { x.setAttribute('aria-selected', x === t ? 'true' : 'false'); });
      $('tab-grupos').hidden = t.dataset.tab !== 'grupos';
      $('tab-config').hidden = t.dataset.tab !== 'config';
    });
  });

  // ---------- Lista de grupos ----------
  function renderLista() {
    var box = $('lista-grupos');
    if (!db.grupos.length) { box.innerHTML = '<p class="hint">Nenhum grupo cadastrado.</p>'; return; }
    box.innerHTML = db.grupos.map(function (g) {
      return '<article class="group">' +
        '<div><h3>' + esc(g.nome) + (g.ativo ? '' : '<span class="tag off">inativo</span>') + '<span class="tag">' + esc(TIPOS[g.tipo]) + '</span></h3>' +
        '<div class="meta">' + g.prazo + ' meses · Adm. ' + pct(g.taxaAdm) + ' · F. reserva ' + pct(g.fundoReserva) + ' · ' + esc(g.indice) + '</div></div>' +
        '<div class="group-media"><strong>' + pct(g.mediaLance6m) + '</strong><small>média 6 meses</small></div>' +
        '<button class="btn btn-sm btn-ghost" type="button" data-id="' + esc(g.id) + '">Editar</button>' +
        '</article>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('button[data-id]'), function (b) {
      b.addEventListener('click', function () { abrirEditor(b.dataset.id); });
    });
  }

  // ---------- Editor ----------
  var form = $('form-grupo');
  var dlg = $('dlg-grupo');

  function rotulosMeses() {
    var out = [], d = new Date();
    for (var i = 6; i >= 1; i--) {
      var m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push(m.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', ''));
    }
    return out;
  }

  function abrirEditor(id) {
    editando = id || null;
    var g = id ? db.grupos.find(function (x) { return x.id === id; }) : {
      nome: '', tipo: 'imovel', creditoMin: 100000, creditoMax: 500000, prazo: 180, taxaAdm: 18, fundoReserva: 2,
      seguroMensal: 0.03, indice: 'IPCA', reajustePct: null, parcelaReduzidaPct: 0, lanceEmbutidoMax: 30,
      mediaLance6m: null, historicoLances: [], ativo: true
    };
    $('dlg-titulo').textContent = id ? 'Editar grupo' : 'Novo grupo';
    $('btn-excluir').hidden = !id;
    msg('grupo-msg', '');
    ['id', 'nome', 'tipo', 'indice'].forEach(function (k) { form.elements[k].value = g[k] || (k === 'id' ? '' : form.elements[k].value); });
    form.elements.id.readOnly = !!id;
    ['creditoMin', 'creditoMax', 'prazo', 'taxaAdm', 'fundoReserva', 'seguroMensal', 'reajustePct', 'parcelaReduzidaPct', 'lanceEmbutidoMax', 'mediaLance6m']
      .forEach(function (k) { form.elements[k].value = fmt(g[k]); });
    form.elements.ativo.checked = g.ativo !== false;

    var labels = rotulosMeses();
    var hist = g.historicoLances || [];
    $('hist-inputs').innerHTML = labels.map(function (l, i) {
      return '<label class="field"><span>' + esc(l) + '</span><input inputmode="decimal" data-hist="' + i + '" value="' + esc(fmt(hist[i])) + '"></label>';
    }).join('');
    Array.prototype.forEach.call($('hist-inputs').querySelectorAll('input'), function (inp) {
      inp.addEventListener('input', recalcularMedia);
    });
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  function historico() {
    return Array.prototype.map.call($('hist-inputs').querySelectorAll('input'), function (i) { return dec(i.value); });
  }
  function recalcularMedia() {
    var m = window.ConsorcioCalc.media(historico().filter(function (v) { return v != null; }));
    if (m != null) form.elements.mediaLance6m.value = fmt(Math.round(m * 10) / 10);
  }

  function fechar() { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  $('dlg-fechar').addEventListener('click', fechar);
  $('btn-cancelar').addEventListener('click', fechar);
  $('btn-novo').addEventListener('click', function () { abrirEditor(null); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = form.elements;
    var id = f.id.value.trim().toLowerCase();
    if (!/^[a-z0-9-]{1,60}$/.test(id)) { msg('grupo-msg', 'Código inválido: use letras minúsculas, números e hífen.', 'erro'); return; }
    if (!editando && db.grupos.some(function (g) { return g.id === id; })) { msg('grupo-msg', 'Já existe um grupo com este código.', 'erro'); return; }
    var body = {
      nome: f.nome.value.trim(),
      tipo: f.tipo.value,
      creditoMin: dec(f.creditoMin.value),
      creditoMax: dec(f.creditoMax.value),
      prazo: dec(f.prazo.value),
      taxaAdm: dec(f.taxaAdm.value),
      fundoReserva: dec(f.fundoReserva.value),
      seguroMensal: dec(f.seguroMensal.value),
      indice: f.indice.value,
      reajustePct: dec(f.reajustePct.value),
      parcelaReduzidaPct: dec(f.parcelaReduzidaPct.value),
      lanceEmbutidoMax: dec(f.lanceEmbutidoMax.value),
      mediaLance6m: dec(f.mediaLance6m.value),
      historicoLances: historico(),
      ativo: f.ativo.checked
    };
    msg('grupo-msg', 'Salvando…');
    api('PUT', 'api/admin/grupos/' + encodeURIComponent(id), body).then(function (g) {
      var idx = db.grupos.findIndex(function (x) { return x.id === g.id; });
      if (idx >= 0) db.grupos[idx] = g; else db.grupos.push(g);
      renderLista();
      fechar();
    }).catch(function (err) { msg('grupo-msg', err.message, 'erro'); });
  });

  $('btn-excluir').addEventListener('click', function () {
    if (!editando || !confirm('Excluir este grupo? Esta ação não pode ser desfeita.')) return;
    api('DELETE', 'api/admin/grupos/' + encodeURIComponent(editando)).then(function () {
      db.grupos = db.grupos.filter(function (g) { return g.id !== editando; });
      renderLista();
      fechar();
    }).catch(function (err) { msg('grupo-msg', err.message, 'erro'); });
  });

  // ---------- Configurações ----------
  var formCfg = $('form-config');
  function preencherConfig() {
    var c = db.config;
    formCfg.elements.nomeConsultor.value = c.nomeConsultor || '';
    formCfg.elements.whatsapp.value = c.whatsapp || '';
    Object.keys(c.indices || {}).forEach(function (k) {
      var inp = formCfg.elements['indices.' + k]; if (inp) inp.value = fmt(c.indices[k]);
    });
    Object.keys(c.jurosFinanciamento || {}).forEach(function (k) {
      var inp = formCfg.elements['jurosFinanciamento.' + k]; if (inp) inp.value = fmt(c.jurosFinanciamento[k]);
    });
  }
  formCfg.addEventListener('submit', function (e) {
    e.preventDefault();
    var body = { nomeConsultor: formCfg.elements.nomeConsultor.value, whatsapp: formCfg.elements.whatsapp.value, indices: {}, jurosFinanciamento: {} };
    Array.prototype.forEach.call(formCfg.querySelectorAll('input[name*="."]'), function (inp) {
      var parts = inp.name.split('.');
      body[parts[0]][parts[1]] = dec(inp.value);
    });
    if (body.whatsapp.replace(/\D/g, '').length < 10) { msg('config-msg', 'Informe o WhatsApp com DDI e DDD (ex.: 5511999999999).', 'erro'); return; }
    msg('config-msg', 'Salvando…');
    api('PUT', 'api/admin/config', body).then(function (c) {
      db.config = c;
      preencherConfig();
      msg('config-msg', 'Configurações salvas.', 'ok');
    }).catch(function (err) { msg('config-msg', err.message, 'erro'); });
  });
})();
