import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import { firestoreDb } from "./firebase.mjs";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "cs_sentinel_db";

const mongoClient = new MongoClient(MONGODB_URI);

async function seedTestEnvironment() {
  console.log("============================================================");
  console.log("🌱 [Seed-Test] INICIANDO POPULAÇÃO DE DADOS DE TESTE");
  console.log("============================================================\n");

  // 1. Conectar ao MongoDB
  await mongoClient.connect();
  const db = mongoClient.db(MONGODB_DB_NAME);
  console.log(`✅ [MongoDB] Conectado ao banco: "${MONGODB_DB_NAME}"`);

  // 2. Limpar coleções de teste no MongoDB
  console.log("🧹 [MongoDB] Limpando collections de teste...");
  await db.collection("entidades").deleteMany({});
  await db.collection("usuarios").deleteMany({});
  await db.collection("logs_erros").deleteMany({});
  await db.collection("erros").deleteMany({});
  await db.collection("errosintegracoes").deleteMany({});

  // 3. Limpar collection monitored_tenants no Firestore
  console.log("🧹 [Firestore] Limpando collection 'monitored_tenants'...");
  const firestoreSnapshot = await firestoreDb.collection("monitored_tenants").get();
  const batch = firestoreDb.batch();
  firestoreSnapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();

  // =========================================================================
  // GERAÇÃO DOS IDs DAS ENTIDADES (HEX STRING PARA FIRESTORE E OBJECTID PARA MONGO)
  // =========================================================================
  const entidadeAlphaId = new ObjectId();
  const entidadeOmniLogId = new ObjectId();

  const alphaHex = entidadeAlphaId.toHexString();
  const omniLogHex = entidadeOmniLogId.toHexString();

  const now = Date.now();
  const umDia = 24 * 60 * 60 * 1000;

  // =========================================================================
  // ENTIDADE 1: Fintech Alpha Pagamentos (Cenário: RISCO TÉCNICO CRÍTICO)
  // - 8 Erros nas últimas 2 horas (> threshold de 5)
  // - Usuários com acesso recente e frequente (alto engajamento, mas sofrendo com erros)
  // =========================================================================
  const tenantAlphaFirestore = {
    entidadeId: alphaHex,
    nome: "Fintech Alpha Pagamentos",
    assignedCS: {
      name: "Mariana Silva",
      email: "mariana.silva@empresa.com",
    },
    active: true,
    thresholds: {
      diasSemAcessoAlerta: 7,
      maxErros2h: 5,
      tiposMonitorados: ["Anúncio", "Pedido"],
    },
  };

  const entidadeAlphaMongo = {
    _id: entidadeAlphaId,
    nome: "Fintech Alpha Pagamentos",
    status: "ativo",
    dataCriacao: new Date(now - 90 * umDia),
  };

  const usuariosAlphaMongo = [
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      nome: "Lucas Ferreira (Tech Lead)",
      email: "lucas.ferreira@alphapagos.com",
      ultimoAcesso: new Date(now - 30 * 60 * 1000), // 30 min atrás
    },
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      nome: "Beatriz Costa (DevOps)",
      email: "beatriz.costa@alphapagos.com",
      ultimoAcesso: new Date(now - 45 * 60 * 1000), // 45 min atrás
    },
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      nome: "Gabriel Ramos (Operações)",
      email: "gabriel.ramos@alphapagos.com",
      ultimoAcesso: new Date(now - 1 * umDia), // 1 dia atrás
    },
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      nome: "Aline Souza (Financeiro)",
      email: "aline.souza@alphapagos.com",
      ultimoAcesso: new Date(now - 3 * umDia), // 3 dias atrás
    },
  ];

  // 8 erros gerados nos últimos 90 minutos (< 2h)
  const errosAlphaMongo = [
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      mensagem: "504 Gateway Timeout no webhook de liquidação PIX",
      status: 504,
      data: new Date(now - 20 * 60 * 1000),
    },
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      mensagem: "Pool de conexões com banco de dados transacional esgotado",
      status: 500,
      data: new Date(now - 35 * 60 * 1000),
    },
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      mensagem: "Falha de autenticação mTLS com gateway bancário BACEN",
      status: 502,
      data: new Date(now - 45 * 60 * 1000),
    },
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      mensagem: "Queue backlog excedeu 10.000 mensagens sem ack",
      status: 503,
      data: new Date(now - 55 * 60 * 1000),
    },
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      mensagem: "Circuit breaker ABERTO para microsserviço de conciliação",
      status: 503,
      data: new Date(now - 65 * 60 * 1000),
    },
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      mensagem: "Unhandled rejection ao processar estorno de cobrança",
      status: 500,
      data: new Date(now - 75 * 60 * 1000),
    },
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      mensagem: "Tempo de resposta do webhook excedeu SLA de 5000ms",
      status: 504,
      data: new Date(now - 85 * 60 * 1000),
    },
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      mensagem: "Erro crítico ao gravar log fiscal de auditoria",
      status: 500,
      data: new Date(now - 95 * 60 * 1000),
    },
  ];

  // =========================================================================
  // Estrutura Real da Collection errosintegracoes (Read-Only)
  // Cenário: Múltiplos erros no canal VTEX (tipo 'anuncio') com padrão recorrente
  // de divergência de EAN, além de erros em pedidos e outros canais.
  // =========================================================================
  const errosAlphaIntegracoes = [
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      status: "pendente",
      layoutIntegracao: "VTEX",
      tipoIntegracao: "anuncio",
      codigoRegistro: "SKU-99201",
      mensagens: [{ tipo: "erro", texto: "Dados inconsistentes no cadastro de EAN" }],
      requisicao: { retorno: { data: { erro: "EAN_INVALID_FORMAT", status: 400 } } },
      dataCriacao: new Date(now - 25 * 60 * 1000),
      ultimaAtualizacao: new Date(now - 20 * 60 * 1000),
    },
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      status: "pendente",
      layoutIntegracao: "VTEX",
      tipoIntegracao: "anuncio",
      codigoRegistro: "SKU-99202",
      mensagens: [{ tipo: "erro", texto: "Dados inconsistentes no cadastro de EAN" }],
      requisicao: { retorno: { data: { erro: "EAN_INVALID_FORMAT", status: 400 } } },
      dataCriacao: new Date(now - 35 * 60 * 1000),
      ultimaAtualizacao: new Date(now - 30 * 60 * 1000),
    },
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      status: "pendente",
      layoutIntegracao: "VTEX",
      tipoIntegracao: "anuncio",
      codigoRegistro: "SKU-99203",
      mensagens: [{ tipo: "erro", texto: "Dados inconsistentes no cadastro de EAN" }],
      requisicao: { retorno: { data: { erro: "EAN_INVALID_FORMAT", status: 400 } } },
      dataCriacao: new Date(now - 45 * 60 * 1000),
      ultimaAtualizacao: new Date(now - 40 * 60 * 1000),
    },
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      status: "pendente",
      layoutIntegracao: "VTEX",
      tipoIntegracao: "pedido",
      codigoRegistro: "PED-10291",
      mensagens: [{ tipo: "erro", texto: "Timeout ao consultar status de pagamento do pedido" }],
      requisicao: { retorno: { data: { erro: "GATEWAY_TIMEOUT", status: 504 } } },
      dataCriacao: new Date(now - 50 * 60 * 1000),
      ultimaAtualizacao: new Date(now - 48 * 60 * 1000),
    },
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      status: "pendente",
      layoutIntegracao: "Mercado Livre",
      tipoIntegracao: "anuncio",
      codigoRegistro: "MLB-778129",
      mensagens: [{ tipo: "erro", texto: "Token de autenticação OAuth expirado para sincronização de anúncio" }],
      requisicao: { retorno: { data: { erro: "TOKEN_EXPIRED", status: 401 } } },
      dataCriacao: new Date(now - 60 * 60 * 1000),
      ultimaAtualizacao: new Date(now - 55 * 60 * 1000),
    },
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      status: "pendente",
      layoutIntegracao: "Mercado Livre",
      tipoIntegracao: "pedido",
      codigoRegistro: "MLB-PED-4410",
      mensagens: [{ tipo: "erro", texto: "Divergência de tributação ICMS na emissão da NF-e do pedido" }],
      requisicao: { retorno: { data: { erro: "FISCAL_ERROR", status: 422 } } },
      dataCriacao: new Date(now - 70 * 60 * 1000),
      ultimaAtualizacao: new Date(now - 65 * 60 * 1000),
    },
    {
      _id: new ObjectId(),
      entidade: entidadeAlphaId,
      status: "pendente",
      layoutIntegracao: "Shopee",
      tipoIntegracao: "estoque",
      codigoRegistro: "EST-3301",
      mensagens: [{ tipo: "erro", texto: "Quantidade de estoque negativa rejeitada pelo canal" }],
      requisicao: { retorno: { data: { erro: "INVALID_STOCK", status: 400 } } },
      dataCriacao: new Date(now - 80 * 60 * 1000),
      ultimaAtualizacao: new Date(now - 75 * 60 * 1000),
    },
  ];

  // =========================================================================
  // ENTIDADE 2: OmniLog Logística Global (Cenário: RISCO DE CHURN / DESENGAJAMENTO)
  // - 0 Usuários ativos nos últimos 7 dias (últimos acessos há >15 dias ou nunca)
  // - 0 Erros recentes
  // =========================================================================
  const tenantOmniLogFirestore = {
    entidadeId: omniLogHex,
    nome: "OmniLog Logística Global",
    assignedCS: {
      name: "Carlos Eduardo",
      email: "carlos.eduardo@empresa.com",
    },
    active: true,
    thresholds: {
      diasSemAcessoAlerta: 7,
      maxErros2h: 5,
    },
  };

  const entidadeOmniLogMongo = {
    _id: entidadeOmniLogId,
    nome: "OmniLog Logística Global",
    status: "ativo",
    dataCriacao: new Date(now - 150 * umDia),
  };

  const usuariosOmniLogMongo = [
    {
      _id: new ObjectId(),
      entidade: entidadeOmniLogId,
      nome: "Roberto Frota (Diretor de Frota)",
      email: "roberto.frota@omnilog.com",
      ultimoAcesso: new Date(now - 19 * umDia), // 19 dias sem acessar
    },
    {
      _id: new ObjectId(),
      entidade: entidadeOmniLogId,
      nome: "Juliana Mendes (Gerente de Operações)",
      email: "juliana.mendes@omnilog.com",
      ultimoAcesso: new Date(now - 28 * umDia), // 28 dias sem acessar
    },
    {
      _id: new ObjectId(),
      entidade: entidadeOmniLogId,
      nome: "Fabio Santos (Analista Logístico)",
      email: "fabio.santos@omnilog.com",
      ultimoAcesso: new Date(now - 42 * umDia), // 42 dias sem acessar
    },
    {
      _id: new ObjectId(),
      entidade: entidadeOmniLogId,
      nome: "Patricia Lima (Supervisora)",
      email: "patricia.lima@omnilog.com",
      ultimoAcesso: null, // Nunca acessou
    },
  ];

  // Apenas 1 log antigo de 10 dias atrás (0 erros nas últimas 2h)
  const errosOmniLogMongo = [
    {
      _id: new ObjectId(),
      entidade: entidadeOmniLogId,
      mensagem: "Aviso de sincronização rotineira",
      status: 200,
      data: new Date(now - 10 * umDia),
    },
  ];

  // =========================================================================
  // PERSISTÊNCIA NO FIRESTORE
  // =========================================================================
  console.log("🔥 [Firestore] Inserindo 2 entidades em 'monitored_tenants'...");
  await firestoreDb.collection("monitored_tenants").doc(alphaHex).set(tenantAlphaFirestore);
  await firestoreDb.collection("monitored_tenants").doc(omniLogHex).set(tenantOmniLogFirestore);

  // =========================================================================
  // PERSISTÊNCIA NO MONGODB
  // =========================================================================
  console.log("🍃 [MongoDB] Inserindo entidades na collection 'entidades'...");
  await db.collection("entidades").insertMany([entidadeAlphaMongo, entidadeOmniLogMongo]);

  console.log("🍃 [MongoDB] Inserindo usuários na collection 'usuarios'...");
  await db.collection("usuarios").insertMany([...usuariosAlphaMongo, ...usuariosOmniLogMongo]);

  console.log("🍃 [MongoDB] Inserindo erros na collection 'logs_erros'...");
  await db.collection("logs_erros").insertMany([...errosAlphaMongo, ...errosOmniLogMongo]);

  console.log("🍃 [MongoDB] Inserindo erros na collection 'errosintegracoes'...");
  await db.collection("errosintegracoes").insertMany(errosAlphaIntegracoes);

  console.log("\n============================================================");
  console.log("🎉 SEED CONCLUÍDO COM SUCESSO!");
  console.log("============================================================");
  console.log(`1. Fintech Alpha Pagamentos (ID: ${alphaHex})`);
  console.log(`   - CS: Mariana Silva <mariana.silva@empresa.com>`);
  console.log(`   - Erros recentes (2h): 8 erros (Limite: 5)`);
  console.log(`   - Usuários ativos (7d): 4 usuários`);
  console.log(`   👉 Esperado: Disparo de [RISCO TÉCNICO CRÍTICO]\n`);

  console.log(`2. OmniLog Logística Global (ID: ${omniLogHex})`);
  console.log(`   - CS: Carlos Eduardo <carlos.eduardo@empresa.com>`);
  console.log(`   - Erros recentes (2h): 0 erros`);
  console.log(`   - Usuários ativos (7d): 0 de 4 cadastrados (últimos acessos há >19 dias ou nunca)`);
  console.log(`   👉 Esperado: Disparo de [RISCO DE CHURN / DESENGAJAMENTO]\n`);
  console.log("Para rodar o agente e executar a auditoria:");
  console.log("👉 npm start\n");
}

seedTestEnvironment()
  .catch((err) => {
    if (err.message?.includes("Cloud Firestore API has not been used") || err.code === 7) {
      console.error("\n❌ [Firestore] A API do Cloud Firestore ainda não está habilitada no projeto 'cs-agent-sentinel'.");
      console.error("👉 Para criar/ativar o banco Firestore (modo gratuito), acesse:");
      console.error("   https://console.firebase.google.com/project/cs-agent-sentinel/firestore");
      console.error("   (Ou https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=cs-agent-sentinel)\n");
    } else {
      console.error("❌ Erro ao executar seed-test:", err);
    }
  })
  .finally(async () => {
    await mongoClient.close();
    console.log("🔌 [MongoDB] Conexão encerrada.");
  });
