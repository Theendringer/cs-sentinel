import "dotenv/config";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { MongoClient, ObjectId } from "mongodb";
import {
  getActiveMonitoredTenants,
  saveCSAlertToFirestore,
  resolveTenantAlertsInFirestore,
} from "./firebase.mjs";

// ============================================================================
// 1. CONFIGURAÇÕES & VALIDAÇÃO DE AMBIENTE
// ============================================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "cs_sentinel_db";
const CS_WEBHOOK_URL = process.env.CS_WEBHOOK_URL || null;

if (!GEMINI_API_KEY) {
  console.error("❌ ERRO: A variável de ambiente GEMINI_API_KEY não foi configurada no arquivo .env");
  process.exit(1);
}

// Inicialização do cliente MongoDB
const mongoClient = new MongoClient(MONGODB_URI);
let db;

/**
 * Conecta ao MongoDB
 */
async function connectToDatabase() {
  try {
    await mongoClient.connect();
    db = mongoClient.db(MONGODB_DB_NAME);
    console.log(`✅ [MongoDB] Conectado com sucesso ao banco de dados: "${MONGODB_DB_NAME}"`);
  } catch (error) {
    console.error("❌ [MongoDB] Falha ao conectar:", error.message);
    throw error;
  }
}

// ============================================================================
// 2. IMPLEMENTAÇÃO DAS FERRAMENTAS (TOOLS NATIVAS)
// ============================================================================

/**
 * FERRAMENTA 1: getMonitoredTenants()
 * Consulta o Firebase Firestore (collection monitored_tenants onde active == true)
 * e retorna as entidades a auditar.
 */
async function getMonitoredTenants() {
  console.log("\n🔍 [Tool Call: getMonitoredTenants] Consultando painel de CS no Firestore...");
  const tenants = await getActiveMonitoredTenants();

  console.log(`📋 [Tool Result: getMonitoredTenants] ${tenants.length} entidade(s) ativa(s) retornada(s) do Firebase.`);
  return {
    total: tenants.length,
    monitoredTenants: tenants,
  };
}

/**
 * Helper para construir regex case-insensitive e tolerante a acentuação
 */
function buildTipoIntegracaoRegex(tipo) {
  const trimmed = tipo.trim();
  const unaccented = trimmed.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedUnaccented = unaccented.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const regexes = [new RegExp(`^${escaped}$`, "i")];
  if (escaped.toLowerCase() !== escapedUnaccented.toLowerCase()) {
    regexes.push(new RegExp(`^${escapedUnaccented}$`, "i"));
  }
  return regexes;
}

/**
 * FERRAMENTA 2: checkTenantHealth({ entidadeId, diasSemAcesso = 7, tiposMonitorados })
 * Converte obrigatoriamente entidadeId para ObjectId e consulta:
 * - Usuários cadastrados, ativos no período e inativos
 * - Erros recentes nas últimas 2 horas na collection 'errosintegracoes' (Read-Only)
 * - Agrupamento em memória por layoutIntegracao + tipoIntegracao para análise contextual da IA
 */
