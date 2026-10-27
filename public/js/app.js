(function () {
  'use strict';
  var C = window.ConsorcioCalc;
  var Charts = window.Charts;

  var TIPOS = {
    imovel: 'Imóvel',
    veiculo: 'Veículo',
    moto: 'Moto',
    pesados: 'Pesados',
    servicos: 'Serviços'
  };

  var brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  var int = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  function pct(v, d) {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d == null ? 2 : d }).format(v) + '%';
  }
  function compact(v) {
    if (v >= 1e6) return 'R$ ' + new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v / 1e6) + ' mi';
    if (v >= 1e3) return 'R$ ' + new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v / 1e3) + ' mil';
    return 'R$ ' + int.format(v);
  }
  function parseNum(s) {
    var v = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
    return isFinite(v) ? v : 0;
  }
  function parseDec(s) {
    var v = parseFloat(String(s).replace(',', '.'));
    return isFinite(v) ? v : 0;
  }
  function $(id) { return document.getElementById(id); }
  function text(id, v) { $(id).textContent = v; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var state = {
    data: null,
    tipo: null,
    grupo: null,
    credito: 0,
    reduzida: false,
    mes: 12,
    indice: 0,
    bolso: 0,
    embutido: 0,
    cenario: 'A'
  };
  var ultimo = null; // última simulação calculada

  // ---------------- Carregamento ----------------
  fetch('api/public')
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch(function () {
      var e = $('load-error');
      e.hidden = false;
      e.textContent = 'Não foi possível carregar os grupos disponíveis. Atualize a página ou tente novamente em instantes.';
    });

  function init(data) {
    state.data = data;
    if (data.config && data.config.nomeConsultor) text('consultor-nome', data.config.nomeConsultor);
    var tipos = Object.keys(TIPOS).filter(function (t) {
      return data.grupos.some(function (g) { return g.tipo === t; });
    });
    var box = $('tipos');
    box.innerHTML = '';
    tipos.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('role', 'radio');
      b.dataset.tipo = t;
      b.textContent = TIPOS[t];
      b.addEventListener('click', function () { selecionarTipo(t); });
      box.appendChild(b);
    });
    bind();
    if (tipos.length) selecionarTipo(tipos[0]);
  }

  function selecionarTipo(t) {
    state.tipo = t;
    Array.prototype.forEach.call($('tipos').children, function (b) {
      b.setAttribute('aria-checked', b.dataset.tipo === t ? 'true' : 'false');
    });
    var sel = $('grupo');
    sel.innerHTML = '';
    gruposDoTipo().forEach(function (g) {
      var o = document.createElement('option');
      o.value = g.id;
      o.textContent = g.nome;
      sel.appendChild(o);
    });
    selecionarGrupo(sel.value);
  }
  function gruposDoTipo() {
    return state.data.grupos.filter(function (g) { return g.tipo === state.tipo; });
  }

  function selecionarGrupo(id) {
    var g = state.data.grupos.find(function (x) { return x.id === id; });
    if (!g) return;
    state.grupo = g;
    var range = $('credito-range');
    var span = g.creditoMax - g.creditoMin;
    var step = span >= 500000 ? 5000 : span >= 100000 ? 1000 : 500;
    range.min = g.creditoMin;
    range.max = g.creditoMax;
    range.step = step;
    if (!state.credito || state.credito < g.creditoMin || state.credito > g.creditoMax) {
      state.credito = Math.round((g.creditoMin + span * 0.3) / step) * step;
    }
    text('credito-min', compact(g.creditoMin));
    text('credito-max', compact(g.creditoMax));

    var mes = $('mes');
    mes.max = g.prazo - 1;
    state.mes = Math.min(state.mes, g.prazo - 1);

    var cfgIdx = (state.data.config.indices || {})[g.indice];
    state.indice = g.reajustePct != null ? g.reajustePct : (cfgIdx || 0);
    text('indice-nome', g.indice);
    $('indice').value = String(state.indice).replace('.', ',');

    var temReduzida = g.parcelaReduzidaPct > 0 && g.parcelaReduzidaPct < 100;
    $('reduzida-wrap').hidden = !temReduzida;
    if (!temReduzida) state.reduzida = false;
    $('reduzida').checked = state.reduzida;
    if (temReduzida) {
      text('reduzida-label', g.parcelaReduzidaPct === 50
        ? 'Meia parcela (50%) até a contemplação'
        : 'Parcela reduzida (' + pct(g.parcelaReduzidaPct, 0) + ') até a contemplação');
    }

    text('grupo-info', g.prazo + ' meses · Taxa adm. ' + pct(g.taxaAdm) + ' · Fundo de reserva ' + pct(g.fundoReserva) +
      ' · Reajuste pelo ' + g.indice + (g.lanceEmbutidoMax > 0 ? ' · Lance embutido até ' + pct(g.lanceEmbutidoMax, 0) : ''));
    syncInputs();
    atualizar();
  }

  function syncInputs() {
    $('credito').value = int.format(state.credito);
    $('credito-range').value = state.credito;
    $('mes').value = state.mes;
  }

  // ---------------- Eventos ----------------
  function bind() {
    $('grupo').addEventListener('change', function (e) { selecionarGrupo(e.target.value); });
    $('credito').addEventListener('input', function (e) {
      var digits = e.target.value.replace(/\D/g, '');
      state.credito = digits ? parseInt(digits, 10) : 0;
      e.target.value = digits ? int.format(state.credito) : '';
      $('credito-range').value = state.credito;
      atualizar();
    });
    $('credito').addEventListener('blur', function () {
      var g = state.grupo;
      state.credito = Math.min(g.creditoMax, Math.max(g.creditoMin, state.credito));
      syncInputs();
      atualizar();
    });
    $('credito-range').addEventListener('input', function (e) {
      state.credito = Number(e.target.value);
      $('credito').value = int.format(state.credito);
      atualizar();
    });
    $('reduzida').addEventListener('change', function (e) { state.reduzida = e.target.checked; atualizar(); });
    $('mes').addEventListener('input', function (e) { state.mes = Number(e.target.value); atualizar(); });
    $('indice').addEventListener('input', function (e) { state.indice = parseDec(e.target.value); atualizar(); });
    $('lance-bolso').addEventListener('input', function (e) { state.bolso = parseDec(e.target.value); atualizar(); });
    $('lance-embutido').addEventListener('input', function (e) { state.embutido = parseDec(e.target.value); atualizar(); });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="cenario"]'), function (r) {
      r.addEventListener('change', function (e) { state.cenario = e.target.value; atualizarSticky(); });
    });
    $('btn-whats').addEventListener('click', enviarWhatsApp);

    var t;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(function () { if (ultimo) desenharGraficos(); }, 150);
    });
  }

  function params() {
    var g = state.grupo;
    return {
      credito: state.credito,
      prazo: g.prazo,
      taxaAdm: g.taxaAdm,
      fundoReserva: g.fundoReserva,
      seguroMensal: g.seguroMensal,
      indiceAnual: state.indice,
      parcelaReduzidaPct: state.reduzida ? g.parcelaReduzidaPct : 100,
      mesContemplacao: state.mes,
      lanceBolso: state.bolso,
      lanceEmbutido: state.embutido,
      lanceEmbutidoMax: g.lanceEmbutidoMax
    };
  }

  // ---------------- Renderização ----------------
  function atualizar() {
    if (!state.grupo || state.credito <= 0) return;
    var p = params();
    var g = state.grupo;
    var sim = C.simular(p);
    var proj = C.projecaoReajuste(p);
    var juros = (state.data.config.jurosFinanciamento || {})[g.tipo] || 1;
    var cmp = C.comparativo(p, juros);
    var aval = C.avaliarLance(sim.lance.totalPct, g.mediaLance6m, g.historicoLances);
    ultimo = { p: p, sim: sim, proj: proj, cmp: cmp, aval: aval };

    text('mes-valor', state.mes + 'º mês');
    text('kpi-cheia', brl.format(sim.parcelaCheia));
    text('kpi-pre', brl.format(sim.parcelaPre));
    $('kpi-pre-wrap').classList.toggle('kpi-main', sim.usaReduzida);
    $('kpi-pre-wrap').hidden = !sim.usaReduzida;
    text('kpi-prazo', g.prazo + ' meses');

    renderComposicao(sim.composicao, sim.usaReduzida);
    renderReajuste(proj, g);
    renderLance(sim, aval, g);
    renderPos(sim);
    renderComparativo(cmp);
    desenharGraficos();
    atualizarSticky();
  }

  function renderComposicao(c, usaReduzida) {
    var itens = [
      ['Fundo comum (vai para o seu crédito)', 'fundoComum'],
      ['Taxa de administração', 'taxaAdm'],
      ['Fundo de reserva', 'fundoReserva'],
      ['Seguro', 'seguro']
    ];
    var rows = itens.filter(function (i) { return c.cheia[i[1]] > 0; }).map(function (i) {
      return '<tr><td>' + i[0] + '</td><td class="num">' + brl.format(c.cheia[i[1]]) + '</td>' +
        (usaReduzida ? '<td class="num">' + brl.format(c.reduzida[i[1]]) + '</td>' : '') + '</tr>';
    });
    rows.push('<tr class="total"><td>Parcela</td><td class="num">' + brl.format(c.cheia.total) + '</td>' +
      (usaReduzida ? '<td class="num">' + brl.format(c.reduzida.total) + '</td>' : '') + '</tr>');
    $('tbl-comp').innerHTML = rows.join('');
    $('th-reduzida').hidden = !usaReduzida;

    text('f-adm', pct(c.taxaAdmTotalPct) + ' no total · ' + pct(c.taxaAdmMensalPct, 3) + ' ao mês');
    text('f-fr', pct(c.fundoReservaTotalPct) + ' no total · ' + pct(c.fundoReservaMensalPct, 3) + ' ao mês');
    text('f-seg', c.seguroMensalPct > 0 ? pct(c.seguroMensalPct, 3) + ' ao mês sobre o saldo devedor' : 'Não incluso');
    text('f-total', brl.format(c.custoTotalPlano));
  }

  function renderReajuste(proj, g) {
    var ult = proj[proj.length - 1];
    var acum = (ult.fator - 1) * 100;
    text('reaj-texto', state.indice > 0
      ? 'Com o ' + g.indice + ' projetado em ' + pct(state.indice) + ' ao ano, sua carta passa de ' + brl0.format(proj[0].credito) +
        ' para ' + brl0.format(ult.credito) + ' no ' + ult.ano + 'º ano (+' + pct(acum, 1) + '). A parcela sobe exatamente na mesma proporção — você paga mais porque o seu crédito vale mais.'
      : 'Sem reajuste projetado, carta e parcela permanecem constantes. Na prática, o índice do grupo corrige ambos anualmente, na mesma proporção.');
    $('tbl-reaj').innerHTML = proj.map(function (r) {
      return '<tr><td>' + r.ano + 'º ano</td><td class="num">' + brl.format(r.credito) + '</td><td class="num">' +
        brl.format(r.parcela) + '</td><td class="num">+' + pct((r.fator - 1) * 100, 1) + '</td></tr>';
    }).join('');
  }

  function rotulosMeses() {
    var out = [];
    var d = new Date();
    for (var i = 6; i >= 1; i--) {
      var m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push(m.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''));
    }
    return out;
  }

  function renderLance(sim, aval, g) {
    text('lance-media', g.mediaLance6m != null ? pct(g.mediaLance6m, 1) : '–');
    text('lance-max', aval.maximo != null ? pct(aval.maximo, 1) : '–');
    text('lance-bolso-r', state.bolso > 0 ? '≈ ' + brl.format(sim.lance.bolsoR) + ' pagos do seu bolso' : 'Ex.: 20 = 20% do crédito');
    text('lance-embutido-r', g.lanceEmbutidoMax > 0
      ? (state.embutido > 0 ? '≈ ' + brl.format(sim.lance.embutidoR) + ' descontados da carta · ' : '') + 'máx. ' + pct(g.lanceEmbutidoMax, 0) + ' neste grupo'
      : 'Este grupo não permite lance embutido');
    $('lance-embutido').disabled = !(g.lanceEmbutidoMax > 0);

    text('thermo-total', pct(sim.lance.totalPct, 1) + ' · ' + brl0.format(sim.lance.totalR || 0));
    var badge = $('thermo-badge');
    badge.className = 'badge ' + aval.nivel;
    badge.textContent = aval.rotulo;
    text('thermo-msg', aval.mensagem);
    text('thermo-dica', aval.dica || '');

    // Zonas do termômetro proporcionais à escala (baixo < 90% da média ≤ competitivo < 105% ≤ forte)
    var track = $('thermo');
    if (aval.nivel !== 'indisponivel') {
      var esc = aval.escala;
      track.querySelector('.z-baixo').style.flex = '0 0 ' + (aval.media * 0.9 / esc * 100) + '%';
      track.querySelector('.z-comp').style.flex = '0 0 ' + (aval.media * 0.15 / esc * 100) + '%';
      $('thermo-pin').style.left = (aval.posicao * 100) + '%';
      $('thermo-media').style.left = (aval.posicaoMedia * 100) + '%';
      $('thermo-media').hidden = false;
    } else {
      $('thermo-pin').style.left = '0%';
      $('thermo-media').hidden = true;
    }

    $('avisos').innerHTML = sim.avisos.map(function (a) {
      return '<div class="alert alert-warning"><div>' + esc(a) + '</div></div>';
    }).join('');
  }

  function renderPos(sim) {
    var r = sim.parcelasRestantes;
    text('tl-mes', sim.mesContemplacao + 'º');
    text('tl-pre', brl.format(sim.parcelaPre) + ' por mês');
    text('tl-pre-desc', (sim.usaReduzida ? 'Parcela reduzida' : 'Parcela cheia') + ' (valor do 1º ano; reajustada a cada 12 meses)');
    text('tl-credito', brl.format(sim.creditoLiquido) + ' para usar');
    text('tl-credito-desc', sim.lance.embutidoR > 0
      ? 'Carta de ' + brl.format(sim.creditoNaContemplacao) + ' menos ' + brl.format(sim.lance.embutidoR) + ' de lance embutido'
      : 'Carta reajustada até o mês ' + sim.mesContemplacao + (sim.lance.bolsoR > 0 ? ' · lance de bolso de ' + brl.format(sim.lance.bolsoR) : ''));

    text('sem-parcela', brl.format(sim.semLance.parcelaPos));
    text('sem-desc', 'por ' + r + ' meses' + (sim.usaReduzida ? ' · já inclui a diferença acumulada da parcela reduzida' : ''));

    var temLance = sim.lance.totalPct > 0;
    text('a-parcela', brl.format(sim.cenarioA.parcelaPos));
    text('a-desc', temLance
      ? 'por ' + sim.cenarioA.mesesRestantes + ' meses · prazo mantido, parcela ' + pct((1 - sim.cenarioA.parcelaPos / sim.semLance.parcelaPos) * 100, 1) + ' menor'
      : 'Informe um lance na seção 4 para ver a redução.');
    text('a-total', brl0.format(sim.cenarioA.totalDesembolso));

    text('b-parcela', brl.format(sim.cenarioB.parcelaPos));
    var econ = sim.cenarioB.parcelasEconomizadas;
    text('b-desc', temLance
      ? 'por ' + sim.cenarioB.mesesRestantes + ' meses · ' + (econ > 0 ? econ + ' parcelas a menos (termina no mês ' + sim.cenarioB.ultimoMes + ')' : 'prazo mantido')
      : 'Informe um lance na seção 4 para antecipar o fim do plano.');
    text('b-total', brl0.format(sim.cenarioB.totalDesembolso));
  }

  function renderComparativo(cmp) {
    text('cmp-economia', brl0.format(Math.max(0, cmp.economia)));
    text('cmp-economia-desc', 'em juros, comparado a um financiamento de ' + brl0.format(cmp.credito) + ' em ' + cmp.prazo + ' meses');
    var rows = [
      ['Parcela', brl.format(cmp.consorcio.parcela), brl.format(cmp.financiamento.parcela)],
      ['Total pago', brl0.format(cmp.consorcio.total), brl0.format(cmp.financiamento.total)],
      ['Custo extra', brl0.format(cmp.consorcio.custo), brl0.format(cmp.financiamento.custo)],
      ['Custo / crédito', pct(cmp.consorcio.custoPct, 1), pct(cmp.financiamento.custoPct, 1)],
      ['Custo ao ano', pct(cmp.consorcio.custoAnualPct, 2), pct(cmp.financiamento.jurosAnualPct, 2)]
    ];
    $('tbl-cmp').innerHTML = rows.map(function (r) {
      return '<tr><td>' + r[0] + '</td><td class="num">' + r[1] + '</td><td class="num">' + r[2] + '</td></tr>';
    }).join('');
    text('cmp-nota', 'No consórcio o custo é só a taxa de administração e o fundo de reserva, diluídos no prazo, sem juros. ' +
      'Comparação nominal, sem reajuste e sem seguros. Financiamento pela Tabela Price com juros de ' +
      pct(cmp.financiamento.jurosMensalPct) + ' ao mês (' + pct(cmp.financiamento.jurosAnualPct, 1) +
      ' ao ano), sem IOF, tarifas ou correção monetária — o custo real do financiamento tende a ser maior.');
  }

  function desenharGraficos() {
    var u = ultimo;
    var c = u.sim.composicao.cheia;
    var segs = [
      { label: 'Fundo comum', value: c.fundoComum, color: 'var(--series-1)' },
      { label: 'Taxa de administração', value: c.taxaAdm, color: 'var(--series-2)' },
      { label: 'Fundo de reserva', value: c.fundoReserva, color: 'var(--series-3)' },
      { label: 'Seguro', value: c.seguro, color: 'var(--series-4)' }
    ].filter(function (s) { return s.value > 0; });
    Charts.hstack($('chart-comp'), [{ label: 'Parcela cheia', segments: segs }], brl.format, { fullWidth: true, rowHeight: 26, ariaLabel: 'Composição da parcela' });
    $('legend-comp').innerHTML = segs.map(function (s) {
      return '<li><i style="background:' + s.color + '"></i>' + s.label + ' · ' + pct(s.value / c.total * 100, 1) + '</li>';
    }).join('');

    Charts.bars($('chart-credito'), {
      data: u.proj.map(function (r) { return { label: r.ano + 'º', value: r.credito, tip: r.ano + 'º ano<br>Carta: <b>' + brl.format(r.credito) + '</b>' }; }),
      format: brl.format, axisFormat: compact, ariaLabel: 'Valor da carta de crédito por ano'
    });
    Charts.bars($('chart-parcela'), {
      data: u.proj.map(function (r) { return { label: r.ano + 'º', value: r.parcela, tip: r.ano + 'º ano<br>Parcela cheia: <b>' + brl.format(r.parcela) + '</b>' }; }),
      format: brl.format, axisFormat: compact, ariaLabel: 'Valor da parcela cheia por ano'
    });

    var g = state.grupo;
    var hist = (g.historicoLances || []);
    var labels = rotulosMeses();
    var hdata = [];
    hist.forEach(function (v, i) {
      if (v != null && v !== '') hdata.push({ label: labels[i], value: Number(v), tip: labels[i] + ': <b>' + pct(Number(v), 1) + '</b> do crédito' });
    });
    var refs = [];
    if (g.mediaLance6m != null) refs.push({ value: g.mediaLance6m, label: 'média ' + pct(g.mediaLance6m, 1) });
    if (u.sim.lance.totalPct > 0) refs.push({ value: u.sim.lance.totalPct, label: 'sua oferta ' + pct(u.sim.lance.totalPct, 1), cls: 'oferta' });
    if (hdata.length) {
      Charts.bars($('chart-hist'), {
        data: hdata, refs: refs, height: 190,
        format: function (v) { return pct(v, 1); }, axisFormat: function (v) { return pct(v, 0); },
        ariaLabel: 'Lances contemplados nos últimos 6 meses'
      });
    } else {
      $('chart-hist').innerHTML = '<p class="hint">Histórico mensal ainda não cadastrado para este grupo.</p>';
    }

    var cmp = u.cmp;
    Charts.hstack($('chart-cmp'), [
      { label: 'Consórcio', segments: [
        { label: 'Crédito', value: cmp.credito, color: 'var(--series-1)' },
        { label: 'Taxas (adm. + fundo de reserva)', value: cmp.consorcio.custo, color: 'var(--series-2)' }
      ] },
      { label: 'Financiamento', segments: [
        { label: 'Crédito', value: cmp.credito, color: 'var(--series-1)' },
        { label: 'Juros', value: cmp.financiamento.custo, color: 'var(--series-2)' }
      ] }
    ], brl0.format, { ariaLabel: 'Total pago: consórcio x financiamento' });
  }

  function cenarioEscolhido() {
    var s = ultimo.sim;
    return state.cenario === 'B' ? s.cenarioB : s.cenarioA;
  }

  function atualizarSticky() {
    if (!ultimo) return;
    var s = ultimo.sim;
    text('sticky-label', s.usaReduzida ? 'Parcela até a contemplação' : 'Parcela mensal');
    text('sticky-parcela', brl.format(s.parcelaPre));
  }

  // ---------------- WhatsApp ----------------
  function mensagemWhatsApp() {
    var u = ultimo, s = u.sim, g = state.grupo;
    var nome = $('cli-nome').value.trim();
    var cidade = $('cli-cidade').value.trim();
    var sc = cenarioEscolhido();
    var L = [];
    L.push('Olá! Fiz uma simulação de consórcio e gostaria de receber uma proposta.');
    L.push('');
    if (nome) L.push('*Cliente:* ' + nome + (cidade ? ' (' + cidade + ')' : ''));
    else if (cidade) L.push('*Cidade:* ' + cidade);
    L.push('*Tipo:* ' + TIPOS[g.tipo] + ' — ' + g.nome);
    L.push('*Carta de crédito:* ' + brl.format(state.credito));
    L.push('*Prazo:* ' + g.prazo + ' meses');
    L.push('*Parcela cheia:* ' + brl.format(s.parcelaCheia));
    if (s.usaReduzida) L.push('*Parcela reduzida (' + pct(g.parcelaReduzidaPct, 0) + ') até a contemplação:* ' + brl.format(s.parcelaPre));
    L.push('*Taxa adm.:* ' + pct(g.taxaAdm) + ' (' + pct(s.composicao.taxaAdmMensalPct, 3) + ' a.m.) · *Fundo de reserva:* ' + pct(g.fundoReserva));
    L.push('*Reajuste projetado:* ' + g.indice + ' ' + pct(state.indice) + ' a.a.');
    L.push('');
    L.push('*Contemplação prevista:* ' + s.mesContemplacao + 'º mês');
    if (s.lance.totalPct > 0) {
      var partes = [];
      if (s.lance.bolsoPct > 0) partes.push('bolso ' + pct(s.lance.bolsoPct, 1) + ' = ' + brl0.format(s.lance.bolsoR));
      if (s.lance.embutidoPct > 0) partes.push('embutido ' + pct(s.lance.embutidoPct, 1) + ' = ' + brl0.format(s.lance.embutidoR));
      L.push('*Lance:* ' + pct(s.lance.totalPct, 1) + ' (' + partes.join(' · ') + ')');
      L.push('*Termômetro:* ' + u.aval.rotulo + (g.mediaLance6m != null ? ' (média 6 meses do grupo: ' + pct(g.mediaLance6m, 1) + ')' : ''));
      L.push('*Cenário escolhido:* ' + (state.cenario === 'B'
        ? 'B · reduzir prazo → ' + sc.mesesRestantes + ' parcelas de ' + brl.format(sc.parcelaPos)
        : 'A · reduzir parcela → ' + sc.mesesRestantes + ' parcelas de ' + brl.format(sc.parcelaPos)));
    } else {
      L.push('*Sem lance* · parcelas após a contemplação: ' + brl.format(s.semLance.parcelaPos));
    }
    L.push('*Crédito disponível na contemplação:* ' + brl.format(s.creditoLiquido));
    L.push('');
    L.push('_Economia estimada vs. financiamento: ' + brl0.format(Math.max(0, u.cmp.economia)) + '_');
    return L.join('\n');
  }

  function enviarWhatsApp() {
    if (!ultimo) return;
    var num = String(state.data.config.whatsapp || '').replace(/\D/g, '');
    var url = 'https://wa.me/' + num + '?text=' + encodeURIComponent(mensagemWhatsApp());
    if (!num) url = 'https://wa.me/?text=' + encodeURIComponent(mensagemWhatsApp());
    window.open(url, '_blank', 'noopener');
  }
})();
