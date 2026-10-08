import { NextRequest, NextResponse } from "next/server";
import { runCustomerSuccessAudit } from "@/lib/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Permite até 60s de execução na Vercel

/**
 * GET /api/cron/audit
 * Rota agendada (Cron Job) para execução automática periódica do Agente Sentinela de CS.
 * Protegida via header de autorização: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader =
      request.headers.get("authorization") ||
      request.headers.get("Authorization");
    const customSecretHeader = request.headers.get("x-cron-secret");

    // Validação da chave secreta
    const isAuthorized =
      (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
      (cronSecret && customSecretHeader === cronSecret) ||
      (!cronSecret && process.env.NODE_ENV !== "production");

    if (!isAuthorized) {
      console.warn("⚠️ [/api/cron/audit] Tentativa de execução não autorizada.");
      return NextResponse.json(
        {
          success: false,
          error: "Não autorizado. Forneça o header 'Authorization: Bearer <CRON_SECRET>' válido.",
        },
        { status: 401 }
      );
    }

    // Validação antecipada da chave do Gemini
    const apiKey =
      process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Chave GEMINI_API_KEY não configurada nas variáveis de ambiente da Vercel.",
        },
        { status: 400 }
      );
    }

    console.log("⏰ [Cron Audit] Iniciando auditoria periódica agendada via /api/cron/audit...");
    const startTime = Date.now();

    // Executa a auditoria completa do agente para todos os tenants monitorados ativos
    const result = await runCustomerSuccessAudit();
    const durationMs = Date.now() - startTime;

    console.log(
      `✅ [Cron Audit] Auditoria concluída em ${(durationMs / 1000).toFixed(1)}s. Total de contas: ${result.totalEntitiesAudited}, Alertas: ${result.totalAlertsDispatched}`
    );

    return NextResponse.json({
      success: true,
      message: "Auditoria preventiva periódica executada com sucesso.",
      executedAt: result.timestamp,
      durationMs,
      summary: {
        totalEntitiesAudited: result.totalEntitiesAudited,
        totalAlertsDispatched: result.totalAlertsDispatched,
        model: result.model,
      },
      alertsDispatched: result.alertsDispatched,
      executiveReport: result.executiveReport,
    });
  } catch (error: any) {
    console.error("❌ [/api/cron/audit] Falha na execução da auditoria agendada:", error.message);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Erro interno ao processar auditoria periódica.",
      },
      { status: 500 }
    );
  }
}