async function checkTenantHealth({ entidadeId, diasSemAcesso = 7, tiposMonitorados }) {
  console.log(`\n📊 [Tool Call: checkTenantHealth] Auditando telemetria no MongoDB para entidadeId: "${entidadeId}"...`);

  if (!entidadeId) {
    return { error: "O parâmetro entidadeId é obrigatório." };
  }

  // ATENÇÃO CRÍTICA: Conversão obrigatória para ObjectId
  let targetObjectId;
  try {
    targetObjectId = new ObjectId(entidadeId);
  } catch (err) {
    return { error: `ID inválido fornecido: "${entidadeId}". Esperado um hex de 24 caracteres compatível com ObjectId.` };
  }

  const agora = Date.now();
  const limiteDias = diasSemAcesso && !isNaN(diasSemAcesso) ? Number(diasSemAcesso) : 7;
  const limiteInatividade = new Date(agora - limiteDias * 24 * 60 * 60 * 1000);
  const duasHorasAtras = new Date(agora - 2 * 60 * 60 * 1000);

  // 1. Busca dados da entidade para conferência de nome
  const entidadeDoc = await db.collection("entidades").findOne({ _id: targetObjectId });
  const nomeEntidade = entidadeDoc ? entidadeDoc.nome : "Desconhecida no MongoDB";

  // 2. Consulta de Usuários no MongoDB (Collection: usuarios)
  const usuarios = await db.collection("usuarios").find({ entidade: targetObjectId }).toArray();
  const totalUsuariosCadastrados = usuarios.length;

  const usuariosAtivos = [];
  const usuariosInativos = [];

  for (const user of usuarios) {
    const dataAcesso = user.ultimoAcesso ? new Date(user.ultimoAcesso) : null;
    const isAtivo = dataAcesso && dataAcesso >= limiteInatividade;

    if (isAtivo) {
      usuariosAtivos.push({
        nome: user.nome,
        email: user.email,
        ultimoAcesso: dataAcesso.toISOString(),
      });
    } else {
      const diasInativo = dataAcesso
        ? Math.floor((agora - dataAcesso.getTime()) / (1000 * 60 * 60 * 24))
        : "Nunca acessou";

      usuariosInativos.push({
        nome: user.nome,
        email: user.email,
        ultimoAcesso: dataAcesso ? dataAcesso.toISOString() : "Nunca acessou",
        diasSemAcesso: diasInativo,
      });
    }
  }

  // 3. Consulta de Erros nas últimas 2 horas (Collection: errosintegracoes - Read-Only)
  const queryErros = {
    entidade: targetObjectId,
    status: "pendente",
    $or: [
      { dataCriacao: { $gte: duasHorasAtras } },
      { ultimaAtualizacao: { $gte: duasHorasAtras } },
      { dataCriacao: { $gte: duasHorasAtras.toISOString() } },
      { ultimaAtualizacao: { $gte: duasHorasAtras.toISOString() } },
    ],
  };

  const tiposAtivos = Array.isArray(tiposMonitorados)
    ? tiposMonitorados.filter((t) => typeof t === "string" && t.trim().length > 0)
    : [];

  if (tiposAtivos.length > 0) {
    const regexList = tiposAtivos.flatMap(buildTipoIntegracaoRegex);
    queryErros.tipoIntegracao = { $in: regexList };
  }

  const projection = {
    layoutIntegracao: 1,
    tipoIntegracao: 1,
    codigoRegistro: 1,
    "mensagens.texto": 1,
    "mensagens.tipo": 1,
    "requisicao.retorno.data": 1,
    dataCriacao: 1,
    ultimaAtualizacao: 1,
  };

  const errosDocs = await db
    .collection("errosintegracoes")
    .find(queryErros, { projection })
    .sort({ dataCriacao: -1, ultimaAtualizacao: -1 })
    .limit(300)
    .toArray();

  let totalErrosUltimas2h = errosDocs.length;
  let gruposErros = [];
  let amostraMensagens = [];

  if (errosDocs.length > 0) {
    // Agrupa os erros em memória por layoutIntegracao + tipoIntegracao
    const gruposMap = new Map();

    for (const doc of errosDocs) {
      const canal = doc.layoutIntegracao || "Geral";
      const tipo = doc.tipoIntegracao || "Integracao";
      const chave = `${canal}__${tipo}`.toLowerCase();

      let grupo = gruposMap.get(chave);
      if (!grupo) {
        grupo = {
          layoutIntegracao: canal,
          tipoIntegracao: tipo,
          totalErros: 0,
          codigosAfetados: new Set(),
          amostraMensagens: new Set(),
        };
        gruposMap.set(chave, grupo);
      }

      grupo.totalErros++;

      if (doc.codigoRegistro && grupo.codigosAfetados.size < 5) {
        grupo.codigosAfetados.add(String(doc.codigoRegistro));
      }

      if (Array.isArray(doc.mensagens)) {
        for (const m of doc.mensagens) {
          const txt = typeof m === "string" ? m : m?.texto;
          if (txt && grupo.amostraMensagens.size < 3) {
            grupo.amostraMensagens.add(String(txt).trim());
          }
        }
      }

      if (grupo.amostraMensagens.size < 3 && doc.requisicao?.retorno?.data) {
        const retStr =
          typeof doc.requisicao.retorno.data === "string"
            ? doc.requisicao.retorno.data
            : JSON.stringify(doc.requisicao.retorno.data).slice(0, 160);
        grupo.amostraMensagens.add(retStr);
      }
    }

    gruposErros = Array.from(gruposMap.values()).map((g) => ({
      layoutIntegracao: g.layoutIntegracao,
      tipoIntegracao: g.tipoIntegracao,
      totalErros: g.totalErros,
      codigosAfetados: Array.from(g.codigosAfetados),
      amostraMensagens: Array.from(g.amostraMensagens),
    }));

    for (const g of gruposErros) {
      for (const msg of g.amostraMensagens) {
        if (amostraMensagens.length < 5) {
          amostraMensagens.push(`[${g.layoutIntegracao} | ${g.tipoIntegracao}] ${msg}`);
        }
      }
    }
  } else {
    // Fallback legado para coleções logs_erros e erros
    const legacyQuery = {
      entidade: targetObjectId,
      $or: [
        { data: { $gte: duasHorasAtras } },
        { timestamp: { $gte: duasHorasAtras } },
      ],
    };

    const [countLogsErros, countErros, amostraLogs, amostraErros] = await Promise.all([
      db.collection("logs_erros").countDocuments(legacyQuery),
      db.collection("erros").countDocuments(legacyQuery),
      db.collection("logs_erros").find(legacyQuery).sort({ data: -1, timestamp: -1 }).limit(3).toArray(),
      db.collection("erros").find(legacyQuery).sort({ data: -1, timestamp: -1 }).limit(3).toArray(),
    ]);

    totalErrosUltimas2h = countLogsErros + countErros;
    amostraMensagens = [...amostraLogs, ...amostraErros]
      .slice(0, 3)
      .map((e) => e.mensagem || e.status || e.error || "Erro registrado sem detalhe");
  }

  const resultadoSaude = {
    entidadeId,
    nomeEntidade,
    janelaAuditoria: {
      inatividadeEmDias: limiteDias,
      errosEmHoras: 2,
    },
    usuarios: {
      totalCadastrados: totalUsuariosCadastrados,
      ativosNoPeriodo: usuariosAtivos.length,
      totalInativos: usuariosInativos.length,
      amostraInativos: usuariosInativos.slice(0, 5),
    },
    telemetriaErros: {
      errosRecentes2h: totalErrosUltimas2h,
      amostraErros: amostraMensagens,
      gruposErros,
      tiposMonitoradosFiltrados: tiposAtivos,
    },
  };

  console.log(
    `📈 [Tool Result: checkTenantHealth] "${nomeEntidade}": ${totalErrosUltimas2h} erros (2h) | Grupos: ${gruposErros.length} | ${usuariosAtivos.length}/${totalUsuariosCadastrados} ativos (${limiteDias}d)`
  );

  return resultadoSaude;
}

