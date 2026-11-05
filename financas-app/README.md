# Minhas Finanças — controle financeiro a partir do extrato do banco

App para **iOS e Android** (React Native + Expo) que importa os extratos exportados pelos bancos, **classifica cada lançamento em categorias e subcategorias** e mostra para onde vai o dinheiro, no estilo do Minhas Economias, Mobills e Organizze.

No celular, todos os dados ficam **somente no aparelho** (SQLite local). Há também uma **versão web multiusuário** (veja abaixo).

## Versão web (multiusuário)

Além dos apps para celular, há uma versão web com **cadastro e login**. Cada usuário tem a própria conta, e os extratos de um nunca aparecem para outro.

* **Front-end**: as mesmas telas do app (Expo/React Native Web). O arquivo do extrato é lido e o OCR roda **no navegador**; só os lançamentos vão para o servidor.
* **Servidor** (`server/`): Node + Express + Postgres, com a mesma lógica de classificação do app.

### Segurança e isolamento entre usuários

| Camada | Como funciona |
|---|---|
| Senhas | `scrypt` (N=2^15) com sal aleatório; nunca guardadas em texto. Mínimo de 8 caracteres e bloqueio de senhas comuns. |
| Sessão | Token aleatório de 256 bits em cookie `HttpOnly`, `SameSite=Lax` e `Secure` (em produção). No banco fica só o hash SHA-256 do token. Sair encerra a sessão no servidor; trocar a senha derruba as outras sessões. |
| Força bruta | Limite de tentativas por IP e por e-mail, e bloqueio da conta por 15 min após 10 senhas erradas. Senha errada e e-mail inexistente dão a mesma resposta, no mesmo tempo. |
| Isolamento (1ª camada) | Toda consulta filtra pelo `user_id` da sessão, que nunca vem do cliente. Cada ID recebido é conferido como pertencente ao usuário. |
| Isolamento (2ª camada) | **Row-Level Security forçado no Postgres**: cada requisição roda numa transação marcada com o usuário, e o banco só devolve e só aceita linhas dele, mesmo que uma consulta esqueça o filtro. Quando possível, as consultas usam um papel sem privilégios (`financas_rls`). As chaves estrangeiras incluem o `user_id`, então não dá para pendurar um lançamento na conta de outra pessoa. |
| Web | Proteção CSRF (cabeçalho próprio + checagem de `Origin`), CSP estrita (`script-src 'self'`), HSTS, `X-Frame-Options: DENY`, `no-store` na API. O leitor de PDF/OCR roda num iframe em sandbox, sem acesso aos cookies. |
| Validação | Todos os parâmetros da API são validados (tipos, tamanhos, formatos) antes de chegar ao banco; as consultas são sempre parametrizadas. |

Os testes em `server/__tests__/api.test.ts` sobem a API contra um Postgres real e cobrem cadastro, login, limite de tentativas, bloqueio, CSRF e cookies. Eles também tentam **acessar, alterar e apagar os dados de um usuário a partir de outro por todas as rotas** e confirmam que o RLS barra o acesso mesmo com SQL sem filtro. Tudo roda em dois cenários: conexão como superusuário e como dono comum das tabelas (o caso dos Postgres hospedados).

### Publicar (Render + banco no Neon)

