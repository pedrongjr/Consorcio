import type { CategoryDef, CategoryRule } from './types';

/**
 * Plano de categorias padrão, no estilo dos gerenciadores financeiros
 * brasileiros (Minhas Economias, Mobills, Organizze): categorias com
 * subcategorias, separadas em despesas, receitas e transferências.
 * O usuário pode criar, renomear e apagar categorias no app.
 */
export const DEFAULT_CATEGORIES: CategoryDef[] = [
  // ---------- Despesas ----------
  { key: 'alimentacao', name: 'Alimentação', kind: 'expense', icon: 'restaurant', color: '#E4572E' },
  { key: 'alimentacao.supermercado', name: 'Supermercado', kind: 'expense', parent: 'alimentacao', icon: 'cart', color: '#E4572E' },
  { key: 'alimentacao.restaurante', name: 'Restaurantes e lanches', kind: 'expense', parent: 'alimentacao', icon: 'fast-food', color: '#E4572E' },
  { key: 'alimentacao.delivery', name: 'Delivery', kind: 'expense', parent: 'alimentacao', icon: 'bicycle', color: '#E4572E' },
  { key: 'alimentacao.padaria', name: 'Padaria e café', kind: 'expense', parent: 'alimentacao', icon: 'cafe', color: '#E4572E' },

  { key: 'moradia', name: 'Moradia', kind: 'expense', icon: 'home', color: '#29335C' },
  { key: 'moradia.aluguel', name: 'Aluguel e condomínio', kind: 'expense', parent: 'moradia', icon: 'business', color: '#29335C' },
  { key: 'moradia.energia', name: 'Energia elétrica', kind: 'expense', parent: 'moradia', icon: 'flash', color: '#29335C' },
  { key: 'moradia.agua', name: 'Água e saneamento', kind: 'expense', parent: 'moradia', icon: 'water', color: '#29335C' },
  { key: 'moradia.gas', name: 'Gás', kind: 'expense', parent: 'moradia', icon: 'flame', color: '#29335C' },
  { key: 'moradia.internet', name: 'Internet, TV e telefone', kind: 'expense', parent: 'moradia', icon: 'wifi', color: '#29335C' },
  { key: 'moradia.manutencao', name: 'Manutenção e casa', kind: 'expense', parent: 'moradia', icon: 'hammer', color: '#29335C' },

  { key: 'transporte', name: 'Transporte', kind: 'expense', icon: 'car', color: '#F3A712' },
  { key: 'transporte.combustivel', name: 'Combustível', kind: 'expense', parent: 'transporte', icon: 'speedometer', color: '#F3A712' },
  { key: 'transporte.app', name: 'Aplicativos e táxi', kind: 'expense', parent: 'transporte', icon: 'navigate', color: '#F3A712' },
  { key: 'transporte.publico', name: 'Transporte público', kind: 'expense', parent: 'transporte', icon: 'bus', color: '#F3A712' },
  { key: 'transporte.estacionamento', name: 'Estacionamento e pedágio', kind: 'expense', parent: 'transporte', icon: 'pricetag', color: '#F3A712' },
  { key: 'transporte.veiculo', name: 'Manutenção e seguro do veículo', kind: 'expense', parent: 'transporte', icon: 'construct', color: '#F3A712' },

  { key: 'saude', name: 'Saúde', kind: 'expense', icon: 'medkit', color: '#2E86AB' },
  { key: 'saude.farmacia', name: 'Farmácia', kind: 'expense', parent: 'saude', icon: 'medical', color: '#2E86AB' },
  { key: 'saude.plano', name: 'Plano de saúde', kind: 'expense', parent: 'saude', icon: 'shield-checkmark', color: '#2E86AB' },
  { key: 'saude.consultas', name: 'Consultas e exames', kind: 'expense', parent: 'saude', icon: 'pulse', color: '#2E86AB' },
  { key: 'saude.academia', name: 'Academia e esportes', kind: 'expense', parent: 'saude', icon: 'barbell', color: '#2E86AB' },

  { key: 'educacao', name: 'Educação', kind: 'expense', icon: 'school', color: '#6A4C93' },
  { key: 'educacao.mensalidade', name: 'Escola e faculdade', kind: 'expense', parent: 'educacao', icon: 'library', color: '#6A4C93' },
  { key: 'educacao.cursos', name: 'Cursos e livros', kind: 'expense', parent: 'educacao', icon: 'book', color: '#6A4C93' },

  { key: 'lazer', name: 'Lazer', kind: 'expense', icon: 'happy', color: '#1B998B' },
  { key: 'lazer.streaming', name: 'Streaming e assinaturas', kind: 'expense', parent: 'lazer', icon: 'tv', color: '#1B998B' },
  { key: 'lazer.viagem', name: 'Viagens', kind: 'expense', parent: 'lazer', icon: 'airplane', color: '#1B998B' },
  { key: 'lazer.eventos', name: 'Cinema, shows e eventos', kind: 'expense', parent: 'lazer', icon: 'film', color: '#1B998B' },
  { key: 'lazer.jogos', name: 'Jogos e apps', kind: 'expense', parent: 'lazer', icon: 'game-controller', color: '#1B998B' },

  { key: 'compras', name: 'Compras', kind: 'expense', icon: 'bag-handle', color: '#C5283D' },
  { key: 'compras.vestuario', name: 'Roupas e calçados', kind: 'expense', parent: 'compras', icon: 'shirt', color: '#C5283D' },
  { key: 'compras.eletronicos', name: 'Eletrônicos', kind: 'expense', parent: 'compras', icon: 'phone-portrait', color: '#C5283D' },
  { key: 'compras.online', name: 'Lojas online', kind: 'expense', parent: 'compras', icon: 'globe', color: '#C5283D' },
  { key: 'compras.presentes', name: 'Presentes', kind: 'expense', parent: 'compras', icon: 'gift', color: '#C5283D' },

  { key: 'pessoal', name: 'Cuidados pessoais', kind: 'expense', icon: 'person', color: '#D88C9A' },
  { key: 'pessoal.beleza', name: 'Salão e beleza', kind: 'expense', parent: 'pessoal', icon: 'cut', color: '#D88C9A' },
  { key: 'pessoal.pets', name: 'Pets', kind: 'expense', parent: 'pessoal', icon: 'paw', color: '#D88C9A' },

  { key: 'taxas', name: 'Impostos e tarifas', kind: 'expense', icon: 'receipt', color: '#7D7D7D' },
  { key: 'taxas.bancarias', name: 'Tarifas bancárias', kind: 'expense', parent: 'taxas', icon: 'card', color: '#7D7D7D' },
  { key: 'taxas.juros', name: 'Juros, IOF e multas', kind: 'expense', parent: 'taxas', icon: 'trending-down', color: '#7D7D7D' },
  { key: 'taxas.impostos', name: 'Impostos (IPVA, IPTU, IR)', kind: 'expense', parent: 'taxas', icon: 'document-text', color: '#7D7D7D' },

  { key: 'servicos', name: 'Serviços e seguros', kind: 'expense', icon: 'briefcase', color: '#5C6B73' },
  { key: 'servicos.seguros', name: 'Seguros', kind: 'expense', parent: 'servicos', icon: 'umbrella', color: '#5C6B73' },
  { key: 'servicos.celular', name: 'Celular', kind: 'expense', parent: 'servicos', icon: 'call', color: '#5C6B73' },

  { key: 'familia', name: 'Família e doações', kind: 'expense', icon: 'people', color: '#8E6C8A' },
  { key: 'outros_gastos', name: 'Outros gastos', kind: 'expense', icon: 'ellipsis-horizontal', color: '#9E9E9E' },
  { key: 'saques', name: 'Saques', kind: 'expense', icon: 'cash', color: '#9E9E9E' },

  // ---------- Receitas ----------
  { key: 'salario', name: 'Salário', kind: 'income', icon: 'wallet', color: '#2A9D8F' },
  { key: 'renda_extra', name: 'Renda extra e vendas', kind: 'income', icon: 'storefront', color: '#43AA8B' },
  { key: 'rendimentos', name: 'Rendimentos', kind: 'income', icon: 'trending-up', color: '#4D908E' },
  { key: 'reembolsos', name: 'Reembolsos e estornos', kind: 'income', icon: 'return-down-back', color: '#577590' },
  { key: 'outras_receitas', name: 'Outras receitas', kind: 'income', icon: 'add-circle', color: '#90BE6D' },

  // ---------- Transferências (não contam como gasto/receita) ----------
  { key: 'transferencias', name: 'Transferências entre contas', kind: 'transfer', icon: 'swap-horizontal', color: '#457B9D' },
  { key: 'pagamento_fatura', name: 'Pagamento de fatura', kind: 'transfer', icon: 'card', color: '#457B9D' },
  { key: 'investimentos', name: 'Aplicações e resgates', kind: 'transfer', icon: 'stats-chart', color: '#1D3557' },
];