/**
 * FERRAMENTA 3: sendCSAlert({ entidadeId, entidadeNome, csEmail, csName, tipoRisco, motivo, acaoRecomendada })
 * - Exibe no console formatado
 * - Salva/atualiza o alerta na collection 'cs_alerts_history' do Firestore com deduplicação
 * - Envia POST para CS_WEBHOOK_URL se configurada no .env
 */
async function sendCSAlert({ entidadeId, entidadeNome, csEmail, csName, tipoRisco, motivo, acaoRecomendada }) {
  console.log("\n🚨 ============================================================");
  console.log(`🚨 [DISPARO DE ALERTA CS] - TIPO: [${tipoRisco}]`);
  console.log("🚨 ============================================================");
  console.log(`🏢 Entidade:             ${entidadeNome} (ID: ${entidadeId || "N/A"})`);
  console.log(`👤 CS Responsável:       ${csName} <${csEmail}>`);
  console.log(`⚠️ Tipo de Risco:        ${tipoRisco}`);
  console.log(`📝 Motivo / Diagnóstico: ${motivo}`);
  console.log(`🎯 Ação Recomendada:     ${acaoRecomendada}`);
  console.log(`⏰ Timestamp:            ${new Date().toISOString()}`);

  const alertPayload = {
    entidadeId: entidadeId || (entidadeNome ? String(entidadeNome).toLowerCase().replace(/[^a-z0-9]/g, "_") : "entidade"),
    entidadeNome,
    csEmail,
    csName,
    tipoRisco,
    motivo,
    acaoRecomendada,
    status: "ativo",
    disparadoEm: new Date().toISOString(),
    origem: "cs-agent-sentinel",
  };

  // 1. Salvar no Firestore (collection 'cs_alerts_history') com deduplicação determinística
  let firestoreDocId = null;
  try {
    firestoreDocId = await saveCSAlertToFirestore(alertPayload);
  } catch (err) {
    console.warn("⚠️ Não foi possível salvar alerta no Firestore:", err.message);
  }

  // 2. Disparo de Webhook se configurado
  let webhookEnviado = false;
  let webhookDetalhe = "não configurado";

  if (CS_WEBHOOK_URL) {
    try {
      console.log(`🌐 Enviando alerta via webhook para: ${CS_WEBHOOK_URL}...`);
      const resp = await fetch(CS_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(alertPayload),
      });

      if (resp.ok) {
        webhookEnviado = true;
        webhookDetalhe = `sucesso (HTTP ${resp.status})`;
        console.log(`✅ Webhook enviado com sucesso! Status: ${resp.status}`);
      } else {
        webhookDetalhe = `falha (HTTP ${resp.status})`;
        console.error(`❌ Webhook retornou status: ${resp.status}`);
      }
    } catch (whErr) {
      webhookDetalhe = `erro de conexão: ${whErr.message}`;
      console.error(`❌ Erro de conexão com webhook: ${whErr.message}`);
    }
  } else {
    console.log("ℹ️ CS_WEBHOOK_URL não configurada no .env. Alerta registrado no Firestore e console.");
  }

  console.log("============================================================\n");

  return {
    status: "SUCESSO",
    entidadeId: alertPayload.entidadeId,
    entidadeNome,
    tipoRisco,
    firestoreDocId,
    webhookEnviado,
    webhookDetalhe,
    timestamp: alertPayload.disparadoEm,
  };
}

