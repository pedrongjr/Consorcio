'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/js/calc.js');

const base = {
  credito: 100000, prazo: 100, taxaAdm: 20, fundoReserva: 2, seguroMensal: 0,
  indiceAnual: 0, mesContemplacao: 20, lanceBolso: 0, lanceEmbutido: 0
};
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

test('composição da parcela cheia', () => {
  const c = C.composicaoParcela(base);
  near(c.cheia.fundoComum, 1000);
  near(c.cheia.taxaAdm, 200);
  near(c.cheia.fundoReserva, 20);
  near(c.cheia.total, 1220);
  near(c.taxaAdmMensalPct, 0.2);
  assert.equal(c.reduzida, null);
});

test('seguro incide sobre o saldo devedor', () => {
  const c = C.composicaoParcela({ ...base, seguroMensal: 0.03 });
  near(c.cheia.seguro, 122000 * 0.0003);
});

test('sem lance e sem reajuste: parcela constante e total = crédito + taxas', () => {
  const r = C.simular(base);
  near(r.semLance.parcelaPos, 1220);
  near(r.semLance.totalParcelas, 122000);
  assert.equal(r.semLance.ultimoMes, 100);
});

test('parcela reduzida: diferença é diluída após a contemplação', () => {
  const r = C.simular({ ...base, parcelaReduzidaPct: 50 });
  near(r.parcelaPre, 610);
  // pagou 20 x 0,61% = 12,2%; restam 109,8% em 80 meses
  near(r.semLance.parcelaPos, 109800 / 80);
  near(r.semLance.totalParcelas, 122000);
});

test('cenário A reduz parcela, cenário B reduz prazo', () => {
  const r = C.simular({ ...base, lanceBolso: 30 });
  // saldo após 20 parcelas = 97,6%; após lance de 30% = 67,6%
  near(r.cenarioA.parcelaPos, 67600 / 80);
  assert.equal(r.cenarioA.ultimoMes, 100);
  near(r.cenarioB.parcelaPos, 1220);
  assert.equal(r.cenarioB.mesesRestantes, Math.ceil(67600 / 1220));
  assert.equal(r.cenarioB.parcelasEconomizadas, 80 - Math.ceil(67600 / 1220));
  near(r.cenarioA.totalDesembolso, 122000);
  near(r.cenarioB.totalDesembolso, 122000);
});

test('lance embutido reduz o crédito líquido e respeita o limite do grupo', () => {
  const r = C.simular({ ...base, lanceEmbutido: 40, lanceEmbutidoMax: 25 });
  assert.equal(r.lance.embutidoPct, 25);
  near(r.creditoLiquido, 75000);
  assert.equal(r.avisos.length, 1);
});

test('lance maior que o saldo é limitado', () => {
  const r = C.simular({ ...base, lanceBolso: 200 });
  near(r.lance.totalPct, 97.6);
  assert.equal(r.cenarioA.mesesRestantes, 0);
});

test('parcela reduzida + lance pequeno no cenário B não ultrapassa o prazo', () => {
  const r = C.simular({ ...base, parcelaReduzidaPct: 50, lanceBolso: 1 });
  assert.equal(r.cenarioB.ultimoMes, 100);
  near(r.cenarioB.totalParcelas + r.lance.bolsoR, 122000);
});

test('reajuste anual eleva crédito e parcela na mesma proporção', () => {
  const proj = C.projecaoReajuste({ ...base, indiceAnual: 5 });
  assert.equal(proj.length, 9);
  near(proj[1].credito, 105000);
  near(proj[1].parcela, 1220 * 1.05);
  near(proj[2].credito / proj[0].credito, proj[2].parcela / proj[0].parcela, 1e-9);
  const r = C.simular({ ...base, indiceAnual: 5 });
  near(r.semLance.cronograma[12].credito, 105000);
  near(r.semLance.cronograma[12].parcela, 1220 * 1.05);
  near(r.creditoNaContemplacao, 105000);
});

test('financiamento Price e comparativo', () => {
  const f = C.financiamentoPrice(100000, 1, 100);
  near(f.parcela, 1586.57, 0.01);
  const cmp = C.comparativo(base, 1);
  near(cmp.consorcio.custo, 22000);
  near(cmp.economia, f.juros - 22000);
});

test('termômetro de lance', () => {
  const hist = [30, 31, 33, 32, 34, 32];
  assert.equal(C.avaliarLance(20, 32, hist).nivel, 'baixo');
  assert.equal(C.avaliarLance(31, 32, hist).nivel, 'competitivo');
  const forte = C.avaliarLance(35, 32, hist);
  assert.equal(forte.nivel, 'forte');
  assert.match(forte.mensagem, /média de contemplação via lance livre está em 32%/);
  assert.match(forte.mensagem, /oferta atual de 35% possui alta chance/);
  assert.equal(C.avaliarLance(10, null).nivel, 'indisponivel');
  near(C.media(hist), 32);
});
