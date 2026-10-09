import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  getActiveMonitoredTenants,
  saveCSAlert,
  resolveTenantAlerts,
  extractCSUser,
  MonitoredTenant,
  CSUserFilter,
} from "@/lib/firebase-admin";
import { checkTenantHealthMetrics } from "@/lib/mongodb";
import {
  sendCSMonitoringEmail,
  ClientAlertItem,
  IncidentErrorSummary,
} from "@/lib/email";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Invoca o Gemini com retry e fallback defensivo para gerar o diagnóstico de IA
 */
async function generateGeminiDiagnosis(
  dadosIncidente: {
    empresa: string;
    errosRecentes: number;
    gruposViolados: any[];
    falhasAtivas: IncidentErrorSummary[];
    despertadoSnooze: boolean;
    observacaoAnteriorSnooze?: string | null;
    diasSemAcesso?: number | null;
    usuariosInativos?: number;
    totalUsuarios?: number;
  }
): Promise<{
  nivelCriticidade: "Alerta Crítico" | "Atenção" | "Moderado";
  tipoRisco: string;
  diagnosticoIA: string;
  roteiroAbordagem: string;
}> {
  const apiKey =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelsToTry = [
      process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
      "gemini-3.5-flash",
      "gemini-2.5-flash",
      "gemini-1.5-flash",
    ];

    const prompt = `Você é o Sentinel IA, especialista em Customer Success Preventivo e Observabilidade da Kenit.
Analise os dados deste incidente operacional e gere um diagnóstico de negócio estratégico e um roteiro de contato para o analista de CS:

DADOS DO CLIENTE:
- Nome da Empresa: "${dadosIncidente.empresa}"
- Falhas de Integração Violadas: ${JSON.stringify(dadosIncidente.falhasAtivas, null, 2)}
- Grupos com SLA de Erros Violado: ${JSON.stringify(dadosIncidente.gruposViolados, null, 2)}
- Incidente Despertado do Snooze (Prazo Expirado): ${dadosIncidente.despertadoSnooze ? "SIM" : "NÃO"}
- Nota Anterior do CS: "${dadosIncidente.observacaoAnteriorSnooze || "Nenhuma"}"
- Dias sem Acesso de Usuários: ${dadosIncidente.diasSemAcesso ?? "Normal"}
- Usuários Inativos: ${dadosIncidente.usuariosInativos ?? 0} de ${dadosIncidente.totalUsuarios ?? 0}

DIRETRIZES:
1. Nível de Criticidade: Defina estritamente "Alerta Crítico" se houver falhas em canais de Pedidos, Faturamento, Estoque ou volume alto de erros (>10 erros); caso contrário, defina "Atenção".
2. Tipo de Risco: "RISCO OPERACIONAL DE INTEGRAÇÃO" ou "RISCO DE CHURN / DESENGAJAMENTO".
3. Se o incidente foi DESPERTADO DO SNOOZE (prazo acordado expirou e o erro persiste), enfatize a necessidade de uma cobrança mais assertiva e firme ao cliente.
4. O diagnóstico deve explicar o impacto direto na receita ou operação do lojista (ex: pedidos represados, SKUs sem atualização).
5. O roteiro de contato deve conter um script pronto, empático e consultivo para o analista enviar ou falar com o cliente antes de ser aberto um chamado.

Retorne EXCLUSIVAMENTE um JSON com as seguintes chaves (sem markdown):
{
  "nivelCriticidade": "Alerta Crítico" | "Atenção",
  "tipoRisco": "RISCO OPERACIONAL DE INTEGRAÇÃO" | "RISCO DE CHURN / DESENGAJAMENTO",
  "diagnosticoIA": "Resumo analítico do impacto operacional e comercial",
  "roteiroAbordagem": "Roteiro e mensagem sugerida de abordagem consultiva do CS para o cliente"
}`;

    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: { responseMimeType: "application/json" },
        });
        const res = await model.generateContent(prompt);
        const text = res.response.text();
        const parsed = JSON.parse(text);
        if (parsed.diagnosticoIA && parsed.roteiroAbordagem) {
          return {
            nivelCriticidade:
              parsed.nivelCriticidade === "Alerta Crítico" ? "Alerta Crítico" : "Atenção",
            tipoRisco: parsed.tipoRisco || "RISCO OPERACIONAL DE INTEGRAÇÃO",
            diagnosticoIA: parsed.diagnosticoIA,
            roteiroAbordagem: parsed.roteiroAbordagem,
          };
        }
      } catch (err: any) {
        console.warn(`[Gemini Monitor] Falha no modelo ${modelName}:`, err.message);
      }
    }
  }

  // Fallback estruturado de alta qualidade caso o Gemini esteja indisponível
  const temFalhaCritica = dadosIncidente.falhasAtivas.some((f) =>
    f.tipo.toLowerCase().includes("pedido") || f.totalErros > 10
  );
  const nivelCriticidade = temFalhaCritica ? "Alerta Crítico" : "Atenção";
  const tipoRisco =
    dadosIncidente.falhasAtivas.length > 0
      ? "RISCO OPERACIONAL DE INTEGRAÇÃO"
      : "RISCO DE CHURN / DESENGAJAMENTO";

  return {
    nivelCriticidade,
    tipoRisco,
    diagnosticoIA: `Detectadas ${dadosIncidente.errosRecentes} falhas consecutivas de integração na operação de ${dadosIncidente.empresa}. O volume ultrapassou os limites estipulados de tolerância operacional, com risco de represamento de pedidos e impacto na experiência de venda final.`,
    roteiroAbordagem: `1. Contatar o gestor da conta: 'Olá time da ${dadosIncidente.empresa}! Nosso monitoramento preventivo identificou oscilações nas integrações ativas. Já isolamos os registros afetados para auxiliá-los no destravamento imediato antes de impactos em vendas.'`,
  };
}