O site roda no Render e o banco Postgres fica no [Neon](https://neon.tech) (plano gratuito, sem prazo de expiração).

1. No Neon, crie um projeto (região mais próxima, ex.: São Paulo) e copie a *connection string* com **Connection pooling desligado** (começa com `postgresql://` e termina com `?sslmode=require`).
2. No Render: **New → Blueprint** → escolha este repositório. Quando pedir `DATABASE_URL`, cole a string do Neon.
   Se o serviço já existe: abra o serviço → **Environment** → edite `DATABASE_URL` → **Save, rebuild and deploy**.
3. As tabelas e o isolamento por usuário (Row-Level Security) são criados sozinhos na primeira inicialização.

> Use a conexão **sem** pooling: o servidor usa travas de sessão na migração. No plano gratuito do Render o serviço "dorme" sem uso (o primeiro acesso demora ~1 min).


**Outras hospedagens**: a cada push, o GitHub Actions publica a imagem `ghcr.io/pedrongjr/minhas-financas-web:latest`. Qualquer serviço que rode Docker (Fly.io, Railway, Google Cloud Run, uma VPS) serve. Defina `DATABASE_URL` (Postgres 15+) e `NODE_ENV=production`, e exponha a porta 3000 atrás de HTTPS.

### Rodar localmente

```bash
cd financas-app
npm run build:web && npm run build:server
DATABASE_URL=postgres://usuario:senha@localhost:5432/financas npm run start:server   # http://localhost:3000
TEST_DATABASE_URL=postgres://postgres:senha@localhost:5432/postgres npm test          # inclui os testes da API
```

## Funcionalidades

| Área | O que faz |
|---|---|
| **Importação** | OFX/QFX (SGML e XML, conta e cartão), CSV/TXT (`;` `,` tab), XLSX, ODS, QIF, tabelas HTML salvas como `.xls`, **PDF** (inclusive com senha) e **PDF escaneado, foto ou print do extrato via OCR** (JPG, PNG, WEBP). Detecta o formato pelo conteúdo e a codificação (UTF-8 ou Windows-1252). |
| **Revisão antes de salvar** | Lista os lançamentos lidos, marca os **duplicados** (já importados) e permite trocar categorias. A troca vale também para lançamentos com a mesma descrição. |
| **Classificação automática** | Mais de 600 palavras-chave de estabelecimentos e históricos brasileiros (iFood, Uber, Enel, Sabesp, Drogasil, Netflix, tarifas, IOF, Pix, salário...). Ordem de prioridade: **regras do usuário → aprendizado com lançamentos que você já categorizou → regras padrão**. |
| **Categorias** | Plano padrão com 13 categorias de despesa e 36 subcategorias, além de receitas e transferências. Transferências (entre contas, pagamento de fatura, aplicações) não contam como gasto. Você pode criar, editar e excluir categorias. |
| **Regras** | "Quando a descrição contiver X → categoria Y", por entradas e/ou saídas. Podem ser criadas na tela do lançamento ou em *Mais → Regras*. |
| **Resumo** | Saldo das contas, receitas × despesas do mês, gastos por categoria e subcategoria, evolução de 6 meses, alertas de orçamento. |
| **Orçamentos** | Limite mensal por categoria, com barra de progresso, aviso a partir de 80% e sugestão pela média dos últimos 3 meses. |
| **Contas e cartões** | Conta corrente, poupança, cartão de crédito, investimentos e carteira. Contas vindas de OFX são reconhecidas pelo banco, agência e conta. Os lançamentos podem ser vistos com **todas as contas juntas** ou filtrando várias contas, com o saldo das escolhidas. |
| **Transferências entre contas** | Ao importar, saídas e entradas de mesmo valor entre suas contas (até 4 dias, com cara de transferência: PIX, TED, aplicação, fatura...) são **ligadas automaticamente** e mostradas como "Caixa → Nubank". À mão, escolha a outra conta no lançamento; se o extrato dela ainda não foi importado, o app cria a contrapartida, que depois é **substituída** pelo lançamento do banco (sem duplicar). |
| **Sonhos** | Modelos (viagem, carro, casa, reserva...), prazo, quanto guardar por mês e se cabe na sobra média. **Conta vinculada**: as movimentações dela contam sozinhas como depósitos. **Como chegar lá**: % da renda, dia sugerido para a transferência automática (logo após o salário) e onde cortar gastos, com um toque para criar os orçamentos. |
| **Outros** | Lançamentos manuais, busca e filtros, desfazer uma importação inteira, reclassificar tudo e exportar CSV (abre no Excel). |

## Como exportar o extrato no banco

* **OFX (recomendado)**: no internet banking procure "Exportar extrato", "Money", "OFX" ou "Quicken". Traz um identificador único por lançamento, então reimportar o mesmo período não duplica nada.
* **CSV**: Nubank, Inter, C6 e outros. Faturas de cartão em CSV que trazem compras como valores positivos são invertidas automaticamente quando a conta escolhida é do tipo *cartão de crédito*.
* **PDF**: funciona com PDFs gerados pelo banco. Como cada banco tem um layout diferente, confira os valores na revisão.
* **PDF escaneado, foto ou print (OCR)**: quando o PDF praticamente não tem texto, o app desenha cada página como imagem e reconhece o texto em português (Tesseract.js) no próprio celular. Fotos e prints em JPG/PNG/WEBP passam pelo mesmo caminho. Fotos HEIC não são aceitas; use um print ou salve como JPG.
* **`.xls` antigo (Excel 97-2003)**: não é suportado. Salve como `.xlsx` ou `.csv`.

## Rodando o projeto

Requisitos: Node.js 20+ e o app **Expo Go** no celular, ou um emulador.

```bash
cd financas-app
npm install
npx expo start          # leia o QR code com o Expo Go (Android) ou com a câmera (iOS)
```

> O leitor de PDF e o OCR rodam num `react-native-webview` invisível (já vem no Expo Go). Na primeira vez são baixados o pdf.js (cdnjs) e, se precisar de OCR, o Tesseract.js com o modelo de português (cerca de 5 MB, jsDelivr); depois ficam em cache. Os arquivos em si são processados no aparelho, nada é enviado.

### Como o OCR funciona

1. O pdf.js tenta extrair o texto. Se a média for menor que 40 caracteres por página, o PDF é tratado como imagem (até 20 páginas).
2. Cada página é desenhada a ~2000 px de largura e passa pelo Tesseract (português, modelo LSTM).
3. A inclinação da página é estimada pelas linhas de base do Tesseract e as coordenadas são endireitadas, para que data, descrição e valor de uma linha fiquem juntos mesmo em foto torta.
4. Erros típicos são corrigidos só em valores e datas: `O`→`0`, `l`/`I`→`1`, `RS`→`R$`, menos lido como aspas/travessão, vírgula perdida (`-2780 3.001,93` → `-27,80`), bordas de tabela.
5. As palavras são agrupadas em linhas pela sobreposição vertical (a vírgula do valor desce abaixo da linha e não pode separar valor e saldo da descrição).
6. Em extratos com coluna de saldo, o sinal vem da variação do saldo; se o OCR perdeu o valor e só sobrou o saldo, o valor é calculado pela diferença. Se o valor lido não bate com a variação do saldo e o saldo é confirmado pela linha seguinte, o valor é corrigido (com aviso). Extratos do mais novo para o mais antigo (Caixa) e indicadores `C`/`D` são reconhecidos.

Foi verificado de ponta a ponta no Chromium com um PDF escaneado, um print e uma foto torta e desfocada; as linhas lidas pelo Tesseract viraram testes em `src/core/__tests__/pdfLayout.test.ts`. OCR nunca é perfeito: sempre confira a revisão antes de importar.

### Baixar o APK pronto (Android)

O workflow `.github/workflows/android-apk.yml` compila o APK a cada push que altera `financas-app/`:

* **Releases do GitHub**: o arquivo `minhas-financas.apk` fica em cada release `apk-vN` (pré-release).
* **Actions → APK Android → execução → Artifacts**: o mesmo APK, em zip.

No celular, abra o arquivo e permita "instalar apps de fontes desconhecidas". O APK é assinado com a chave de depuração, que serve para uso pessoal. Para publicar na Play Store, use o EAS Build (abaixo).

### iPhone (iOS)

O workflow `.github/workflows/ios-ipa.yml` compila o app num Mac do GitHub a cada push e publica `minhas-financas-unsigned.ipa` nas releases `ios-vN`.

O iPhone só instala apps **assinados**, e o arquivo gerado não tem assinatura. Há duas formas de instalar:

* **Sem custo, uso pessoal**: no computador, instale o [Sideloadly](https://sideloadly.io) ou o [AltStore](https://altstore.io). Conecte o iPhone, escolha o `.ipa` e entre com o seu Apple ID; ele assina e instala. No iPhone, ative o **Modo de Desenvolvedor** (Ajustes → Privacidade e Segurança) e confie no perfil em Ajustes → Geral → VPN e Gerenciamento de Dispositivos. Com Apple ID gratuito, a assinatura vale 7 dias e precisa ser renovada.
* **TestFlight / App Store**: requer conta Apple Developer (US$ 99/ano). Com ela, `npx eas-cli@latest build --platform ios --profile production` e depois `npx eas-cli@latest submit --platform ios`.

### Gerar os apps para as lojas

```bash
npx eas-cli@latest build --platform android   # .aab para a Google Play
npx eas-cli@latest build --platform ios       # .ipa para a App Store (requer conta Apple Developer)
```

Os identificadores estão em `app.json` (`com.pedrongjr.minhasfinancas`). Altere antes de publicar, se quiser.

### Verificações

```bash
npm test            # 85 testes do núcleo (+40 da API com TEST_DATABASE_URL) dos leitores de extrato, classificador e relatórios
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
    pdfReaderHtml.ts      página do WebView: pdf.js + OCR (Tesseract.js)
    pdfLayout.ts          agrupa trechos em linhas e limpa erros de OCR
    categories.ts         plano de categorias + palavras-chave
    classifier.ts         motor de classificação
    importer.ts           detecção de formato, ajuste de cartão, deduplicação
    reports.ts            resumos mensais, totais por categoria, orçamento
  db/                     SQLite: schema/migrações e consultas
  components/             UI, seletor de categoria, extrator de PDF/OCR (WebView)
```

## Como o app decide a categoria

1. **Regras do usuário**: o texto da regra precisa aparecer na descrição (sem acento e sem diferença entre maiúsculas e minúsculas).
2. **Histórico**: se você já categorizou à mão um lançamento com a mesma descrição normalizada (sem datas, parcelas e códigos), a mesma categoria é usada.
3. **Regras padrão**: vence o padrão mais específico. Por exemplo, "MERCADO LIVRE" ganha de "MERCADO" e "UBER EATS" ganha de "UBER". Padrões curtos (até 4 letras) só casam com palavras inteiras, então "BET" não casa com "BETONEIRA".
4. Se nada casar, o lançamento vai para **Outros gastos** ou **Outras receitas** e aparece no filtro *Sem categoria*.