export const UNCATEGORIZED_EXPENSE = 'outros_gastos';
export const UNCATEGORIZED_INCOME = 'outras_receitas';

type RuleSpec = [categoryKey: string, patterns: string[], direction?: 'in' | 'out', priority?: number];

/**
 * Palavras-chave mais comuns em extratos brasileiros. Os padrões são comparados
 * com a descrição normalizada (maiúsculas, sem acentos). A ordem importa:
 * as regras mais específicas vêm primeiro.
 */
const RULE_SPECS: RuleSpec[] = [
  // Transferências e cartão (antes de tudo, para não virar gasto)
  ['pagamento_fatura', ['PAGAMENTO DE FATURA', 'PAGTO FATURA', 'PAG FATURA', 'PAGAMENTO FATURA', 'PGTO FATURA', 'FATURA CARTAO', 'PAGAMENTO CARTAO', 'PAG CARTAO CREDITO', 'PAGAMENTO RECEBIDO', 'PAGAMENTO EFETUADO'], undefined, 50],
  ['investimentos', ['APLICACAO', 'APLIC ', 'RESGATE', 'CDB', 'LCI', 'LCA', 'TESOURO DIRETO', 'POUPANCA', 'RDB', 'FUNDO DE INVEST', 'CORRETORA', 'XP INVEST', 'RICO INVEST', 'NUINVEST', 'BTG PACTUAL', 'INTER INVEST', 'COFRINHO', 'CAIXINHA'], undefined, 50],
  ['rendimentos', ['RENDIMENTO', 'REND PAGO', 'JUROS SOBRE CAPITAL', 'DIVIDENDO', 'REMUNERACAO BASICA', 'PROVENTOS'], 'in'],
  ['transferencias', ['TRANSF ENTRE CONTAS', 'TRANSFERENCIA ENTRE CONTAS', 'MESMA TITULARIDADE', 'TED MESMA TIT', 'ENVIO PROPRIO']],
  // Apostas e loterias ("APOSTA LOTERIA INTERNET" não é conta de internet)
  ['lazer.jogos', ['APOSTA', 'LOTERIAS', 'LOTERIA', 'MEGA SENA', 'LOTOFACIL', 'BETANO', 'BET365', 'SPORTINGBET'], 'out', 20],
  // Financiamento do imóvel (Caixa: "DEBITO PRESTACAO HAB")
  ['moradia', ['PRESTACAO HAB', 'PREST HAB', 'HABITACIONAL', 'FINANC HABIT', 'FINANCIAMENTO IMOB', 'FINANC IMOB'], 'out', 20],

  // Receitas
  ['salario', ['SALARIO', 'FOLHA PAGTO', 'FOLHA DE PAGAMENTO', 'PAGTO SALARIO', 'CRED SALARIO', 'PROVENTO', 'VENCIMENTOS', 'ADIANTAMENTO SALARIAL', '13 SALARIO', 'FERIAS', 'PRO LABORE', 'PROLABORE'], 'in'],
  ['reembolsos', ['ESTORNO', 'REEMBOLSO', 'DEVOLUCAO', 'CASHBACK', 'CREDITO DE COMPRA'], 'in', 50],
  ['renda_extra', ['MERCADO PAGO VENDA', 'VENDA ', 'PAGSEGURO', 'STONE PAGAMENTOS', 'CIELO', 'SUMUP'], 'in'],

  // Alimentação
  ['alimentacao.delivery', ['IFOOD', 'IFD*', 'RAPPI', 'ZE DELIVERY', 'AIQFOME', 'UBER EATS', 'JAMES DELIVERY', 'DELIVERY'], undefined, 50],
  ['alimentacao.supermercado', ['SUPERMERCADO', 'SUPERMERC', 'MERCADO', 'MERCADINHO', 'ATACADAO', 'ASSAI', 'CARREFOUR', 'PAO DE ACUCAR', 'EXTRA HIPER', 'BIG BOMPRECO', 'SAM S CLUB', 'SAMS CLUB', 'MAKRO', 'ZAFFARI', 'GUANABARA', 'PREZUNIC', 'DIA BRASIL', 'HORTIFRUTI', 'HORTI FRUTI', 'SACOLAO', 'OBA HORTI', 'ST MARCHE', 'MAMBO', 'COMPER', 'ANGELONI', 'CONDOR', 'SAVEGNAGO', 'BH SUPER', 'EPA SUPER', 'MART MINAS', 'SUPER NOSSO', 'ACOUGUE', 'HIPERMERCADO', 'ATACAREJO', 'ATACADISTA']],
  ['alimentacao.padaria', ['PADARIA', 'PANIFICADORA', 'CAFETERIA', 'STARBUCKS', 'CAFE ', 'DOCERIA', 'CONFEITARIA', 'SORVETERIA', 'CACAU SHOW', 'KOPENHAGEN']],
  ['alimentacao.restaurante', ['RESTAURANTE', 'RESTAUR', 'LANCHONETE', 'LANCHES', 'PIZZARIA', 'PIZZA', 'CHURRASCARIA', 'HAMBURG', 'BURGER', 'MCDONALDS', 'MC DONALDS', 'BK BRASIL', 'BURGER KING', 'SUBWAY', 'HABIBS', 'OUTBACK', 'SPOLETO', 'GIRAFFAS', 'BOB S', 'BOBS', 'KFC', 'CHINA IN BOX', 'SUSHI', 'TEMAKERIA', 'BAR ', 'BOTECO', 'CHOPERIA', 'CERVEJARIA', 'PASTELARIA', 'ESPETINHO', 'FOOD']],

  // Transporte
  ['transporte.combustivel', ['POSTO', 'AUTO POSTO', 'COMBUSTIVEL', 'SHELL', 'IPIRANGA', 'PETROBRAS', 'BR MANIA', 'ALE COMBUSTIVEIS', 'GASOLINA', 'ETANOL']],
  ['transporte.app', ['UBER', '99 TECNOLOGIA', '99APP', '99 POP', '99*', 'CABIFY', 'INDRIVE', 'TAXI']],
  ['transporte.publico', ['METRO', 'BILHETE UNICO', 'SPTRANS', 'RIOCARD', 'BRT', 'CPTM', 'ONIBUS', 'RECARGA TRANSPORTE', 'TOP SP', 'VALE TRANSPORTE']],
  ['transporte.estacionamento', ['ESTACIONAMENTO', 'ESTAPAR', 'PARE BEM', 'PEDAGIO', 'SEM PARAR', 'CONECTCAR', 'VELOE', 'MOVE MAIS', 'ZONA AZUL', 'AUTOBAN', 'CCR ', 'ECOVIAS', 'ARTERIS']],
  ['transporte.veiculo', ['OFICINA', 'MECANICA', 'AUTO PECAS', 'AUTOPECAS', 'PNEU', 'LAVA JATO', 'LAVAGEM', 'DETRAN', 'LICENCIAMENTO', 'BORRACHARIA', 'CENTRO AUTOMOTIVO']],

  // Moradia
  ['moradia.aluguel', ['ALUGUEL', 'CONDOMINIO', 'IMOBILIARIA', 'QUINTO ANDAR', 'QUINTOANDAR', 'ADM DE IMOVEIS', 'TAXA CONDOMINIAL']],
  ['moradia.energia', ['ENEL', 'CEMIG', 'CPFL', 'LIGHT ', 'LIGHT SERV', 'COPEL', 'CELESC', 'COELBA', 'NEOENERGIA', 'ELEKTRO', 'EQUATORIAL', 'ENERGISA', 'ENERGIA ELETRICA', 'CELPE', 'COSERN', 'EDP ', 'RGE ', 'AMAZONAS ENERGIA', 'CEEE']],
  ['moradia.agua', ['SABESP', 'CEDAE', 'COPASA', 'SANEPAR', 'EMBASA', 'CAESB', 'CASAN', 'COMPESA', 'CAGECE', 'CORSAN', 'SANEAGO', 'AGUAS DE', 'SANEAMENTO', 'DAE ', 'SAAE']],
  ['moradia.gas', ['COMGAS', 'NATURGY', 'ULTRAGAZ', 'LIQUIGAS', 'SUPERGASBRAS', 'COPAGAZ', 'NACIONAL GAS', 'GAS NATURAL']],
  ['moradia.internet', ['VIVO FIBRA', 'NET SERVICOS', 'CLARO NET', 'CLARO S A', 'OI FIBRA', 'OI S A', 'SKY ', 'TIM LIVE', 'INTERNET', 'BANDA LARGA', 'BRISANET', 'ALGAR']],
  ['moradia.manutencao', ['LEROY MERLIN', 'TELHANORTE', 'CASA E CONSTRUCAO', 'MATERIAL DE CONSTRUCAO', 'MATERIAIS DE CONSTRUCAO', 'TOK STOK', 'TOKSTOK', 'ETNA', 'CAMICADO', 'MOBLY', 'MADEIRAMADEIRA', 'FERRAGENS', 'ELETRICISTA', 'ENCANADOR', 'DIARISTA']],

  // Serviços
  ['servicos.celular', ['RECARGA', 'VIVO', 'CLARO', 'TIM ', 'TIM S A', 'OI MOVEL']],
  ['servicos.seguros', ['SEGURO', 'SEGURADORA', 'PORTO SEGURO', 'AZUL SEGUROS', 'BRADESCO SEG', 'SULAMERICA SEG', 'MAPFRE', 'TOKIO MARINE', 'LIBERTY', 'ALLIANZ', 'HDI SEG', 'YOUSE']],

  // Saúde
  ['saude.farmacia', ['DROGARIA', 'FARMACIA', 'DROGASIL', 'DROGA RAIA', 'RAIA ', 'PAGUE MENOS', 'PANVEL', 'SAO JOAO FARM', 'ULTRAFARMA', 'DROGAO', 'NISSEI', 'VENANCIO', 'EXTRAFARMA', 'FARMA']],
  ['saude.plano', ['UNIMED', 'AMIL', 'BRADESCO SAUDE', 'SULAMERICA SAUDE', 'HAPVIDA', 'NOTREDAME', 'NOTRE DAME', 'PREVENT SENIOR', 'PLANO DE SAUDE', 'ODONTOPREV', 'PORTO SAUDE', 'GOLDEN CROSS']],
  ['saude.consultas', ['CLINICA', 'HOSPITAL', 'LABORATORIO', 'LAB ', 'FLEURY', 'DASA', 'DELBONI', 'LAVOISIER', 'SABIN', 'CONSULTORIO', 'ODONTO', 'DENTISTA', 'PSICOLOG', 'FISIOTERAPIA', 'OTICA', 'OPTICA', 'EXAME']],
  ['saude.academia', ['ACADEMIA', 'SMART FIT', 'SMARTFIT', 'BLUEFIT', 'BODYTECH', 'SELFIT', 'GYMPASS', 'WELLHUB', 'TOTALPASS', 'CROSSFIT', 'PILATES', 'NATACAO', 'DECATHLON', 'CENTAURO', 'NETSHOES']],

  // Educação
  ['educacao.mensalidade', ['ESCOLA', 'COLEGIO', 'FACULDADE', 'UNIVERSIDADE', 'MENSALIDADE', 'ANHANGUERA', 'ESTACIO', 'UNIP', 'KROTON', 'COGNA', 'UNINOVE', 'PUC', 'MACKENZIE', 'CRECHE', 'ENSINO']],
  ['educacao.cursos', ['CURSO', 'UDEMY', 'ALURA', 'COURSERA', 'HOTMART', 'EDUZZ', 'KIWIFY', 'DUOLINGO', 'LIVRARIA', 'SARAIVA', 'LIVRARIA CULTURA', 'AMAZON KINDLE', 'KINDLE', 'IDIOMAS', 'INGLES', 'WIZARD', 'CCAA', 'FISK', 'CNA ']],

  // Lazer
  ['lazer.streaming', ['NETFLIX', 'SPOTIFY', 'DISNEY', 'PRIME VIDEO', 'AMAZON PRIME', 'AMAZONPRIME', 'HBO', 'MAX ', 'GLOBOPLAY', 'PARAMOUNT', 'STAR PLUS', 'APPLE.COM/BILL', 'APPLE COM BILL', 'APPLE.COM', 'ITUNES', 'YOUTUBE', 'GOOGLE STORAGE', 'GOOGLE ONE', 'DEEZER', 'CRUNCHYROLL', 'TWITCH', 'TELECINE', 'MUBI', 'ICLOUD', 'DROPBOX', 'MICROSOFT', 'CHATGPT', 'OPENAI', 'CLAUDE.AI', 'ANTHROPIC', 'CANVA', 'ADOBE']],
  ['lazer.viagem', ['HOTEL', 'POUSADA', 'AIRBNB', 'BOOKING', 'DECOLAR', 'LATAM', 'GOL LINHAS', 'GOL TRANSP', 'AZUL LINHAS', 'AZUL ', 'SMILES', 'LIVELO', 'MAXMILHAS', '123MILHAS', 'HURB', 'CVC', 'LOCALIZA', 'MOVIDA', 'UNIDAS', 'RODOVIARIA', 'CLICKBUS', 'BUSER', 'TRIVAGO', 'EXPEDIA', 'HOSTEL']],
  ['lazer.eventos', ['CINEMA', 'CINEMARK', 'CINEPOLIS', 'KINOPLEX', 'UCI ', 'INGRESSO', 'SYMPLA', 'EVENTIM', 'TICKET', 'TEATRO', 'SHOW ', 'MUSEU', 'PARQUE', 'CLUBE']],
  ['lazer.jogos', ['STEAM', 'PLAYSTATION', 'XBOX', 'NINTENDO', 'GOOGLE PLAY', 'APP STORE', 'EPIC GAMES', 'RIOT', 'GARENA', 'LOTERIA', 'LOTERICA', 'MEGA SENA', 'BET', 'BLAZE']],

  // Compras
  ['compras.online', ['AMAZON', 'MERCADOLIVRE', 'MERCADO LIVRE', 'MERCADOPAGO', 'MP *', 'SHOPEE', 'ALIEXPRESS', 'SHEIN', 'TEMU', 'MAGALU', 'MAGAZINE LUIZA', 'AMERICANAS', 'SUBMARINO', 'CASAS BAHIA', 'PONTO FRIO', 'KABUM', 'PAYPAL', 'PICPAY', 'EBANX']],
  ['compras.vestuario', ['RENNER', 'C&A', 'C A MODAS', 'RIACHUELO', 'MARISA', 'ZARA', 'HERING', 'CENTAURO', 'NIKE', 'ADIDAS', 'ARAMIS', 'YOUCOM', 'PERNAMBUCANAS', 'CALCADOS', 'SAPATARIA', 'AREZZO', 'DAFITI', 'ZATTINI', 'VESTUARIO', 'MODAS', 'BOUTIQUE', 'LOJAS AVENIDA']],
  ['compras.eletronicos', ['FAST SHOP', 'APPLE STORE', 'SAMSUNG', 'XIAOMI', 'MOTOROLA', 'DELL', 'ELETRO', 'INFORMATICA', 'CELULARES']],
  ['compras.presentes', ['PRESENTE', 'FLORICULTURA', 'BRINQUEDO', 'RI HAPPY', 'PBKIDS', 'O BOTICARIO', 'BOTICARIO', 'NATURA', 'AVON', 'SEPHORA', 'EUDORA']],

  // Cuidados pessoais
  ['pessoal.beleza', ['SALAO', 'CABELEIREIRO', 'BARBEARIA', 'BARBER', 'ESTETICA', 'MANICURE', 'DEPILACAO', 'SPA ', 'BELEZA']],
  ['pessoal.pets', ['PETZ', 'COBASI', 'PET SHOP', 'PETSHOP', 'VETERINARI', 'AGROPECUARIA', 'RACAO', 'PET ']],

  // Impostos e tarifas
  ['taxas.bancarias', ['TARIFA', 'TAR ', 'CESTA DE SERVICOS', 'CESTA SERV', 'PACOTE DE SERVICOS', 'PACOTE SERV', 'ANUIDADE', 'MANUTENCAO DE CONTA', 'TAXA DE MANUTENCAO', 'TARIFA PIX', 'TAR TED', 'TAR DOC', 'SEGURO PRESTAMISTA', 'AVULSO']],
  ['taxas.juros', ['IOF', 'JUROS', 'MULTA', 'ENCARGOS', 'MORA', 'CHEQUE ESPECIAL', 'LIMITE DA CONTA', 'ROTATIVO', 'JUROS DE ATRASO']],
  ['taxas.impostos', ['IPVA', 'IPTU', 'DARF', 'RECEITA FEDERAL', 'IMPOSTO', 'DAS ', 'SIMPLES NACIONAL', 'GPS INSS', 'INSS', 'SEFAZ', 'DPVAT', 'TAXA LIXO', 'PREFEITURA', 'GRU']],

  ['saques', ['SAQUE', 'SAQ ', 'BANCO24HORAS', 'BANCO 24 HORAS', 'TECBAN', 'RETIRADA']],
  ['familia', ['DOACAO', 'DIZIMO', 'IGREJA', 'OFERTA', 'VAKINHA', 'MESADA', 'PENSAO']],
];

export const DEFAULT_RULES: CategoryRule[] = RULE_SPECS.flatMap(([categoryKey, patterns, direction, priority]) =>
  patterns.map((pattern) => ({ pattern, categoryKey, direction, priority, source: 'default' as const })),
);