/**
 * Ciclo principal de monitoramento e envio de e-mails
 */
async function executeMonitoringCycle(options: {
  csFilter?: CSUserFilter;
  isManualTest?: boolean;
}) {
  const agora = Date.now();
  const startTime = Date.now();

  console.log(
    `⏰ [Monitor Cron] Iniciando ciclo de monitoramento ${
      options.isManualTest ? "(Disparo Manual)" : "(Agendado)"
    }...`
  );

  // 1. Varredura das Entidades Monitoradas Ativas no Firestore
  const activeTenants = await getActiveMonitoredTenants(options.csFilter);
  console.log(`📋 [Monitor Cron] ${activeTenants.length} entidade(s) ativa(s) carregada(s).`);

  if (activeTenants.length === 0) {
    return {
      success: true,
      message: "Nenhuma entidade ativa encontrada para monitoramento.",
      totalTenants: 0,
      totalIncidentes: 0,
      emailsDisparados: 0,
      durationMs: Date.now() - startTime,
    };
  }

  // 2. Agrupamento das entidades pelo e-mail do CS responsável (csEmail)
  const groupedByCS = new Map<
    string,
    {
      csEmail: string;
      csName: string;
      csUid?: string;
      tenants: MonitoredTenant[];
    }
  >();

  for (const tenant of activeTenants) {
    const rawEmail = (tenant.assignedCS?.email || "cs@kenit.com.br").trim().toLowerCase();
    const csName = tenant.assignedCS?.name || rawEmail.split("@")[0] || "Analista de CS";
    const csUid = tenant.assignedCS?.uid;

    if (!groupedByCS.has(rawEmail)) {
      groupedByCS.set(rawEmail, {
        csEmail: rawEmail,
        csName,
        csUid,
        tenants: [],
      });
    }

    groupedByCS.get(rawEmail)!.tenants.push(tenant);
  }

  const resultsByCS: Array<{
    csEmail: string;
    csName: string;
    totalContas: number;
    incidentesDetectados: number;
    emailStatus: "enviado" | "simulado" | "sem_incidentes" | "erro";
    messageId?: string;
    error?: string;
  }> = [];

  let totalIncidentesGlobal = 0;
  let totalEmailsDisparados = 0;

  // 3. Processa cada grupo de CS
  for (const [csEmail, csGroup] of Array.from(groupedByCS.entries())) {
    console.log(
      `🔍 [Monitor Cron] Avaliando carteira do CS: ${csGroup.csName} (${csEmail}) com ${csGroup.tenants.length} conta(s)...`
    );

    const clientAlertsForCS: ClientAlertItem[] = [];

    // Avalia cada entidade atribuída a esse CS
    for (const tenant of csGroup.tenants) {
      const diasInatividade = tenant.thresholds.diasSemAcessoAlerta || 7;
      const tiposMonitorados = tenant.thresholds.tiposMonitorados || [];
      const gruposMonitoramento = tenant.thresholds.gruposMonitoramento || [];
      const incidentFeedback = tenant.incidentFeedback || {};

      // Consulta métricas no MongoDB (errosintegracoes + usuarios)
      const rawMetrics = (await checkTenantHealthMetrics(
        tenant.entidadeId,
        diasInatividade,
        tiposMonitorados,
        gruposMonitoramento
      )) as any;

      if (rawMetrics.error) {
        console.warn(
          `⚠️ [Monitor Cron] Erro ao consultar MongoDB para ${tenant.nome}:`,
          rawMetrics.error
        );
        continue;
      }

      const totalErros2h = rawMetrics.errosRecentesUltimas2h ?? 0;
      const usuariosAtivos = rawMetrics.usuariosAtivosNoPeriodo ?? 0;
      const totalUsuarios = rawMetrics.totalUsuariosCadastrados ?? 0;
      const avaliacaoGrupos = rawMetrics.avaliacaoGrupos || [];

      // Avaliação de Regras e Grupos Customizados de Monitoramento
      const gruposComSlaViolado = avaliacaoGrupos.filter((g: any) => g.violouSLA);

      // Avaliação dos grupos de erro (canal + tipo) e Filtro de Snooze
      const falhasAtivas: IncidentErrorSummary[] = [];
      let temSnoozeExpirado = false;
      let observacaoSnoozeExpirado: string | null = null;
      let totalGruposSilenciados = 0;

      for (const grupoErro of rawMetrics.gruposErros || []) {
        const canal = grupoErro.layoutIntegracao || "Geral";
        const tipo = grupoErro.tipoIntegracao || "Geral";
        const grupoKey = `${canal}_${tipo}`;
        const feedback = incidentFeedback[grupoKey];

        const silenciadoAteMs = feedback?.silenciadoAte
          ? new Date(feedback.silenciadoAte).getTime()
          : 0;

        // FILTRO DE SNOOZE: Se silenciadoAte > agora, ignora este grupo
        if (silenciadoAteMs > agora) {
          totalGruposSilenciados++;
          continue;
        }

        // Verifica se despertou do snooze (prazo expirou e o erro persiste)
        const despertado = Boolean(feedback?.silenciadoAte && silenciadoAteMs <= agora);
        if (despertado) {
          temSnoozeExpirado = true;
          observacaoSnoozeExpirado = feedback?.observacao || null;
        }

        falhasAtivas.push({
          canal,
          tipo,
          totalErros: grupoErro.totalErros,
          amostraMensagens: grupoErro.amostraMensagens?.slice(0, 3) || [],
          codigosAfetados: grupoErro.codigosAfetados?.slice(0, 5) || [],
          statusSnooze: despertado ? "expirado" : "ativo",
        });
      }

      // Verificação de Limites Ultrapassados
      const limiteGeralPadrao = tenant.thresholds.maxErros2h ?? 5;
      const violouErros =
        gruposComSlaViolado.length > 0 ||
        (avaliacaoGrupos.length === 0 && totalErros2h > limiteGeralPadrao);

      const violouEngajamento = totalUsuarios > 0 && usuariosAtivos === 0;

      // Se houver falhas ativas não silenciadas e violou limites, OU despertou do snooze, OU violou engajamento
      const temIncidenteAtivo =
        (violouErros && falhasAtivas.length > 0) ||
        temSnoozeExpirado ||
        violouEngajamento;

      if (!temIncidenteAtivo) {
        // Se a conta está saudável, resolve alertas anteriores
        try {
          await resolveTenantAlerts(
            tenant.entidadeId,
            "Operação restabelecida na varredura automatizada.",
            csGroup.csUid
          );
        } catch {}
        continue;
      }

      console.log(
        `🚨 [Monitor Cron] Incidente violado para "${tenant.nome}" (${falhasAtivas.length} falhas ativas, ${totalGruposSilenciados} silenciadas). Gerando IA...`
      );

      // 4. Geração do Diagnóstico com IA (Gemini)
      const aiDiagnosis = await generateGeminiDiagnosis({
        empresa: tenant.nome,
        errosRecentes: totalErros2h,
        gruposViolados: gruposComSlaViolado,
        falhasAtivas,
        despertadoSnooze: temSnoozeExpirado,
        observacaoAnteriorSnooze: observacaoSnoozeExpirado,
        diasSemAcesso: rawMetrics.ultimoAcessoGeral?.diasSemAcesso,
        usuariosInativos: rawMetrics.totalUsuariosInativos,
        totalUsuarios,
      });

      const clientAlert: ClientAlertItem = {
        entidadeId: tenant.entidadeId,
        entidadeNome: tenant.nome,
        nivelCriticidade: aiDiagnosis.nivelCriticidade,
        tipoRisco: aiDiagnosis.tipoRisco,
        canalImpactado: falhasAtivas[0]?.canal || "Integrações",
        erros2h: totalErros2h,
        diasSemAcesso: rawMetrics.ultimoAcessoGeral?.diasSemAcesso || undefined,
        falhasVioladas: falhasAtivas,
        diagnosticoIA: aiDiagnosis.diagnosticoIA,
        roteiroAbordagem: aiDiagnosis.roteiroAbordagem,
        cockpitUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard?tenant=${tenant.entidadeId}`,
      };

      clientAlertsForCS.push(clientAlert);

      // Gravação no Firestore em cs_alerts_history com chave determinística (evitando duplicatas)
      try {
        await saveCSAlert(
          {
            entidadeId: tenant.entidadeId,
            entidadeNome: tenant.nome,
            csUid: csGroup.csUid,
            csEmail,
            csName: csGroup.csName,
            assignedCS: {
              uid: csGroup.csUid,
              name: csGroup.csName,
              email: csEmail,
            },
            tipoRisco: clientAlert.tipoRisco,
            motivo: clientAlert.diagnosticoIA,
            acaoRecomendada: clientAlert.roteiroAbordagem,
            status: "ativo",
            disparadoEm: new Date().toISOString(),
            origem: "cron-monitor",
          },
          csGroup.csUid
        );
      } catch (err: any) {
        console.error(`❌ [Monitor Cron] Erro ao gravar cs_alerts_history:`, err.message);
      }
    }

    totalIncidentesGlobal += clientAlertsForCS.length;

    // 5. Disparo do E-mail Consolidado para o CS
    // No modo agendado, dispara e-mail se houver incidentes. No modo manual, dispara sempre para validar entrega.
    if (clientAlertsForCS.length > 0 || options.isManualTest) {
      try {
        const mailResult = await sendCSMonitoringEmail({
          to: csEmail,
          csName: csGroup.csName,
          incidentes: clientAlertsForCS,
          isManualTest: options.isManualTest,
          contasAuditadasCount: csGroup.tenants.length,
          timestamp: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        });

        totalEmailsDisparados++;
        resultsByCS.push({
          csEmail,
          csName: csGroup.csName,
          totalContas: csGroup.tenants.length,
          incidentesDetectados: clientAlertsForCS.length,
          emailStatus: mailResult.simulated ? "simulado" : "enviado",
          messageId: mailResult.messageId,
        });
      } catch (mailErr: any) {
        resultsByCS.push({
          csEmail,
          csName: csGroup.csName,
          totalContas: csGroup.tenants.length,
          incidentesDetectados: clientAlertsForCS.length,
          emailStatus: "erro",
          error: mailErr.message,
        });
      }
    } else {
      resultsByCS.push({
        csEmail,
        csName: csGroup.csName,
        totalContas: csGroup.tenants.length,
        incidentesDetectados: 0,
        emailStatus: "sem_incidentes",
      });
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(
    `✅ [Monitor Cron] Concluído em ${(durationMs / 1000).toFixed(1)}s. Contas auditadas: ${
      activeTenants.length
    }, Incidentes: ${totalIncidentesGlobal}, E-mails enviados: ${totalEmailsDisparados}`
  );

  return {
    success: true,
    message: `Monitoramento ativo executado com sucesso. ${totalIncidentesGlobal} incidente(s) identificado(s).`,
    executedAt: new Date().toISOString(),
    durationMs,
    totalTenants: activeTenants.length,
    totalIncidentes: totalIncidentesGlobal,
    emailsDisparados: totalEmailsDisparados,
    resultsByCS,
  };
}

/**
 * Handler unificado para execução do ciclo de monitoramento ativo
 * Suporta chamadas automatizadas do cron-job.org e requisições manuais do dashboard
 */
async function handleMonitoring(req: Request): Promise<Response> {
  try {
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    const cronSecret = process.env.CRON_SECRET?.trim();

    let bodyData: any = null;
    if (req.method === "POST") {
      try {
        bodyData = await req.json();
      } catch {
        // Body vazio
      }
    }

    // 1. Validação do Token Secreto (cron-job.org / scripts agendados)
    const isCronAuthorized = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);

    // 2. Validação para disparo manual de analista de CS logado no dashboard
    const csUser = !isCronAuthorized ? await extractCSUser(req, bodyData) : null;
    const isCsAuthorized = Boolean(csUser && csUser.email && csUser.uid && csUser.uid !== "cs_lead_demo");

    // 3. Fallback permissivo apenas em ambiente local sem secret configurado
    const isDevFallback = !cronSecret && process.env.NODE_ENV !== "production";

    // Se houver CRON_SECRET e a requisição não vier autenticada nem como cron nem como CS logado
    if (!isCronAuthorized && !isCsAuthorized && !isDevFallback) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const isManualTest =
      isCsAuthorized ||
      bodyData?.isManualTest === true ||
      url.searchParams.get("manual") === "true";

    const result = await executeMonitoringCycle({
      csFilter: csUser || undefined,
      isManualTest,
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("❌ [/api/cron/monitor] Falha na execução:", error.message);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Erro interno no processamento do monitoramento.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * GET /api/cron/monitor
 * Disparado automaticamente pelo serviço externo cron-job.org
 */
export async function GET(req: Request) {
  return handleMonitoring(req);
}

/**
 * POST /api/cron/monitor
 * Disparado pelo dashboard ou clientes HTTP via POST
 */
export async function POST(req: Request) {
  return handleMonitoring(req);
}
