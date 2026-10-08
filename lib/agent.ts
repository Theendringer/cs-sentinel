import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  getActiveMonitoredTenants,
  saveCSAlert,
  resolveTenantAlerts,
  MonitoredTenant,
  CSUserFilter,
} from "./firebase-admin";
import { checkTenantHealthMetrics } from "./mongodb";
import { sendPrescriptiveAlertEmail } from "./mailer";

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
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
 * Executa a chamada direta ao Gemini com retry exponencial e fallback de modelos estáveis
 */
async function generateDiagnosisWithRetry(
  genAI: GoogleGenerativeAI,
  preferredModel: string,
  prompt: string,
  logFn?: (msg: string) => void
): Promise<{ text: string; modelUsed: string }> {
  // Lista de modelos compatíveis e estáveis para tentar em ordem
  const modelsToTry = [
    preferredModel,
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-1.5-flash",
    "gemini-flash-latest",
  ];
  const uniqueModels = Array.from(new Set(modelsToTry.filter(Boolean)));

  let lastError: any = null;

  for (const modelName of uniqueModels) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: "application/json" },
      });

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await model.generateContent(prompt);
          return { text: res.response.text(), modelUsed: modelName };
        } catch (err: any) {
          const isRetryable = isRetryableError(err);
          if (isRetryable && attempt < 3) {
            const delay = 2000 * attempt;
            if (logFn) {
              logFn(
                `⚠️ [Gemini ${modelName}] Instabilidade temporária (${err.status || 503}). Aguardando ${delay}ms para tentativa ${attempt + 1}...`
              );
            }
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          throw err;
        }
      }
    } catch (err: any) {
      lastError = err;
      const is404 =
        err.status === 404 ||
        err.message?.includes("404") ||
        err.message?.includes("no longer available") ||
        err.message?.includes("not found");

      if (is404 && uniqueModels.indexOf(modelName) < uniqueModels.length - 1) {
        if (logFn) {
          logFn(`ℹ️ [Gemini API] Modelo '${modelName}' não disponível nesta conta. Tentando próximo modelo estável...`);
        }
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

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
 * 
 * Arquitetura Otimizada para Serverless (Vercel):
 * 1. Busca primeiro as entidades monitoradas no Firestore (isoladas pela carteira do CS).
 * 2. Consulta a telemetria e erros recentes (errosintegracoes) diretamente no MongoDB.
 * 3. Para contas com anomalias detectadas, faz chamada direta e atômica ao Gemini via generateContent
 *    com retorno em JSON estruturado, eliminando loops de function calling e prevenindo o erro de role 'function'.
 * 4. Persiste o alerta no Firestore ('cs_alerts_history'), dispara e-mail prescritivo e webhook.
 * 5. Resolve alertas de contas saudáveis e consolida o Relatório Executivo Final.
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

  const preferredModel = (process.env.GEMINI_MODEL || GEMINI_MODEL).trim();
  log(`🚀 Iniciando Auditoria Preventiva de CS${analystContext}. Modelo configurado: ${preferredModel}`);

  const genAI = new GoogleGenerativeAI(apiKey);

  // 1. Busca as entidades monitoradas ativas no Firestore
  log("📋 Consultando entidades monitoradas ativas no Firestore...");
  const monitoredTenants = await getActiveMonitoredTenants(csFilter);
  log(`✅ ${monitoredTenants.length} entidade(s) ativa(s) carregada(s) do Firestore.`);

  if (monitoredTenants.length === 0) {
    const emptyMsg = csFilter?.name
      ? `Nenhuma empresa ativa monitorada na carteira do analista ${csFilter.name}. Adicione contas no painel de monitoramento.`
      : "Nenhuma empresa ativa configurada para monitoramento no momento.";
    log(`ℹ️ ${emptyMsg}`);

    return {
      success: true,
      timestamp: new Date().toISOString(),
      model: preferredModel,
      totalEntitiesAudited: 0,
      totalAlertsDispatched: 0,
      alertsDispatched: [],
      executiveReport: `# Relatório Executivo Consolidado - Sentinel CS\n\n${emptyMsg}`,
      logs: executionLogs,
    };
  }

  const dispatchedAlerts: any[] = [];
  const healthyTenants: string[] = [];
  const riskyTenants: { nome: string; motivo: string; tipoRisco: string }[] = [];
  let finalModelUsed = preferredModel;

  // 2. Itera sobre cada entidade, avaliando telemetria e gerando diagnóstico
  for (const tenant of monitoredTenants) {
    log(`🔍 Auditando telemetria da conta: ${tenant.nome} (${tenant.entidadeId})...`);

    const diasInatividade = tenant.thresholds.diasSemAcessoAlerta || 7;
    const maxErrosPermitidos = tenant.thresholds.maxErros2h ?? 5;
    const tiposMonitorados = tenant.thresholds.tiposMonitorados || [];

    const rawHealth = (await checkTenantHealthMetrics(
      tenant.entidadeId,
      diasInatividade,
      tiposMonitorados
    )) as any;

    if (rawHealth.error) {
      log(`⚠️ [MongoDB] Erro ao consultar telemetria de ${tenant.nome}: ${rawHealth.error}`);
      continue;
    }

    const errosRecentes = rawHealth.errosRecentesUltimas2h ?? 0;
    const usuariosAtivos = rawHealth.usuariosAtivosNoPeriodo ?? 0;
    const totalUsuarios = rawHealth.totalUsuariosCadastrados ?? 0;

    log(
      `   📊 Métricas: ${errosRecentes} erros nas últimas 2h (limite: ${maxErrosPermitidos}) | ${usuariosAtivos}/${totalUsuarios} usuários ativos`
    );

    const temRiscoErros = errosRecentes > maxErrosPermitidos;
    const temRiscoChurn = totalUsuarios > 0 && usuariosAtivos === 0;

    // Cenário Saudável: erros dentro do limite e engajamento adequado
    if (!temRiscoErros && !temRiscoChurn) {
      healthyTenants.push(tenant.nome);
      log(`   ✅ Conta "${tenant.nome}" considerada saudável.`);

      // Resolve alertas anteriores no Firestore
      try {
        const resolvedCount = await resolveTenantAlerts(
          tenant.entidadeId,
          "Operação saudável e engajamento normal na última auditoria.",
          csFilter?.uid
        );
        if (resolvedCount > 0) {
          log(`   🔄 ${resolvedCount} alerta(s) anterior(es) marcado(s) como resolvido(s).`);
        }
      } catch (err: any) {
        log(`   ⚠️ Erro ao resolver alertas anteriores: ${err.message}`);
      }
      continue;
    }

    // Cenário de Risco Identificado: Aciona o Gemini para gerar diagnóstico prescritivo
    log(`   ⚠️ Risco detectado para "${tenant.nome}". Solicitando diagnóstico à IA...`);

    const resumoErros = (rawHealth.gruposErros || []).map((g: any) => ({
      canal: g.layoutIntegracao,
      tipo: g.tipoIntegracao,
      totalErros: g.totalErros,
      amostraMensagens: g.amostraMensagens?.slice(0, 3) || [],
      codigosAfetados: g.codigosAfetados?.slice(0, 5) || [],
    }));

    const dadosAuditoria = {
      empresa: tenant.nome,
      entidadeId: tenant.entidadeId,
      csResponsavel: tenant.assignedCS,
      limiteMaxErrosTolerados: maxErrosPermitidos,
      errosDetectadosUltimas2h: errosRecentes,
      totalUsuariosCadastrados: totalUsuarios,
      usuariosAtivos7d: usuariosAtivos,
      resumoGruposErros: resumoErros,
      amostraGeralMensagens: (rawHealth.amostraErros || []).slice(0, 5),
    };

    const prompt = `Você é o Sentinel IA, especialista em Customer Success e Observabilidade Preventiva da Kenit.
Analise os dados de telemetria e erros recentes de integração da empresa "${tenant.nome}":
${JSON.stringify(dadosAuditoria, null, 2)}

DIRETRIZES DE CS:
1. Identifique o padrão recorrente nos erros e os canais de integração impactados (ex: VTEX, Mercado Livre, Shopee).
2. Avalie o impacto comercial real para a operação do cliente.
3. Elabore um ROTEIRO DE CONTATO PREVENTIVO pronto para o analista de CS contatar o cliente antes que o cliente abra um chamado.

Retorne EXCLUSIVAMENTE um objeto JSON válido (sem tags markdown ou texto fora do JSON) com a estrutura:
{
  "nivelRisco": "baixo" | "medio" | "alto" | "critico",
  "tipoRisco": "RISCO OPERACIONAL DE INTEGRAÇÃO" | "RISCO DE CHURN / DESENGAJAMENTO" | "RISCO TECNICO CRITICO",
  "resumo": "Diagnóstico executivo claro indicando canal afetado, volume de falhas e padrão do erro",
  "estrategiaCS": "Roteiro prescritivo de abordagem empática e consultiva pronto para o analista de CS usar no contato",
  "sugestaoAcao": "Passos técnicos e operacionais recomendados para mitigar a crise"
}`;

    let aiDiagnosis: any = null;

    try {
      const { text, modelUsed } = await generateDiagnosisWithRetry(
        genAI,
        preferredModel,
        prompt,
        log
      );
      finalModelUsed = modelUsed;

      // Parse defensivo do JSON retornado pelo modelo
      try {
        aiDiagnosis = JSON.parse(text);
      } catch {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          aiDiagnosis = JSON.parse(jsonMatch[0]);
        }
      }
    } catch (aiErr: any) {
      log(`   ❌ Falha na chamada da IA para ${tenant.nome}: ${aiErr.message}`);
    }

    // Fallback estruturado caso a IA falhe ou JSON venha incompleto
    if (!aiDiagnosis) {
      aiDiagnosis = {
        nivelRisco: temRiscoErros ? "alto" : "medio",
        tipoRisco: temRiscoErros
          ? "RISCO OPERACIONAL DE INTEGRAÇÃO"
          : "RISCO DE CHURN / DESENGAJAMENTO",
        resumo: temRiscoErros
          ? `${errosRecentes} falhas recentes de integração detectadas nas últimas 2h para a empresa ${tenant.nome}.`
          : `Nenhum usuário ativo identificado nos últimos ${diasInatividade} dias para a empresa ${tenant.nome}.`,
        estrategiaCS:
          "Realizar contato imediato com o ponto focal para validar a estabilidade das operações e alinhar plano de mitigação.",
        sugestaoAcao:
          "Auditar logs das integrações pendentes e agendar reunião de alinhamento com a liderança do cliente.",
      };
    }

    const targetCsUid = csFilter?.uid || tenant.assignedCS?.uid;
    const targetCsEmail =
      csFilter?.email || tenant.assignedCS?.email || "cs@kenit.com.br";
    const targetCsName =
      csFilter?.name || tenant.assignedCS?.name || "Time de CS";

    const alertPayload = {
      entidadeId: tenant.entidadeId,
      entidadeNome: tenant.nome,
      csUid: targetCsUid,
      csEmail: targetCsEmail,
      csName: targetCsName,
      assignedCS: {
        uid: targetCsUid,
        name: targetCsName,
        email: targetCsEmail,
      },
      tipoRisco:
        aiDiagnosis.tipoRisco ||
        (temRiscoErros
          ? "RISCO OPERACIONAL DE INTEGRAÇÃO"
          : "RISCO DE CHURN / DESENGAJAMENTO"),
      motivo: aiDiagnosis.resumo,
      acaoRecomendada: `${aiDiagnosis.estrategiaCS}\n\nRecomendações Práticas: ${aiDiagnosis.sugestaoAcao}`,
      status: "ativo" as const,
      disparadoEm: new Date().toISOString(),
      origem: "cs-agent-sentinel",
    };

    // 3. Salva no Firestore ('cs_alerts_history') com chave determinística deduplicada
    try {
      const docId = await saveCSAlert(alertPayload, targetCsUid);
      dispatchedAlerts.push({ ...alertPayload, id: docId, nivelRisco: aiDiagnosis.nivelRisco });
      riskyTenants.push({
        nome: tenant.nome,
        motivo: aiDiagnosis.resumo,
        tipoRisco: alertPayload.tipoRisco,
      });
      log(`   🚨 ALERTA [${alertPayload.tipoRisco}] registrado no Firestore (Doc: ${docId})`);
    } catch (saveErr: any) {
      log(`   ❌ Erro ao salvar alerta no Firestore: ${saveErr.message}`);
    }

    // 4. Dispara e-mail prescritivo para o CS responsável
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
        `   ✉️ E-mail prescritivo enviado para ${alertPayload.csEmail} (provedor: ${emailResult.provider})`
      );
    } catch (mailErr: any) {
      log(`   ⚠️ Erro ao disparar e-mail prescritivo: ${mailErr.message}`);
    }

    // 5. Dispara webhook corporativo opcional
    if (CS_WEBHOOK_URL) {
      try {
        await fetch(CS_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(alertPayload),
        });
        log(`   🌐 Webhook corporativo notificado.`);
      } catch (hookErr: any) {
        log(`   ⚠️ Erro ao disparar webhook: ${hookErr.message}`);
      }
    }
  }

  // 6. Monta o Relatório Executivo Consolidado
  const agoraStr = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  let report = `# Relatório Executivo Consolidado - Sentinel CS\n\n`;
  report += `**Data da Auditoria:** ${agoraStr}\n`;
  report += `**Modelo de IA Utilizado:** \`${finalModelUsed}\`\n`;
  report += `**Total de Contas Auditadas:** ${monitoredTenants.length}\n`;
  report += `**Alertas Preventivos Emitidos:** ${dispatchedAlerts.length}\n`;
  report += `**Contas em Situação Saudável:** ${healthyTenants.length}\n\n`;

  if (riskyTenants.length > 0) {
    report += `### 🚨 Contas que Requerem Intervenção Imediata:\n`;
    for (const r of riskyTenants) {
      report += `- **${r.nome}** [${r.tipoRisco}]\n  - *Diagnóstico:* ${r.motivo}\n`;
    }
    report += `\n`;
  }

  if (healthyTenants.length > 0) {
    report += `### ✅ Contas com Operação Estável:\n`;
    report += healthyTenants.map((nome) => `- ${nome}`).join("\n") + "\n\n";
  }

  report += `### 📌 Próximos Passos:\n`;
  report += `1. Analistas de CS devem executar os roteiros prescritivos enviados por e-mail.\n`;
  report += `2. Acompanhar a evolução das filas de erro na collection \`errosintegracoes\` no próximo ciclo de monitoramento.\n`;

  log("📊 Auditoria concluída e Relatório Executivo gerado.");

  return {
    success: true,
    timestamp: new Date().toISOString(),
    model: finalModelUsed,
    totalEntitiesAudited: monitoredTenants.length,
    totalAlertsDispatched: dispatchedAlerts.length,
    alertsDispatched: dispatchedAlerts,
    executiveReport: report,
    logs: executionLogs,
  };
}
