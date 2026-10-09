export const maxDuration = 60;
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  getActiveMonitoredTenants,
  saveCSAlert,
  resolveTenantAlerts,
  extractCSUser,
  MonitoredTenant,
  CSUserFilter,
} from "@/lib/firebase-admin";
import { getMongoDb, ObjectId } from "@/lib/mongodb";
import {
  sendCSMonitoringEmail,
  ClientAlertItem,
  IncidentErrorSummary,
} from "@/lib/email";

/**
 * Utilitário para processar tarefas em lotes com concorrência controlada (Promise.all)
 */
async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((item) => fn(item)));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Invoca o Gemini com retry, timeout defensivo e fallback imediato caso a IA demore
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
    const envModel = (process.env.GEMINI_MODEL || "").trim();
    // Filtra modelos inexistentes que geram 404 e timeouts de rede desnecessários
    const candidateModels = [
      envModel,
      "gemini-2.5-flash",
      "gemini-1.5-flash",
    ].filter(
      (m) =>
        Boolean(m) &&
        m !== "gemini-3.5-flash-lite" &&
        m !== "gemini-3.5-flash"
    );
    const modelsToTry =
      candidateModels.length > 0 ? candidateModels : ["gemini-2.5-flash", "gemini-1.5-flash"];

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

        // Timeout defensivo de 6 segundos para não prender a execução do cron
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout Gemini (6s)")), 6000)
        );

        const res = (await Promise.race([
          model.generateContent(prompt),
          timeoutPromise,
        ])) as any;

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
        console.warn(`[Gemini Monitor] Falha/Timeout no modelo ${modelName}:`, err.message);
      }
    }
  }

  // Fallback estruturado de alta performance caso a IA esteja offline ou lenta
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
 * Avalia a saúde de uma entidade individualmente com filtragem prévia rápida no MongoDB
 */
