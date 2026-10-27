# Consórcio Inteligente — Simulador e Backoffice

Web app **mobile first** para simulação completa de consórcio, com envio da proposta direto para o WhatsApp do consultor e um painel administrativo para manter grupos, taxas e médias de lance.

Sem dependências externas: apenas Node.js (18+).

```bash
ADMIN_PASSWORD="sua-senha-forte" npm start
# Simulador:  http://localhost:3000
# Backoffice: http://localhost:3000/admin
npm test      # testes do motor de cálculo
```

| Variável | Uso | Padrão |
|---|---|---|
| `PORT` | Porta HTTP | `3000` |
| `ADMIN_PASSWORD` | Senha do painel | `admin123` (troque!) |
| `SESSION_SECRET` | Assinatura das sessões do admin (fixe para sessões sobreviverem a reinícios) | aleatório |
| `DB_FILE` | Arquivo de dados | `data/db.json` |

Na primeira execução, `data/db.json` é criado a partir de `data/seed.json` (grupos de exemplo). Configure o número de WhatsApp em **Backoffice → Configurações**.

## Funcionalidades do simulador

1. **Simulação** — tipo de bem, grupo, valor da carta, parcela reduzida (ex.: meia parcela) até a contemplação, mês previsto de contemplação e índice de reajuste projetado.
2. **Transparência de custos** — composição da parcela: fundo comum, taxa de administração (% total e % mensal), fundo de reserva e seguro; parcela cheia x reduzida.
3. **Reajuste anual (IPCA / INCC / FIPE / IGP-M)** — evolução ano a ano da carta e da parcela, com alerta didático mostrando que ambas sobem na mesma proporção.
4. **Inteligência de lance** — média dos lances contemplados nos últimos 6 meses do grupo, histórico mensal, termômetro (*Lance Baixo / Competitivo / Forte*) e mensagem de estratégia. Lance de bolso e lance embutido (respeitando o limite do grupo).
5. **Pré x pós-contemplação** — parcela até contemplar, crédito líquido na contemplação e recálculo após o lance:
   - **Cenário A**: reduz a parcela mantendo o prazo;
   - **Cenário B**: mantém a parcela cheia e reduz o número de parcelas;
   - a diferença da parcela reduzida é diluída automaticamente após a contemplação.
6. **Consórcio x financiamento** — custo total comparado com Tabela Price (juros configuráveis por tipo de bem).
7. **Envio para o WhatsApp** — mensagem formatada com todos os números da simulação e o cenário escolhido.

## Backoffice

- **Grupos e médias**: cadastro/edição de grupos com faixa de crédito, prazo, taxa de administração, fundo de reserva, seguro, índice e reajuste próprio, parcela reduzida, limite de lance embutido, histórico dos últimos 6 meses (a média é calculada automaticamente e pode ser ajustada) e status ativo/inativo.
- **Configurações**: nome do consultor, WhatsApp, índices padrão (% a.a.) e juros de financiamento por tipo (% a.m.).

## Premissas de cálculo

O motor (`public/js/calc.js`, testado em `test/calc.test.js`) trabalha em **percentual do bem**, como as administradoras:

- Total do plano = crédito × (100% + taxa adm. + fundo de reserva). Parcela cheia = total ÷ prazo.
- Reajuste anual a cada 12 meses sobre o valor do bem; a parcela em R$ é o percentual amortizado × valor atual do bem, por isso carta e parcela variam na mesma proporção. O saldo devedor continua sendo reajustado após a contemplação.
- Seguro: % ao mês sobre o saldo devedor.
- Lances em % do crédito na data da contemplação. O embutido é descontado da carta.
- Comparativo com financiamento é nominal (sem reajuste, seguros, IOF ou tarifas).

Os resultados são ilustrativos; as condições finais dependem do regulamento de cada grupo.

## Estrutura

```
server.js            servidor HTTP + API (sem dependências)
data/seed.json       dados iniciais
public/index.html    simulador
public/admin.html    backoffice
public/js/calc.js    motor de cálculo (navegador + Node)
public/js/charts.js  gráficos SVG
public/js/app.js     lógica do simulador
public/js/admin.js   lógica do backoffice
test/                testes (node --test)
```
