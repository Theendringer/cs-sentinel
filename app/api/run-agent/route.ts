import { NextRequest, NextResponse } from "next/server";
import { runCustomerSuccessAudit } from "@/lib/agent";
import { extractCSUser } from "@/lib/firebase-admin";

export const maxDuration = 60; // Permite até 60s de execução na Vercel
export const dynamic = "force-dynamic";

/**
 * POST /api/run-agent
 * Dispara a execução sob demanda da auditoria preventiva do Agente de CS
 * Isola a auditoria na carteira do analista de CS autenticado (token/headers/body)
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Validação antecipada da chave do Gemini
    const apiKey =
      process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Chave GEMINI_API_KEY não configurada nas variáveis de ambiente da Vercel.",
        },
        { status: 400 }
      );
    }

    let bodyData: any = null;
    try {
      bodyData = await request.json();
    } catch {
      // Body vazio ou não JSON
    }

    const csUser = await extractCSUser(request, bodyData);
    if (!csUser || !csUser.uid || !csUser.email || csUser.uid === "cs_lead_demo") {
      return NextResponse.json(
        { error: "Acesso não autorizado. Faça login primeiro." },
        { status: 401 }
      );
    }

    console.log(
      `🤖 [/api/run-agent] Disparo de auditoria solicitado para CS: ${
        csUser.name || csUser.email || csUser.uid
      }...`
    );

    const auditResult = await runCustomerSuccessAudit(csUser);

    return NextResponse.json({
      success: true,
      message: csUser
        ? `Auditoria de Customer Success executada para a carteira de ${csUser.name || csUser.email}.`
        : "Auditoria de Customer Success executada com sucesso.",
      csUser: csUser || null,
      data: auditResult,
    });
  } catch (error: any) {
    console.error("[ERRO AGENTE IA]:", error);
    return NextResponse.json(
      {
        error: error?.message || "Falha ao processar análise da IA",
        details: error?.response?.data || error?.toString(),
      },
      { status: 500 }
    );
  }
}
