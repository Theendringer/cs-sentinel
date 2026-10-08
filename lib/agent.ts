import { GoogleGenerativeAI, SchemaType, ChatSession } from "@google/generative-ai";
import {
  getActiveMonitoredTenants,
  saveCSAlert,
  resolveTenantAlerts,
  MonitoredTenant,
  CSUserFilter,
} from "./firebase-admin";
import { checkTenantHealthMetrics } from "./mongodb";
import { sendPrescriptiveAlertEmail } from "./mailer";

// Compatibilidade do SDK @google/generative-ai com Gemini 3.8 / 3.5
// Garante que mensagens de functionResponse não usem o papel depreciado 'function'
const originalSendMessage = ChatSession.prototype.sendMessage;
ChatSession.prototype.sendMessage = async function (request: any, requestOptions: any = {}) {
  if (this._history) {
    for (const item of this._history) {
      if (item && item.role === "function") {
        item.role = "user";
      }
    }
  }
  const result = await originalSendMessage.call(this, request, requestOptions);
  if (this._history) {
    for (const item of this._history) {
      if (item && item.role === "function") {
        item.role = "user";
      }
    }
  }
  return result;
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const CS_WEBHOOK_URL = process.env.CS_WEBHOOK_URL || null;

/**
 * Detecta se o erro retornado pela API do Gemini é passível de retry
 */
function isRetryableError(error: any): boolean {
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
 * Função auxiliar de envio com backoff exponencial
 */
async function sendMessageWithRetry(
  chat: any,
  message: any,
  maxRetries = 4,
  delayMs = 3000,
  logFn?: (msg: string) => void
): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await chat.sendMessage(message);
    } catch (error: any) {
      const isRetryable = isRetryableError(error);
      const isLastAttempt = attempt === maxRetries;

      if (!isRetryable || isLastAttempt) {
        if (logFn) logFn(`❌ [Gemini API] Falha na tentativa ${attempt}/${maxRetries}: ${error.message}`);
        throw error;
      }

      const currentDelay = delayMs * Math.pow(2, attempt - 1);
      if (logFn) {
        logFn(
          `⚠️ [Gemini API] Instabilidade temporária (${error.status || "503/429"}). Aguardando ${currentDelay}ms para tentativa ${attempt + 1}/${maxRetries}...`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, currentDelay));
    }
  }
}

/**
 * Declaração das ferramentas (Function Calling)
 */
const toolsDeclarations: any[] = [
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
          "Dispara um alerta preventivo de CS quando anomalias operacionais ou riscos de churn são detectados. Persiste/atualiza o alerta no Firestore com chave única por entidade/risco, dispara notificação por e-mail para o CS e envia webhook.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            entidadeId: {
              type: SchemaType.STRING,
              description: "String hexadecimal do _id da entidade no MongoDB (ex.: '6a8ec64f20c8700f6efcdab2').",
            },
            entidadeNome: {
              type: SchemaType.STRING,
              description: "Nome visual da empresa/entidade.",
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
                "Tipo de risco: 'RISCO OPERACIONAL DE INTEGRAÇÃO', 'RISCO TECNICO CRITICO' ou 'RISCO DE CHURN / DESENGAJAMENTO'.",
            },
            motivo: {
              type: SchemaType.STRING,
              description: "Diagnóstico em linguagem de negócios indicando o canal (layoutIntegracao), tipo de falha, volume e padrão detectado.",
            },
            acaoRecomendada: {
              type: SchemaType.STRING,
              description: "Estratégia prescritiva de CS: Impacto comercial direto + Roteiro de contato preventivo pronto para o CS contatar o cliente antes da abertura de chamados.",
            },
          },
          required: ["entidadeNome", "csEmail", "csName", "tipoRisco", "motivo", "acaoRecomendada"],
        },
      },
      {
        name: "resolveTenantAlerts",
        description:
          "Se a entidade estiver saudável (sem falhas críticas de integração e com engajamento de usuários normal), marca os alertas anteriores em aberto como 'resolvido' no Firestore.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            entidadeId: {
              type: SchemaType.STRING,
              description: "ID da entidade no MongoDB.",
            },
            entidadeNome: {
              type: SchemaType.STRING,
              description: "Nome visual da empresa/entidade.",
            },
            motivo: {
              type: SchemaType.STRING,
              description: "Motivo da resolução (ex: 'Operação sem falhas recentes e adesão estável').",
            },
          },
          required: ["entidadeId"],
        },
      },
    ],
  },
];

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
   - Extraia 'entidadeId', 'nome', os dados do CS responsável ('assignedCS') e os 'thresholds' (incluindo 'maxErros2h', 'diasSemAcessoAlerta' e 'tiposMonitorados').
   - Execute a ferramenta 'checkTenantHealth' passando:
     * 'entidadeId': o ID da entidade no MongoDB.
     * 'diasSemAcesso': valor de diasSemAcessoAlerta (padrão 7).
     * 'tiposMonitorados': o array thresholds.tiposMonitorados configurado para a entidade (se não houver tipos selecionados, passe vazio ou omita para monitorar todos).
