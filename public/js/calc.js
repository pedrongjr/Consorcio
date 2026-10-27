/*
 * Motor de cálculo do simulador de consórcio.
 * Funciona no navegador (window.ConsorcioCalc) e no Node (module.exports).
 *
 * Modelo: o plano é tratado em "percentual do bem". O cliente deve, ao longo
 * do plano, 100% do crédito (fundo comum) + taxa de administração + fundo de
 * reserva. Cada parcela amortiza um percentual desse total e o valor em R$ é
 * esse percentual aplicado sobre o valor ATUAL do crédito — por isso o
 * reajuste anual eleva a carta e a parcela na mesma proporção.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ConsorcioCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPS = 1e-9;

  function num(v, def) {
    var n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
    return isFinite(n) ? n : def || 0;
  }
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function round2(v) { return Math.round(v * 100) / 100; }

  /** Valor do crédito (bem de referência) no mês k (1-based), reajustado a cada 12 meses. */
  function creditoNoMes(credito, indiceAnual, k) {
    return credito * Math.pow(1 + indiceAnual, Math.floor((k - 1) / 12));
  }

  function normalizar(p) {
    var prazo = Math.max(2, Math.round(num(p.prazo, 60)));
    var reduzida = num(p.parcelaReduzidaPct, 100);
    if (!(reduzida > 0 && reduzida < 100)) reduzida = 100;
    return {
      credito: Math.max(0, num(p.credito)),
      prazo: prazo,
      adm: Math.max(0, num(p.taxaAdm)) / 100,
      fr: Math.max(0, num(p.fundoReserva)) / 100,
      seguro: Math.max(0, num(p.seguroMensal)) / 100,
      indice: num(p.indiceAnual) / 100,
      fatorReduzida: reduzida / 100,
      mes: clamp(Math.round(num(p.mesContemplacao, 12)), 1, prazo - 1),
      bolso: Math.max(0, num(p.lanceBolso)) / 100,
      embutido: Math.max(0, num(p.lanceEmbutido)) / 100,
      embutidoMax: p.lanceEmbutidoMax == null ? 1 : Math.max(0, num(p.lanceEmbutidoMax)) / 100
    };
  }

  /** Composição da parcela no 1º mês (valores atuais, sem reajuste). */
  function composicaoParcela(p) {
    var n = normalizar(p);
    var base = n.credito / n.prazo;
    var totalPct = 1 + n.adm + n.fr;
    var cheia = {
      fundoComum: base,
      taxaAdm: base * n.adm,
      fundoReserva: base * n.fr,
      seguro: n.credito * totalPct * n.seguro
    };
    cheia.total = cheia.fundoComum + cheia.taxaAdm + cheia.fundoReserva + cheia.seguro;
    var f = n.fatorReduzida;
    var reduzida = null;
    if (f < 1) {
      // O seguro incide sobre o saldo devedor, que é o mesmo no 1º mês.
      reduzida = {
        fundoComum: cheia.fundoComum * f,
        taxaAdm: cheia.taxaAdm * f,
        fundoReserva: cheia.fundoReserva * f,
        seguro: cheia.seguro
      };
      reduzida.total = reduzida.fundoComum + reduzida.taxaAdm + reduzida.fundoReserva + reduzida.seguro;
    }
    return {
      cheia: cheia,
      reduzida: reduzida,
      taxaAdmTotalPct: n.adm * 100,
      taxaAdmMensalPct: (n.adm / n.prazo) * 100,
      fundoReservaTotalPct: n.fr * 100,
      fundoReservaMensalPct: (n.fr / n.prazo) * 100,
      seguroMensalPct: n.seguro * 100,
      custoTotalPlano: n.credito * totalPct
    };
  }

  /**
   * Gera o cronograma mês a mês. pctNoMes(k) devolve o percentual do bem
   * amortizado no mês k; o lance é abatido logo após a parcela do mês de
   * contemplação.
   */
  function cronograma(n, pctNoMes, lancePct) {
    var totalPct = 1 + n.adm + n.fr;
    var saldo = totalPct;
    var linhas = [];
    for (var k = 1; k <= n.prazo && saldo > 1e-7; k++) {
      var cred = creditoNoMes(n.credito, n.indice, k);
      var pct = Math.min(pctNoMes(k, saldo), saldo);
      var seguro = saldo * cred * n.seguro;
      linhas.push({
        mes: k,
        credito: cred,
        parcela: pct * cred + seguro,
        seguro: seguro,
        saldoDevedor: (saldo - pct) * cred
      });
      saldo -= pct;
      if (k === n.mes && lancePct > 0) {
        saldo -= lancePct;
        linhas[linhas.length - 1].saldoDevedor = Math.max(0, saldo) * cred;
      }
    }
    return linhas;
  }

  function somar(linhas, campo) {
    var s = 0;
    for (var i = 0; i < linhas.length; i++) s += linhas[i][campo];
    return s;
  }

  /**
   * Simulação completa: pré-contemplação, lance e os cenários pós-contemplação.
   */
  function simular(p) {
    var n = normalizar(p);
    var totalPct = 1 + n.adm + n.fr;
    var pctCheio = totalPct / n.prazo;
    var pctPre = pctCheio * n.fatorReduzida;
    var avisos = [];

    var pagoPre = pctPre * n.mes;
    var saldoPos = totalPct - pagoPre;
    var restantes = n.prazo - n.mes;
    var credContemplacao = creditoNoMes(n.credito, n.indice, n.mes);

    // --- Lance ---
    var embutido = n.embutido;
    if (embutido > n.embutidoMax + EPS) {
      avisos.push('O lance embutido foi limitado a ' + round2(n.embutidoMax * 100) + '% do crédito, máximo permitido neste grupo.');
      embutido = n.embutidoMax;
    }
    var bolso = n.bolso;
    var lancePct = bolso + embutido;
    if (lancePct > saldoPos - EPS) {
      avisos.push('O lance informado é maior que o saldo devedor; foi limitado ao valor que quita o plano.');
      var excesso = lancePct - saldoPos;
      var cortaBolso = Math.min(bolso, excesso);
      bolso -= cortaBolso;
      embutido -= excesso - cortaBolso;
      lancePct = saldoPos;
    }
    var saldoAposLance = Math.max(0, saldoPos - lancePct);

    // Sem lance: a parcela pós-contemplação absorve a diferença da parcela reduzida.
    var pctSemLance = saldoPos / restantes;
    // Cenário A: reduz o valor da parcela, mantém o prazo.
    var pctA = saldoAposLance / restantes;
    // Cenário B: mantém a parcela cheia e reduz o número de parcelas.
    var pctB = pctCheio;
    var mesesB = saldoAposLance > EPS ? Math.ceil(saldoAposLance / pctCheio - 1e-6) : 0;
    if (mesesB > restantes) {
      // Diferença acumulada da parcela reduzida não cabe no prazo com parcela cheia.
      mesesB = restantes;
      pctB = saldoAposLance / restantes;
    }

    function fn(pctPos) {
      return function (k) { return k <= n.mes ? pctPre : pctPos; };
    }
    var cronSemLance = cronograma(n, fn(pctSemLance), 0);
    var cronA = cronograma(n, fn(pctA), lancePct);
    var cronB = cronograma(n, fn(pctB), lancePct);

    function parcelaPos(cron) {
      var l = cron[n.mes]; // primeira parcela após a contemplação (índice = mes)
      return l ? l.parcela : 0;
    }

    var lanceBolsoR = bolso * credContemplacao;
    var lanceEmbutidoR = embutido * credContemplacao;

    function resumo(cron, extra) {
      var totalParcelas = somar(cron, 'parcela');
      var r = {
        cronograma: cron,
        parcelaPos: parcelaPos(cron),
        totalParcelas: totalParcelas,
        totalDesembolso: totalParcelas + lanceBolsoR,
        mesesRestantes: Math.max(0, cron.length - n.mes),
        ultimoMes: cron.length
      };
      for (var key in extra) r[key] = extra[key];
      return r;
    }

    var semLance = resumo(cronSemLance, {});
    var cenarioA = resumo(cronA, {});
    var cenarioB = resumo(cronB, {});
    cenarioB.parcelasEconomizadas = restantes - cenarioB.mesesRestantes;

    var comp = composicaoParcela(p);

    return {
      entrada: n,
      composicao: comp,
      parcelaCheia: comp.cheia.total,
      parcelaPre: comp.reduzida ? comp.reduzida.total : comp.cheia.total,
      usaReduzida: n.fatorReduzida < 1,
      mesContemplacao: n.mes,
      parcelasRestantes: restantes,
      creditoNaContemplacao: credContemplacao,
      creditoLiquido: credContemplacao - lanceEmbutidoR,
      lance: {
        bolsoPct: bolso * 100,
        embutidoPct: embutido * 100,
        totalPct: lancePct * 100,
        bolsoR: lanceBolsoR,
        embutidoR: lanceEmbutidoR,
        totalR: lanceBolsoR + lanceEmbutidoR
      },
      semLance: semLance,
      cenarioA: cenarioA,
      cenarioB: cenarioB,
      avisos: avisos
    };
  }

  /** Evolução anual do crédito e da parcela cheia por reajuste. */
  function projecaoReajuste(p) {
    var n = normalizar(p);
    var anos = Math.ceil(n.prazo / 12);
    var comp = composicaoParcela(p);
    var parcelaSemSeguro = comp.cheia.total - comp.cheia.seguro;
    var out = [];
    for (var a = 0; a < anos; a++) {
      var fator = Math.pow(1 + n.indice, a);
      out.push({
        ano: a + 1,
        mesInicio: a * 12 + 1,
        fator: fator,
        credito: n.credito * fator,
        parcela: parcelaSemSeguro * fator
      });
    }
    return out;
  }

  /** Financiamento pela Tabela Price, para comparação. */
  function financiamentoPrice(valor, jurosMensalPct, prazo) {
    var i = num(jurosMensalPct) / 100;
    var n = Math.max(1, Math.round(num(prazo)));
    var pmt = i > 0 ? (valor * i) / (1 - Math.pow(1 + i, -n)) : valor / n;
    var total = pmt * n;
    return {
      parcela: pmt,
      total: total,
      juros: total - valor,
      jurosAnualPct: (Math.pow(1 + i, 12) - 1) * 100
    };
  }

  /** Comparativo nominal (sem reajuste e sem seguro) consórcio x financiamento. */
  function comparativo(p, jurosMensalPct) {
    var n = normalizar(p);
    var custoConsorcio = n.credito * (n.adm + n.fr);
    var fin = financiamentoPrice(n.credito, jurosMensalPct, n.prazo);
    return {
      credito: n.credito,
      prazo: n.prazo,
      consorcio: {
        parcela: (n.credito * (1 + n.adm + n.fr)) / n.prazo,
        total: n.credito + custoConsorcio,
        custo: custoConsorcio,
        custoPct: (n.adm + n.fr) * 100,
        custoAnualPct: ((n.adm + n.fr) / (n.prazo / 12)) * 100
      },
      financiamento: {
        parcela: fin.parcela,
        total: fin.total,
        custo: fin.juros,
        custoPct: n.credito > 0 ? (fin.juros / n.credito) * 100 : 0,
        jurosMensalPct: num(jurosMensalPct),
        jurosAnualPct: fin.jurosAnualPct
      },
      economia: fin.juros - custoConsorcio
    };
  }

  function media(lista) {
    var v = (lista || []).map(function (x) { return num(x, NaN); }).filter(function (x) { return isFinite(x); });
    if (!v.length) return null;
    return v.reduce(function (a, b) { return a + b; }, 0) / v.length;
  }

  function fmtPct(v) {
    return (Math.round(v * 10) / 10).toString().replace('.', ',') + '%';
  }

  /**
   * Termômetro de lance: compara a oferta (% do crédito) com a média dos
   * lances contemplados nos últimos 6 meses do grupo.
   */
  function avaliarLance(ofertaPct, mediaPct, historico) {
    var oferta = Math.max(0, num(ofertaPct));
    var med = num(mediaPct, NaN);
    if (!isFinite(med) || med <= 0) {
      return { nivel: 'indisponivel', rotulo: 'Sem histórico', mensagem: 'Ainda não há média de lances cadastrada para este grupo. Fale com o consultor para uma análise personalizada.', posicao: 0 };
    }
    var vals = (historico || []).map(function (x) { return num(x, NaN); }).filter(isFinite);
    var maximo = vals.length ? Math.max.apply(null, vals) : null;
    var minimo = vals.length ? Math.min.apply(null, vals) : null;
    var razao = oferta / med;
    var nivel, rotulo, chance, dica;
    if (oferta <= 0) {
      nivel = 'baixo'; rotulo = 'Sem lance'; chance = 'depende apenas do sorteio';
      dica = 'Sem lance, a contemplação depende do sorteio mensal. Ofertar um lance próximo de ' + fmtPct(med) + ' aumenta bastante suas chances.';
    } else if (razao < 0.9) {
      nivel = 'baixo'; rotulo = 'Lance Baixo'; chance = 'baixa chance de competitividade';
      dica = 'Para ficar competitivo, considere elevar a oferta para perto de ' + fmtPct(med) + '. Combinar lance de bolso com lance embutido pode ajudar a chegar lá sem descapitalizar.';
    } else if (razao < 1.05) {
      nivel = 'competitivo'; rotulo = 'Lance Competitivo'; chance = 'boa chance de competitividade';
      dica = 'Você está na faixa da média. Um pequeno acréscimo pode ser o diferencial nas assembleias mais disputadas.';
    } else {
      nivel = 'forte'; rotulo = 'Lance Forte'; chance = 'alta chance de competitividade';
      dica = maximo != null && oferta >= maximo
        ? 'Sua oferta supera o maior lance contemplado no período (' + fmtPct(maximo) + ').'
        : 'Sua oferta está acima da média do grupo. Mantenha a estratégia e acompanhe as próximas assembleias.';
    }
    var mensagem = 'Com base nos últimos 6 meses deste grupo, a média de contemplação via lance livre está em ' +
      fmtPct(med) + '. ' + (oferta > 0 ? 'A sua oferta atual de ' + fmtPct(oferta) + ' possui ' + chance + '.' : 'Sem oferta de lance, a contemplação ' + chance + '.');
    var escala = Math.max(med * 2, maximo || 0, oferta) || 1;
    return {
      nivel: nivel,
      rotulo: rotulo,
      mensagem: mensagem,
      dica: dica,
      media: med,
      maximo: maximo,
      minimo: minimo,
      diferenca: oferta - med,
      posicao: clamp(oferta / escala, 0, 1),
      posicaoMedia: med / escala,
      escala: escala
    };
  }

  return {
    composicaoParcela: composicaoParcela,
    simular: simular,
    projecaoReajuste: projecaoReajuste,
    financiamentoPrice: financiamentoPrice,
    comparativo: comparativo,
    avaliarLance: avaliarLance,
    media: media,
    creditoNoMes: creditoNoMes
  };
});
