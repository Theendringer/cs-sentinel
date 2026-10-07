import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "cs_sentinel_db";

const client = new MongoClient(MONGODB_URI);

async function seedDatabase() {
  console.log("🌱 [Seed] Conectando ao MongoDB...");
  await client.connect();
  const db = client.db(MONGODB_DB_NAME);

  console.log("🧹 [Seed] Limpando collections anteriores de teste...");
  await db.collection("tenants").deleteMany({});
  await db.collection("logs").deleteMany({});
  await db.collection("sessions").deleteMany({});
  await db.collection("alerts").deleteMany({});

  const tenantAcmeId = new ObjectId();
  const tenantInovaId = new ObjectId();
  const tenantGlobalId = new ObjectId();

  const tenants = [
    {
      _id: tenantAcmeId,
      name: "Acme Tech Solutions",
      plan: "Enterprise",
      contactEmail: "cto@acmetech.com",
      status: "active",
      createdAt: new Date(),
    },
    {
      _id: tenantInovaId,
      name: "Inova Retail & E-commerce",
      plan: "Growth",
      contactEmail: "ops@inovaretail.com",
      status: "active",
      createdAt: new Date(),
    },
    {
      _id: tenantGlobalId,
      name: "Global Corp Logística",
      plan: "Enterprise Plus",
      contactEmail: "head.tech@globalcorp.com",
      status: "active",
      createdAt: new Date(),
    },
  ];

  console.log("🏢 [Seed] Inserindo tenants...");
  await db.collection("tenants").insertMany(tenants);

  const now = Date.now();
  const thirtyMinutesAgo = new Date(now - 30 * 60 * 1000);
  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000);
  const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000);

  // =========================================================================
  // 1. Logs para Acme Tech (Cenário: Falha Crítica -> 8 erros nas últimas 2h)
  // =========================================================================
  const acmeLogs = [
    {
      tenantId: tenantAcmeId.toString(),
      level: "error",
      message: "Gateway Timeout 504 on POST /api/v1/checkout",
      timestamp: thirtyMinutesAgo,
    },
    {
      tenantId: tenantAcmeId.toString(),
      level: "fatal",
      message: "Database connection pool exhausted",
      timestamp: thirtyMinutesAgo,
    },
    {
      tenantId: tenantAcmeId.toString(),
      level: "error",
      message: "Payment webhook worker crashed with uncaughtException",
      timestamp: oneHourAgo,
    },
    {
      tenantId: tenantAcmeId.toString(),
      level: "error",
      message: "Memory spike above 95% on container instance-3",
      timestamp: oneHourAgo,
    },
    {
      tenantId: tenantAcmeId.toString(),
      level: "error",
      message: "Failed to persist transaction audit log",
      timestamp: oneHourAgo,
    },
    {
      tenantId: tenantAcmeId.toString(),
      level: "error",
      message: "Socket connection reset by peer on auth server",
      timestamp: thirtyMinutesAgo,
    },
    {
      tenantId: tenantAcmeId.toString(),
      level: "error",
      message: "Redis cache connection refused",
      timestamp: thirtyMinutesAgo,
    },
    {
      tenantId: tenantAcmeId.toString(),
      level: "error",
      message: "Circuit breaker OPEN for external invoice service",
      timestamp: thirtyMinutesAgo,
    },
  ];

  // Sessões da Acme: Vários usuários ativos (engajamento alto, problema puramente técnico)
  const acmeSessions = [
    { tenantId: tenantAcmeId.toString(), userId: "user-acme-1", lastActiveAt: thirtyMinutesAgo },
    { tenantId: tenantAcmeId.toString(), userId: "user-acme-2", lastActiveAt: oneHourAgo },
    { tenantId: tenantAcmeId.toString(), userId: "user-acme-3", lastActiveAt: threeDaysAgo },
    { tenantId: tenantAcmeId.toString(), userId: "user-acme-4", lastActiveAt: fiveDaysAgo },
  ];

  // =========================================================================
  // 2. Logs e Sessões para Inova Retail (Cenário: Risco de Churn -> Apenas 1 usuário ativo nos últimos 7d)
  // =========================================================================
  const inovaLogs = [
    {
      tenantId: tenantInovaId.toString(),
      level: "info",
      message: "Health check 200 OK",
      timestamp: oneHourAgo,
    },
  ];

  const inovaSessions = [
    // Apenas 1 usuário ativo na semana toda
    { tenantId: tenantInovaId.toString(), userId: "user-inova-solo", lastActiveAt: threeDaysAgo },
  ];

  // =========================================================================
  // 3. Logs e Sessões para Global Corp (Cenário: Saudável -> 0 erros, 4 usuários ativos)
  // =========================================================================
  const globalLogs = [
    {
      tenantId: tenantGlobalId.toString(),
      level: "info",
      message: "User logged in",
      timestamp: oneHourAgo,
    },
  ];

  const globalSessions = [
    { tenantId: tenantGlobalId.toString(), userId: "user-global-1", lastActiveAt: thirtyMinutesAgo },
    { tenantId: tenantGlobalId.toString(), userId: "user-global-2", lastActiveAt: oneHourAgo },
    { tenantId: tenantGlobalId.toString(), userId: "user-global-3", lastActiveAt: threeDaysAgo },
    { tenantId: tenantGlobalId.toString(), userId: "user-global-4", lastActiveAt: fiveDaysAgo },
  ];

  console.log("📝 [Seed] Inserindo logs de eventos...");
  await db.collection("logs").insertMany([...acmeLogs, ...inovaLogs, ...globalLogs]);

  console.log("👥 [Seed] Inserindo sessões de usuários...");
  await db.collection("sessions").insertMany([...acmeSessions, ...inovaSessions, ...globalSessions]);

  console.log("\n✅ [Seed] Base populada com sucesso!");
  console.log(`- Acme Tech Solutions:       8 erros (2h), 4 usuários ativos (7d) -> Esperado: ALERTA CRÍTICO`);
  console.log(`- Inova Retail & E-commerce: 0 erros (2h), 1 usuário ativo (7d)   -> Esperado: ALERTA RISCO DE CHURN`);
  console.log(`- Global Corp Logística:     0 erros (2h), 4 usuários ativos (7d) -> Esperado: SAUDÁVEL (Sem alertas)`);
}

seedDatabase()
  .catch((err) => {
    console.error("❌ Erro no seed:", err);
  })
  .finally(async () => {
    await client.close();
    console.log("🔌 [Seed] Conexão encerrada.");
  });