3. AVALIAÇÃO DE RISCO E DISPARO DE ALERTAS:
   - REGRA 1 (Instabilidade Operacional / Erros em Integrações):
     Se a contagem de erros recentes nas últimas 2h (errosRecentesUltimas2h) for maior que 'thresholds.maxErros2h' (ou se houver grupo crítico de erros com padrões repetitivos):
     Dispare IMEDIATAMENTE a ferramenta 'sendCSAlert' passando 'entidadeId', 'entidadeNome', dados do CS e:
       - tipoRisco: 'RISCO OPERACIONAL DE INTEGRAÇÃO'
       - motivo: Diagnóstico executivo identificando o canal (layoutIntegracao, ex: VTEX), o tipo de integração (tipoIntegracao, ex: anúncio), volume de itens afetados e o padrão da mensagem principal.
       - acaoRecomendada:
         * Impacto Comercial: Explicação em linguagem de negócios sobre o prejuízo ou travamento das vendas do cliente.
         * Roteiro Prescritivo de Contato: Mensagem pronta para o CS abordar o cliente proativamente.
   
   - REGRA 2 (Risco de Churn / Desengajamento):
     Se 'usuariosAtivosNoPeriodo == 0' ou adesão drasticamente baixa nos últimos dias:
     Dispare IMEDIATAMENTE a ferramenta 'sendCSAlert' passando 'entidadeId', 'entidadeNome', dados do CS e:
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

export interface AuditExecutionResult {
  success: boolean;
  timestamp: string;
  model: string;
  totalEntitiesAudited: number;
  totalAlertsDispatched: number;
  alertsDispatched: any[];
  executiveReport: string;
  logs: string[];
}

/**
 * Função executável principal para rodar a auditoria completa de Customer Success.
 * Pode ser chamada via CLI, por Route Handler de API Next.js ou Cron de automação.
 */