async function evaluateSingleTenant(
  tenant: MonitoredTenant,
  csGroup: { csUid?: string; csName: string; csEmail: string },
  agora: number
): Promise<{
  hasIncident: boolean;
  clientAlert?: ClientAlertItem;
}> {
  try {
    const db = await getMongoDb();
    let targetObjectId: ObjectId;
    try {
      targetObjectId = new ObjectId(tenant.entidadeId);
    } catch {
      return { hasIncident: false };
    }

    const duasHorasAtras = new Date(agora - 2 * 60 * 60 * 1000);
    const incidentFeedback = tenant.incidentFeedback || {};
    const limiteGeralPadrao = tenant.thresholds?.maxErros2h ?? 5;

    // 1. Filtragem Prévia Rápida no Mongo:
    // Projeção mínima (.project({ _id: 1, tipoIntegracao: 1, layoutIntegracao: 1, dataCriacao: 1 })) e limit(20)
    // Evita transferir payloads gigantes de requisicao e retorno antes de confirmar se os limites foram violados
    const errorQuery: any = {
      entidade: targetObjectId,
      status: "pendente",
      $or: [
        { dataCriacao: { $gte: duasHorasAtras } },
        { ultimaAtualizacao: { $gte: duasHorasAtras } },
        { dataCriacao: { $gte: duasHorasAtras.toISOString() } },
        { ultimaAtualizacao: { $gte: duasHorasAtras.toISOString() } },
      ],
    };

    const tiposMonitorados = tenant.thresholds?.tiposMonitorados || [];
    if (Array.isArray(tiposMonitorados) && tiposMonitorados.length > 0) {
      const regexList = tiposMonitorados.map(
        (t) => new RegExp(`^${t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
      );
      errorQuery.tipoIntegracao = { $in: regexList };
    }

    const fastErrosDocs = await db
      .collection("errosintegracoes")
      .find(errorQuery)
      .project({ _id: 1, tipoIntegracao: 1, layoutIntegracao: 1, dataCriacao: 1 })
      .sort({ dataCriacao: -1, ultimaAtualizacao: -1 })
      .limit(20)
      .toArray();

    // Agrupamento rápido por layout e tipo de integração
    const gruposPreMap = new Map<string, { canal: string; tipo: string; count: number }>();
    for (const doc of fastErrosDocs) {
      const canal = (doc.layoutIntegracao as string) || "Geral";
      const tipo = (doc.tipoIntegracao as string) || "Geral";
      const chave = `${canal}_${tipo}`;
      const existing = gruposPreMap.get(chave) || { canal, tipo, count: 0 };
      existing.count++;
      gruposPreMap.set(chave, existing);
    }

    // Filtragem com Snooze
    const falhasAtivasPre: Array<{
      canal: string;
      tipo: string;
      count: number;
      despertado: boolean;
      feedback?: any;
    }> = [];
    let temSnoozeExpirado = false;
    let observacaoSnoozeExpirado: string | null = null;
    let totalGruposSilenciados = 0;

    for (const [chave, g] of gruposPreMap.entries()) {
      const feedback = incidentFeedback[chave];
      const silenciadoAteMs = feedback?.silenciadoAte
        ? new Date(feedback.silenciadoAte).getTime()
        : 0;

      // FILTRO DE SNOOZE: se silenciadoAte > agora, ignora este grupo
      if (silenciadoAteMs > agora) {
        totalGruposSilenciados++;
        continue;
      }

      const despertado = Boolean(feedback?.silenciadoAte && silenciadoAteMs <= agora);
      if (despertado) {
        temSnoozeExpirado = true;
        observacaoSnoozeExpirado = feedback?.observacao || null;
      }

      falhasAtivasPre.push({
        canal: g.canal,
        tipo: g.tipo,
        count: g.count,
        despertado,
        feedback,
      });
    }

    const totalErrosNaoSilenciados = falhasAtivasPre.reduce((acc, f) => acc + f.count, 0);

    // Validação de grupos customizados de monitoramento (SLA)
    const gruposMonitoramento = tenant.thresholds?.gruposMonitoramento || [];
    let violouGruposSla = false;
    const gruposVioladosInfo: any[] = [];

    if (gruposMonitoramento.length > 0 && fastErrosDocs.length > 0) {
      for (const gm of gruposMonitoramento) {
        const gmTipos = (gm.tipos || []).map((t: string) => t.toLowerCase());
        const countGm = fastErrosDocs.filter((d: any) =>
          gmTipos.length === 0 || gmTipos.includes(String(d.tipoIntegracao || "").toLowerCase())
        ).length;
        if (countGm > (gm.limiteErros ?? 5)) {
          violouGruposSla = true;
          gruposVioladosInfo.push({
            nome: gm.nome,
            limiteErros: gm.limiteErros,
            totalErros: countGm,
            violouSLA: true,
          });
        }
      }
    }

    const violouThresholdErros =
      violouGruposSla ||
      (gruposMonitoramento.length === 0 && totalErrosNaoSilenciados > limiteGeralPadrao);

    // Checagem enxuta de inatividade de usuários
    let violouEngajamento = false;
    let diasSemAcessoGeral: number | null = null;
    let totalUsuarios = 0;
    let usuariosInativos = 0;

    const diasInatividadeConfig = tenant.thresholds?.diasSemAcessoAlerta || 7;
    const limiteInatividade = new Date(agora - diasInatividadeConfig * 24 * 60 * 60 * 1000);

    const usuariosDocs = await db
      .collection("usuarios")
      .find({ entidade: targetObjectId })
      .project({ _id: 1, ultimoAcesso: 1 })
      .limit(50)
      .toArray();

    totalUsuarios = usuariosDocs.length;
    if (totalUsuarios > 0) {
      let dataMaisRecente: Date | null = null;
      let ativosCount = 0;
      for (const u of usuariosDocs) {
        const dt = u.ultimoAcesso ? new Date(u.ultimoAcesso) : null;
        if (dt && !isNaN(dt.getTime())) {
          if (!dataMaisRecente || dt > dataMaisRecente) {
            dataMaisRecente = dt;
          }
          if (dt >= limiteInatividade) {
            ativosCount++;
          }
        }
      }
      if (dataMaisRecente) {
        diasSemAcessoGeral = Math.max(
          0,
          Math.floor((agora - dataMaisRecente.getTime()) / (1000 * 60 * 60 * 24))
        );
      }
      usuariosInativos = totalUsuarios - ativosCount;
      if (ativosCount === 0 && totalUsuarios > 0) {
        violouEngajamento = true;
      }
    }

    // Regra determinante de incidente ativo
    const temIncidenteAtivo =
      (violouThresholdErros && falhasAtivasPre.length > 0) ||
      temSnoozeExpirado ||
      violouEngajamento;

    // GATILHO DE IA APENAS EM INCIDENTES REAIS:
    // Se saudável ou dentro da normalidade / silenciado pelo snooze, NÃO chama Gemini!
    if (!temIncidenteAtivo) {
      resolveTenantAlerts(
        tenant.entidadeId,
        "Operação restabelecida na varredura automatizada.",
        csGroup.csUid
      ).catch(() => {});
      return { hasIncident: false };
    }

    console.log(
      `🚨 [Monitor Cron] Incidente confirmado para "${tenant.nome}" (${falhasAtivasPre.length} falha(s) ativa(s), ${totalGruposSilenciados} silenciada(s)). Buscando mensagens e acionando IA...`
    );

    // Busca apenas amostra enxuta de mensagens dos erros (sem payloads pesados de retorno)
    const docIds = fastErrosDocs.slice(0, 10).map((d) => d._id);
    const detalheDocs = await db
      .collection("errosintegracoes")
      .find({ _id: { $in: docIds } })
      .project({
        layoutIntegracao: 1,
        tipoIntegracao: 1,
        codigoRegistro: 1,
        "mensagens.texto": 1,
      })
      .toArray();

    const falhasAtivas: IncidentErrorSummary[] = falhasAtivasPre.map((f) => {
      const docsGrupo = detalheDocs.filter(
        (d: any) =>
          (d.layoutIntegracao || "Geral") === f.canal &&
          (d.tipoIntegracao || "Geral") === f.tipo
      );

      const codigosAfetados = docsGrupo
        .map((d: any) => (d.codigoRegistro ? String(d.codigoRegistro) : null))
        .filter(Boolean)
        .slice(0, 5) as string[];

      const amostraMensagens: string[] = [];
      for (const d of docsGrupo) {
        if (Array.isArray(d.mensagens)) {
          for (const m of d.mensagens) {
            const txt = typeof m === "string" ? m : m?.texto;
            if (txt && amostraMensagens.length < 3) {
              amostraMensagens.push(String(txt).trim());
            }
          }
        }
      }

      return {
        canal: f.canal,
        tipo: f.tipo,
        totalErros: f.count,
        codigosAfetados,
        amostraMensagens,
        statusSnooze: f.despertado ? "expirado" : "ativo",
      };
    });

    // Diagnóstico estrito com Gemini apenas para entidades com incidentes confirmados
    const aiDiagnosis = await generateGeminiDiagnosis({
      empresa: tenant.nome,
      errosRecentes: fastErrosDocs.length,
      gruposViolados: gruposVioladosInfo,
      falhasAtivas,
      despertadoSnooze: temSnoozeExpirado,
      observacaoAnteriorSnooze: observacaoSnoozeExpirado,
      diasSemAcesso: diasSemAcessoGeral,
      usuariosInativos,
      totalUsuarios,
    });

    const clientAlert: ClientAlertItem = {
      entidadeId: tenant.entidadeId,
      entidadeNome: tenant.nome,
      nivelCriticidade: aiDiagnosis.nivelCriticidade,
      tipoRisco: aiDiagnosis.tipoRisco,
      canalImpactado: falhasAtivas[0]?.canal || "Integrações",
      erros2h: fastErrosDocs.length,
      diasSemAcesso: diasSemAcessoGeral || undefined,
      falhasVioladas: falhasAtivas,
      diagnosticoIA: aiDiagnosis.diagnosticoIA,
      roteiroAbordagem: aiDiagnosis.roteiroAbordagem,
      cockpitUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard?tenant=${tenant.entidadeId}`,
    };

    // Salva o alerta no Firestore sem bloquear o fluxo
    saveCSAlert(
      {
        entidadeId: tenant.entidadeId,
        entidadeNome: tenant.nome,
        csUid: csGroup.csUid,
        csEmail: csGroup.csEmail,
        csName: csGroup.csName,
        assignedCS: {
          uid: csGroup.csUid,
          name: csGroup.csName,
          email: csGroup.csEmail,
        },
        tipoRisco: clientAlert.tipoRisco,
        motivo: clientAlert.diagnosticoIA,
        acaoRecomendada: clientAlert.roteiroAbordagem,
        status: "ativo",
        disparadoEm: new Date().toISOString(),
        origem: "cron-monitor",
      },
      csGroup.csUid
    ).catch((err: any) => {
      console.error(`❌ [Monitor Cron] Erro ao gravar cs_alerts_history:`, err.message);
    });

    return { hasIncident: true, clientAlert };
  } catch (err: any) {
    console.error(`❌ [Monitor Cron] Erro ao avaliar ${tenant.nome}:`, err.message);
    return { hasIncident: false };
  }
}

/**
 * Ciclo principal de monitoramento executado com concorrência controlada
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

  const activeTenants = await getActiveMonitoredTenants(options.csFilter);
  console.log(`📋 [Monitor Cron] ${activeTenants.length} entidade(s) ativa(s) carregada(s).`);

  if (activeTenants.length === 0) {
    return {
      success: true,
      totalTenants: 0,
      totalIncidentes: 0,
      emailsDisparados: 0,
      durationMs: Date.now() - startTime,
      resultsByCS: [],
    };
  }

  // Agrupamento por CS responsável
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

  // Processa as carteiras de CS
  for (const [csEmail, csGroup] of Array.from(groupedByCS.entries())) {
    console.log(
      `🔍 [Monitor Cron] Avaliando carteira do CS: ${csGroup.csName} (${csEmail}) com ${csGroup.tenants.length} conta(s)...`
    );

    // Processamento em Paralelo Controlado: lotes de 4 entidades simultâneas
    const evaluatedResults = await processInBatches(
      csGroup.tenants,
      4,
      async (tenant) => evaluateSingleTenant(tenant, csGroup, agora)
    );

    const clientAlertsForCS = evaluatedResults
      .filter((r) => r.hasIncident && r.clientAlert)
      .map((r) => r.clientAlert as ClientAlertItem);

    totalIncidentesGlobal += clientAlertsForCS.length;

    // Disparo de E-mail consolidado para o CS
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
    totalTenants: activeTenants.length,
    totalIncidentes: totalIncidentesGlobal,
    emailsDisparados: totalEmailsDisparados,
    durationMs,
    resultsByCS,
  };
}

/**
 * Handler unificado para execução do ciclo de monitoramento ativo
 */
async function handleMonitoring(req: Request): Promise<Response> {
  const inicio = Date.now();

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

    if (!isCronAuthorized && !isCsAuthorized && !isDevFallback) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
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

    // Retorno Imediato com Resumo Enxuto conforme especificação
    return NextResponse.json({
      success: true,
      entidadesVerificadas: result.totalTenants,
      alertasEnviados: result.emailsDisparados,
      tempoExecucaoMs: Date.now() - inicio,
      // Metadados adicionais para manter compatibilidade com o modal de teste do dashboard
      totalTenants: result.totalTenants,
      totalIncidentes: result.totalIncidentes,
      emailsDisparados: result.emailsDisparados,
      resultsByCS: result.resultsByCS,
    });
  } catch (error: any) {
    console.error("❌ [/api/cron/monitor] Falha na execução:", error.message);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Erro interno no processamento do monitoramento.",
        tempoExecucaoMs: Date.now() - inicio,
      },
      { status: 500 }
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