/**
 * FERRAMENTA 4: resolveTenantAlerts({ entidadeId, motivo })
 * Marca alertas anteriores como resolvidos quando a conta for avaliada como saudável.
 */
async function resolveTenantAlerts({ entidadeId, motivo }) {
  console.log(`\n✅ [RESOLUÇÃO PREVENTIVA] Marcando alertas anteriores de '${entidadeId}' como resolvidos...`);
  const total = await resolveTenantAlertsInFirestore(entidadeId, motivo || "Entidade saudável na última auditoria");
  return {
    status: "RESOLVED",
    entidadeId,
    totalResolvidos: total,
  };
}

// ============================================================================
// 3. DECLARAÇÃO DAS FERRAMENTAS PARA O GEMINI (FUNCTION CALLING SCHEMAS)
// ============================================================================
const toolsDeclarations = [
  {
    functionDeclarations: [
      {
        name: "getMonitoredTenants",
        description:
          "Busca no Firebase Firestore a lista de entidades ativas cadastradas pelo time de Customer Success para auditoria, incluindo os limites de tolerância (thresholds) e o CS responsável.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
          required: [],
        },
      },
      {
        name: "checkTenantHealth",
        description:
          "Consulta a telemetria e erros de integração no MongoDB para uma entidade específica (converte entidadeId para ObjectId). Consulta a collection 'errosintegracoes' com status='pendente' e janela de 2h, filtrando opcionalmente pelos tiposMonitorados configurados no Firestore. Agrupa os erros por canal (layoutIntegracao) e tipo (tipoIntegracao), retornando padrões repetitivos, códigos afetados e mensagens de erro.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            entidadeId: {
              type: SchemaType.STRING,
              description: "String hexadecimal do _id da entidade no MongoDB (ex.: '6a8ec64f20c8700f6efcdab2').",
            },
            diasSemAcesso: {
              type: SchemaType.NUMBER,
              description:
                "Janela em dias para considerar inatividade (padrão 7 ou o valor de diasSemAcessoAlerta configurado nos thresholds da entidade).",
            },
            tiposMonitorados: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
              description:
                "Lista de tipos de integração configurados no threshold da entidade para filtrar os erros (ex: ['anuncio', 'pedido', 'estoque']). Se vazio ou omitido, audita todos os tipos.",
            },
          },
          required: ["entidadeId"],
        },
      },
      {
        name: "sendCSAlert",
        description:
          "Dispara um alerta preventivo de CS quando anomalias operacionais ou riscos de churn são detectados. Registra o alerta no Firestore e realiza POST no webhook corporativo.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            entidadeId: {
              type: SchemaType.STRING,
              description: "ID único da entidade no MongoDB.",
            },
            entidadeNome: {
              type: SchemaType.STRING,
              description: "Nome visual da empresa/entidade auditada.",
            },
            csEmail: {
              type: SchemaType.STRING,
              description: "E-mail do Customer Success Manager responsável.",
            },
            csName: {
              type: SchemaType.STRING,
              description: "Nome do Customer Success Manager responsável.",
            },
            tipoRisco: {
              type: SchemaType.STRING,
              description:
                "Tipo do risco: 'RISCO OPERACIONAL DE INTEGRAÇÃO', 'RISCO TECNICO CRITICO' ou 'RISCO DE CHURN / DESENGAJAMENTO'.",
            },
            motivo: {
              type: SchemaType.STRING,
              description:
                "Diagnóstico executivo de negócio indicando o canal (layoutIntegracao), o tipo de integração, o volume de registros afetados e o padrão das mensagens de falha.",
            },
            acaoRecomendada: {
              type: SchemaType.STRING,
              description:
                "Estratégia prescritiva de CS: Impacto comercial direto + Roteiro de contato preventivo pronto para o CS abordar o cliente antes que o cliente abra um chamado.",
            },
          },
          required: ["entidadeNome", "csEmail", "csName", "tipoRisco", "motivo", "acaoRecomendada"],
        },
      },
      {
        name: "resolveTenantAlerts",
        description:
          "Marca alertas anteriores de uma entidade como resolvidos no Firestore quando a conta for auditada como saudável.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            entidadeId: {
              type: SchemaType.STRING,
              description: "ID da entidade no MongoDB.",
            },
            motivo: {
              type: SchemaType.STRING,
              description: "Motivo da resolução (ex: 'Operação sem falhas recentes').",
            },
          },
          required: ["entidadeId"],
        },
      },
    ],
  },
];

