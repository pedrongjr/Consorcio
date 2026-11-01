# Minhas Finanças — controle financeiro a partir do extrato do banco

App para **iOS e Android** (React Native + Expo) que importa os extratos exportados pelos bancos, **classifica cada lançamento em categorias e subcategorias** e mostra para onde vai o dinheiro, no estilo do Minhas Economias, Mobills e Organizze.

Todos os dados ficam **somente no aparelho** (SQLite local). Nenhum extrato é enviado para servidores.

## Funcionalidades

| Área | O que faz |
|---|---|
| **Importação** | OFX/QFX (SGML e XML, conta e cartão), CSV/TXT (`;` `,` tab), XLSX, ODS, QIF, tabelas HTML salvas como `.xls` e **PDF** (inclusive PDFs com senha). Detecta o formato pelo conteúdo e a codificação (UTF-8 ou Windows-1252). |
| **Revisão antes de salvar** | Lista os lançamentos lidos, marca os **duplicados** (já importados) e permite trocar categorias. A troca vale também para lançamentos com a mesma descrição. |
| **Classificação automática** | Mais de 600 palavras-chave de estabelecimentos e históricos brasileiros (iFood, Uber, Enel, Sabesp, Drogasil, Netflix, tarifas, IOF, Pix, salário...). Ordem de prioridade: **regras do usuário → aprendizado com lançamentos que você já categorizou → regras padrão**. |
| **Categorias** | Plano padrão com 13 categorias de despesa e 36 subcategorias, além de receitas e transferências. Transferências (entre contas, pagamento de fatura, aplicações) não contam como gasto. Você pode criar, editar e excluir categorias. |
| **Regras** | "Quando a descrição contiver X → categoria Y", por entradas e/ou saídas. Podem ser criadas na tela do lançamento ou em *Mais → Regras*. |
| **Resumo** | Saldo das contas, receitas × despesas do mês, gastos por categoria e subcategoria, evolução de 6 meses, alertas de orçamento. |
| **Orçamentos** | Limite mensal por categoria, com barra de progresso, aviso a partir de 80% e sugestão pela média dos últimos 3 meses. |
| **Contas e cartões** | Conta corrente, poupança, cartão de crédito, investimentos e carteira. Contas vindas de OFX são reconhecidas pelo banco, agência e conta. |
| **Outros** | Lançamentos manuais, busca e filtros, desfazer uma importação inteira, reclassificar tudo e exportar CSV (abre no Excel). |

## Como exportar o extrato no banco

* **OFX (recomendado)**: no internet banking procure "Exportar extrato", "Money", "OFX" ou "Quicken". Traz um identificador único por lançamento, então reimportar o mesmo período não duplica nada.
* **CSV**: Nubank, Inter, C6 e outros. Faturas de cartão em CSV que trazem compras como valores positivos são invertidas automaticamente quando a conta escolhida é do tipo *cartão de crédito*.
* **PDF**: funciona com PDFs gerados pelo banco. PDFs escaneados (imagem) não têm texto e não podem ser lidos. Como cada banco tem um layout diferente, confira os valores na revisão.
* **`.xls` antigo (Excel 97-2003)**: não é suportado. Salve como `.xlsx` ou `.csv`.

## Rodando o projeto

Requisitos: Node.js 20+ e o app **Expo Go** no celular, ou um emulador.

```bash
cd financas-app
npm install
npx expo start          # leia o QR code com o Expo Go (Android) ou com a câmera (iOS)
```

> O leitor de PDF usa `react-native-webview`, que já vem no Expo Go. Na primeira leitura de PDF, a biblioteca pdf.js é baixada do cdnjs, então é preciso internet nesse momento. O arquivo em si é processado no aparelho.

### Gerar os apps para as lojas

```bash
npx eas-cli@latest build --platform android   # .aab para a Google Play
npx eas-cli@latest build --platform ios       # .ipa para a App Store (requer conta Apple Developer)
```

Os identificadores estão em `app.json` (`com.pedrongjr.minhasfinancas`). Altere antes de publicar, se quiser.

### Verificações

```bash
npm test            # 70 testes dos leitores de extrato, classificador e relatórios
npm run typecheck
npx eslint src
```

## Estrutura

```
src/
  app/                    telas (Expo Router)
    (tabs)/               Resumo, Lançamentos, Importar, Orçamentos, Mais
    import-review.tsx     revisão da importação
    transaction/          detalhe/edição e novo lançamento
    accounts|categories|rules|imports.tsx
  core/                   lógica pura em TypeScript, sem dependência de React Native (testada)
    parsers/              ofx, csv, qif, spreadsheet (xlsx/ods), pdfText, table (detecção de colunas)
    categories.ts         plano de categorias + palavras-chave
    classifier.ts         motor de classificação
    importer.ts           detecção de formato, ajuste de cartão, deduplicação
    reports.ts            resumos mensais, totais por categoria, orçamento
  db/                     SQLite: schema/migrações e consultas
  components/             UI, seletor de categoria, extrator de PDF (pdf.js em WebView)
```

## Como o app decide a categoria

1. **Regras do usuário**: o texto da regra precisa aparecer na descrição (sem acento e sem diferença entre maiúsculas e minúsculas).
2. **Histórico**: se você já categorizou à mão um lançamento com a mesma descrição normalizada (sem datas, parcelas e códigos), a mesma categoria é usada.
3. **Regras padrão**: vence o padrão mais específico. Por exemplo, "MERCADO LIVRE" ganha de "MERCADO" e "UBER EATS" ganha de "UBER". Padrões curtos (até 4 letras) só casam com palavras inteiras, então "BET" não casa com "BETONEIRA".
4. Se nada casar, o lançamento vai para **Outros gastos** ou **Outras receitas** e aparece no filtro *Sem categoria*.