export async function runCustomerSuccessAudit(
  csFilter?: CSUserFilter
): Promise<AuditExecutionResult> {
  const executionLogs: string[] = [];
  const log = (msg: string) => {
    executionLogs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    console.log(msg);
  };

  const analystContext = csFilter?.name
    ? ` para a carteira do analista de CS ${csFilter.name} (${csFilter.email || csFilter.uid || ""})`
    : "";
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Chave GEMINI_API_KEY não configurada nas variáveis de ambiente da Vercel."
    );
  }

  // Garante que o modelo utilizado seja estável e rápido (gemini-3.5-flash-lite ou o configurado em GEMINI_MODEL)
  let modelName = (process.env.GEMINI_MODEL || GEMINI_MODEL || "gemini-3.5-flash-lite").trim();
  if (!modelName || modelName === "gemini-2.5-flash") {
    // Caso gemini-2.5-flash esteja depreciado para novas contas na API do Google Studio, utiliza gemini-3.5-flash-lite
    modelName = "gemini-3.5-flash-lite";
  }

  log(`🚀 Iniciando Auditoria Preventiva de CS${analystContext}. Modelo: ${modelName}`);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_INSTRUCTION,
    tools: toolsDeclarations,
  });

  const chat = model.startChat();
  const promptInicial =
    `Inicie a auditoria preventiva de Customer Success${analystContext}. Consulte as entidades monitoradas ativas no Firebase, ` +
    "analise a telemetria de cada uma no MongoDB, deduplique alertas no Firestore e emita notificações prescritivas por e-mail para os analistas de CS.";

  log(`👤 [Comando]: "${promptInicial}"`);
  let response = await sendMessageWithRetry(chat, promptInicial, 4, 3000, log);

  let stepCount = 1;
  const MAX_AGENT_STEPS = 25;
  const dispatchedAlerts: any[] = [];
  let auditedEntitiesCount = 0;
  let loadedTenants: MonitoredTenant[] = [];
  const tenantsWithDispatchedAlerts = new Set<string>();
  const tenantsAuditedHealthy = new Set<string>();

  while (stepCount <= MAX_AGENT_STEPS) {
    const candidate = response.response;
    const functionCalls = candidate.functionCalls();

    if (!functionCalls || functionCalls.length === 0) {
      log("🏁 O Agente concluiu todas as auditorias e finalizou o plano de ação.");
      break;
    }

    log(`🔄 [Turno ${stepCount}] O modelo requisitou ${functionCalls.length} chamada(s) de ferramenta:`);
    const functionResponses: any[] = [];

    for (const call of functionCalls) {
      const { name, args } = call;
      log(`   ⚙️ Executando Tool: ${name}(${JSON.stringify(args)})`);

      let toolResult: any;

      try {
        if (name === "getMonitoredTenants") {
          const tenants = await getActiveMonitoredTenants(csFilter);
          loadedTenants = tenants;
          auditedEntitiesCount = tenants.length;
          toolResult = { total: tenants.length, monitoredTenants: tenants };
          log(
            `   📋 ${tenants.length} entidade(s) ativa(s) carregada(s) do Firestore${
              csFilter ? ` (Carteira: ${csFilter.email || csFilter.name || csFilter.uid})` : ""
            }.`
          );
        } else if (name === "checkTenantHealth") {
          const { entidadeId, diasSemAcesso, tiposMonitorados } = args as any;
          const rawHealth = (await checkTenantHealthMetrics(entidadeId, diasSemAcesso, tiposMonitorados)) as any;
          log(`   📊 Telemetria processada para ${rawHealth.nomeEntidade || entidadeId}`);

          // Avalia se métricas estão em patamar saudável
          const tenantConfig = loadedTenants.find((t) => t.entidadeId === entidadeId);
          const maxErros = tenantConfig?.thresholds.maxErros2h ?? 5;
          const errosRecentes = rawHealth.errosRecentesUltimas2h ?? 0;
          const usuariosAtivos = rawHealth.usuariosAtivosNoPeriodo ?? 0;

          if (errosRecentes <= maxErros && usuariosAtivos > 0) {
            tenantsAuditedHealthy.add(entidadeId);
          }

          // Envia resumo estruturado e enxuto para a IA não estourar tokens/tempo
          toolResult = {
            entidadeId: rawHealth.entidadeId || entidadeId,
            nomeEntidade: rawHealth.nomeEntidade,
            totalUsuariosCadastrados: rawHealth.totalUsuariosCadastrados,
            usuariosAtivosNoPeriodo: rawHealth.usuariosAtivosNoPeriodo,
            totalUsuariosInativos: rawHealth.totalUsuariosInativos,
            errosRecentesUltimas2h: rawHealth.errosRecentesUltimas2h,
            resumoErrosPorCanal: (rawHealth.gruposErros || []).map((g: any) => ({
              canal: g.layoutIntegracao,
              tipo: g.tipoIntegracao,
              totalErros: g.totalErros,
              amostraMensagens: g.amostraMensagens?.slice(0, 2) || [],
            })),
            amostraMensagens: (rawHealth.amostraErros || []).slice(0, 3),
            periodoDiasAnalise: rawHealth.periodoDiasAnalise,
          };
        } else if (name === "sendCSAlert") {
          const {
            entidadeId: argEntidadeId,
            entidadeNome,
            csEmail,
            csName,
            tipoRisco,
            motivo,
            acaoRecomendada,
          } = args as any;

          // Resolve o entidadeId correspondente
          const matchedTenant = loadedTenants.find(
            (t) =>
              t.entidadeId === argEntidadeId ||
              t.nome.toLowerCase() === (entidadeNome || "").toLowerCase()
          );
          const resolvedEntidadeId =
            argEntidadeId ||
            matchedTenant?.entidadeId ||
            (entidadeNome ? entidadeNome.toLowerCase().replace(/[^a-z0-9]/g, "_") : "entidade");

          tenantsWithDispatchedAlerts.add(resolvedEntidadeId);
          tenantsAuditedHealthy.delete(resolvedEntidadeId);

          const targetCsUid = csFilter?.uid || matchedTenant?.assignedCS?.uid;
          const targetCsEmail =
            csEmail || csFilter?.email || matchedTenant?.assignedCS?.email || "cs@kenit.com.br";
          const targetCsName =
            csName || csFilter?.name || matchedTenant?.assignedCS?.name || "Time de CS";

          const alertPayload = {
            entidadeId: resolvedEntidadeId,
            entidadeNome,
            csUid: targetCsUid,
            csEmail: targetCsEmail,
            csName: targetCsName,
            assignedCS: {
              uid: targetCsUid,
              name: targetCsName,
              email: targetCsEmail,
            },
            tipoRisco,
            motivo,
            acaoRecomendada,
            status: "ativo" as const,
            disparadoEm: new Date().toISOString(),
            origem: "cs-agent-sentinel",
          };

          // Salva/Atualiza no Firestore com chave única determinística
          const docId = await saveCSAlert(alertPayload, targetCsUid);
          dispatchedAlerts.push({ ...alertPayload, id: docId });
          log(`   🚨 ALERTA [${tipoRisco}] para "${entidadeNome}" registrado (Upsert doc: ${docId})`);

          // Envio automático do E-mail Prescritivo para o analista de CS responsável
          try {
            const emailResult = await sendPrescriptiveAlertEmail({
              to: alertPayload.csEmail,
              csName: alertPayload.csName,
              entidadeNome: alertPayload.entidadeNome,
              tipoRisco: alertPayload.tipoRisco,
              motivo: alertPayload.motivo,
              acaoRecomendada: alertPayload.acaoRecomendada,
            });
            log(
              `   ✉️ E-mail prescritivo processado para ${alertPayload.csEmail} (provedor: ${emailResult.provider}, id: ${emailResult.messageId || "ok"})`
            );
          } catch (mailErr: any) {
            log(`   ⚠️ Erro ao enviar e-mail prescritivo: ${mailErr.message}`);
          }

          // Disparo de Webhook opcional corporativo
          if (CS_WEBHOOK_URL) {
            try {
              await fetch(CS_WEBHOOK_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(alertPayload),
              });
              log(`   🌐 Webhook corporativo disparado com sucesso.`);
            } catch (err: any) {
              log(`   ⚠️ Erro no webhook corporativo: ${err.message}`);
            }
          }

          toolResult = {
            status: "DISPATCHED_OR_UPDATED",
            entidadeId: resolvedEntidadeId,
            entidadeNome,
            tipoRisco,
            firestoreDocId: docId,
            timestamp: alertPayload.disparadoEm,
          };
        } else if (name === "resolveTenantAlerts") {
          const { entidadeId: argEntidadeId, motivo } = args as any;
          const targetCsUid = csFilter?.uid;
          const resolvedCount = await resolveTenantAlerts(
            argEntidadeId,
            motivo || "Conta saudável na última auditoria",
            targetCsUid
          );
          log(`   ✅ Alertas anteriores da entidade '${argEntidadeId}' resolvidos (${resolvedCount} documento(s)).`);
          toolResult = {
            status: "RESOLVED",
            entidadeId: argEntidadeId,
            resolvedCount,
          };
        } else {
          toolResult = { error: `Ferramenta desconhecida: ${name}` };
        }
      } catch (err: any) {
        log(`   ❌ Erro ao executar ${name}: ${err.message}`);
        toolResult = { error: err.message };
      }

      functionResponses.push({
        functionResponse: {
          name,
          response: toolResult,
        },
      });
    }

    log(`📤 Enviando respostas de volta ao modelo Gemini...`);
    response = await sendMessageWithRetry(chat, functionResponses, 4, 3000, log);
    stepCount++;
  }

  // Resolução pós-auditoria para qualquer entidade saudável que não teve novos alertas
  for (const tenantId of tenantsAuditedHealthy) {
    if (!tenantsWithDispatchedAlerts.has(tenantId)) {
      await resolveTenantAlerts(
        tenantId,
        "Auditoria concluiu que a conta está saudável (sem falhas críticas e com engajamento normal).",
        csFilter?.uid
      );
    }
  }

  let finalReport = "";
  try {
    finalReport = response.response.text();
  } catch {
    const parts = response.response.candidates?.[0]?.content?.parts || [];
    finalReport = parts
      .filter((p: any) => typeof p.text === "string")
      .map((p: any) => p.text)
      .join("\n");
  }

  log("📊 Relatório Executivo Final gerado com sucesso.");

  return {
    success: true,
    timestamp: new Date().toISOString(),
    model: modelName,
    totalEntitiesAudited: auditedEntitiesCount,
    totalAlertsDispatched: dispatchedAlerts.length,
    alertsDispatched: dispatchedAlerts,
    executiveReport: finalReport || "Auditoria concluída sem texto adicional.",
    logs: executionLogs,
  };
}