// ============================================================================
// 4. MAPEAMENTO DE EXECUÇÃO DAS TOOLS
// ============================================================================
async function executeTool(name, args) {
  switch (name) {
    case "getMonitoredTenants":
      return await getMonitoredTenants();
    case "checkTenantHealth":
      return await checkTenantHealth(args);
    case "sendCSAlert":
      return await sendCSAlert(args);
    case "resolveTenantAlerts":
      return await resolveTenantAlerts(args);
    default:
      throw new Error(`Ferramenta desconhecida solicitada pelo modelo: "${name}"`);
  }
}

/**
 * Extração resiliente de texto gerado pelo modelo
 */
function extractResponseText(candidateResponse) {
  try {
    return candidateResponse.text();
  } catch {
    const parts = candidateResponse.candidates?.[0]?.content?.parts || [];
    return parts
      .filter((p) => typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
}

// ============================================================================
// 5. INSTRUÇÕES DO SISTEMA E LOOP AUTÔNOMO
// ============================================================================
const SYSTEM_INSTRUCTION = `
Você é o Agente Sentinela de Customer Success (CS) Preventivo e Observabilidade de Negócios da Kenit.
Sua missão é atuar proativamente na retenção de clientes e prevenção de cancelamentos (churn), auditando métricas e falhas de integrações de e-commerce/marketplaces em tempo real para antecipar crises ANTES que o cliente perceba ou abra um chamado de suporte.

DIRETRIZ CENTRAL DE ATUAÇÃO (FOCO EM CS E NEGÓCIO):
- Você NÃO precisa resolver o problema técnico no código nem tentar consertar APIs/bancos.
- SEU FOCO É PURAMENTE ANALÍTICO E PRESCRITIVO DE CUSTOMER SUCCESS:
  1. Analisar o conjunto de falhas na collection 'errosintegracoes'.
  2. Identificar o canal/integração afetado ('layoutIntegracao', ex: VTEX, Mercado Livre, Shopee, Magalu) e o tipo ('tipoIntegracao', ex: Anúncio, Pedido, Estoque, Preço).
  3. Reconhecer padrões recorrentes: identificar se a mesma mensagem de falha (ex: "Dados inconsistentes no cadastro de EAN", "Token expirado", "Preço divergente") está se repetindo em múltiplos produtos, pedidos ou anúncios (verificando 'codigosAfetados' e as mensagens de erro).
  4. Traduzir a falha técnica em IMPACTO COMERCIAL real para o lojista (ex: "Os anúncios da VTEX estão travados devido a divergência no cadastro de EAN, impedindo a sincronização e geração de vendas").
  5. Formular um ROTEIRO DE CONTATO PREVENTIVO pronto para o CS contatar o cliente antes que o cliente abra um chamado, demonstrando domínio proativo da operação.

FLUXO OPERACIONAL OBRIGATÓRIO:
1. Comece chamando a ferramenta 'getMonitoredTenants()' para obter as empresas cadastradas no Firestore pelo time de CS.
2. Para CADA entidade retornada:
   - Extraia o 'entidadeId', 'nome', os dados do CS responsável ('assignedCS') e os 'thresholds' (incluindo 'maxErros2h', 'diasSemAcessoAlerta' e 'tiposMonitorados').
   - Execute a ferramenta 'checkTenantHealth' passando:
     * 'entidadeId': o ID da entidade no MongoDB.
     * 'diasSemAcesso': valor de diasSemAcessoAlerta (padrão 7).
     * 'tiposMonitorados': o array thresholds.tiposMonitorados configurado para a entidade (se não houver tipos selecionados, passe vazio ou omita para monitorar todos).
3. AVALIAÇÃO DE RISCO E DISPARO DE ALERTAS:
   - REGRA 1 (Instabilidade Operacional / Erros em Integrações):
     Se a contagem de erros recentes nas últimas 2h (errosRecentes2h) for maior que 'thresholds.maxErros2h' (ou se houver grupo crítico de erros com padrões repetitivos):
     Dispare IMEDIATAMENTE a ferramenta 'sendCSAlert' com:
       - tipoRisco: 'RISCO OPERACIONAL DE INTEGRAÇÃO'
       - motivo: Diagnóstico executivo identificando o canal (layoutIntegracao, ex: VTEX), o tipo de integração (tipoIntegracao, ex: anúncio), volume de itens afetados e o padrão da mensagem principal.
       - acaoRecomendada:
         * Impacto Comercial: Explicação em linguagem de negócios sobre o prejuízo ou travamento das vendas do cliente.
         * Roteiro Prescritivo de Contato: Mensagem pronta para o CS abordar o cliente proativamente (ex: "Olá [Cliente], identificamos preventivamente que X anúncios na VTEX estão pausados por inconsistência de EAN...").
   
   - REGRA 2 (Risco de Churn / Desengajamento):
     Se 'usuariosAtivosNoPeriodo == 0' ou adesão drasticamente baixa nos últimos dias:
     Dispare IMEDIATAMENTE a ferramenta 'sendCSAlert' com:
       - tipoRisco: 'RISCO DE CHURN / DESENGAJAMENTO'
       - motivo: Inatividade identificada no período.
       - acaoRecomendada: Roteiro empático de reengajamento para o CS agendar reunião de alinhamento de valor.
   
   - REGRA 3 (Cliente Saudável):
     Se a entidade não violar os limites operacionais e apresentar engajamento adequado:
     Execute a ferramenta 'resolveTenantAlerts' passando 'entidadeId' para marcar alertas anteriores pendentes como 'resolvido' no Firestore.
     Registre como saudável para o relatório final.

DIRETRIZES DE COMUNICAÇÃO:
- Sempre se refira à empresa pelo campo 'nome' para facilitar a identificação humana.
- Ao final de todas as auditorias, elabore um Relatório Executivo Consolidado com resumo das contas analisadas, canais afetados, alertas emitidos e próximos passos.
`;

/**
 * Detecta se o erro retornado pela API do Gemini é transitório e passível de retry
 * (503 Service Unavailable, 429 Too Many Requests, alta demanda temporária, etc.)
 */
function isRetryableError(error) {
  if (!error) return false;

  const status = error.status || error.statusCode || error.response?.status;
  if (status === 503 || status === 429 || status === 500 || status === 502 || status === 504) {
    return true;
  }

  const msg = `${error.message || ""} ${error.statusText || ""}`.toLowerCase();
  const retryPatterns = [
    "503",
    "429",
    "service unavailable",
    "high demand",
    "resourceexhausted",
    "resource_exhausted",
    "too many requests",
    "rate limit",
    "temporarily unavailable",
    "overloaded",
  ];

  return retryPatterns.some((pattern) => msg.includes(pattern));
}

/**
 * Função auxiliar que envolve chat.sendMessage com retentativas automáticas e backoff exponencial.
 */
async function sendMessageWithRetry(chat, message, maxRetries = 4, delayMs = 3000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await chat.sendMessage(message);
    } catch (error) {
      const isRetryable = isRetryableError(error);
      const isLastAttempt = attempt === maxRetries;

      if (!isRetryable || isLastAttempt) {
        console.error(`❌ [Gemini API] Falha definitiva na tentativa ${attempt}/${maxRetries}:`, error.message);
        throw error;
      }

      const currentDelay = delayMs * Math.pow(2, attempt - 1);
      console.warn(
        `⚠️ [Gemini API] Instabilidade ou pico de demanda temporário detectado (${error.status || "503/429"}: ${error.statusText || error.message.slice(0, 100)}).`
      );
      console.warn(
        `⏳ [Tentativa ${attempt}/${maxRetries}] Aguardando ${(currentDelay / 1000).toFixed(1)}s antes de tentar novamente...`
      );

      await new Promise((resolve) => setTimeout(resolve, currentDelay));
    }
  }
}

async function runCustomerSuccessAgent() {
  console.log("============================================================");
  console.log("🛡️ INICIANDO AGENTE AUTÔNOMO DE CS PREVENTIVO (FIREBASE + MONGODB)");
  console.log(`🤖 Modelo: ${GEMINI_MODEL}`);
  console.log("============================================================\n");

  await connectToDatabase();

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: SYSTEM_INSTRUCTION,
    tools: toolsDeclarations,
  });

  const chat = model.startChat();

  const promptInicial =
    "Inicie a auditoria preventiva de Customer Success. Consulte as entidades monitoradas ativas no Firebase, " +
    "analise a telemetria de cada uma no MongoDB e dispare os alertas prescritivos para qualquer anomalia técnica ou risco de churn.";

  console.log(`👤 [Comando Inicial]: "${promptInicial}"\n`);
  let response = await sendMessageWithRetry(chat, promptInicial);

  let stepCount = 1;
  const MAX_AGENT_STEPS = 30;

  // Loop autônomo de Function Calling
  while (stepCount <= MAX_AGENT_STEPS) {
    const candidate = response.response;
    const functionCalls = candidate.functionCalls();

    if (!functionCalls || functionCalls.length === 0) {
      console.log("\n🏁 O Agente concluiu todas as análises e finalizou o plano de ação.");
      break;
    }

    console.log(`\n🔄 [Turno ${stepCount}] O modelo requisitou ${functionCalls.length} chamada(s) de ferramenta:`);

    const functionResponses = [];

    for (const call of functionCalls) {
      const { name, args } = call;
      console.log(`   ⚙️ Executando: ${name}(${JSON.stringify(args)})`);

      let toolResult;
      try {
        toolResult = await executeTool(name, args);
      } catch (err) {
        console.error(`   ❌ Falha ao executar tool ${name}:`, err.message);
        toolResult = { error: err.message };
      }

      functionResponses.push({
        functionResponse: {
          name,
          response: toolResult,
        },
      });
    }

    console.log(`📤 Enviando respostas das ferramentas de volta ao modelo...`);
    response = await sendMessageWithRetry(chat, functionResponses);
    stepCount++;
  }

  if (stepCount > MAX_AGENT_STEPS) {
    console.warn("⚠️ Limite máximo de turnos atingido para a segurança do agente.");
  }

  // Apresentação do Relatório Executivo Final
  const finalSummary = extractResponseText(response.response);
  console.log("\n============================================================");
  console.log("📊 RELATÓRIO EXECUTIVO FINAL DO AGENTE SENTINELA DE CS");
  console.log("============================================================");
  console.log(finalSummary || "Auditoria concluída com sucesso.");
  console.log("============================================================\n");
}

export { runCustomerSuccessAgent as runCustomerSuccessAudit };

// Execução direta via CLI se chamado diretamente
if (process.argv[1]?.endsWith("agent.mjs")) {
  runCustomerSuccessAgent()
    .catch((err) => {
      console.error("💥 Erro fatal na execução do agente:", err);
    })
    .finally(async () => {
      await mongoClient.close();
      console.log("🔌 [MongoDB] Conexão encerrada com segurança.");
    });
}
