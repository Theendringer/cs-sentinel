import { NextRequest, NextResponse } from "next/server";
import { getAlertsHistory, extractCSUser, getAdminFirestore } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/alerts
 * Retorna o histórico de alertas emitidos pelo agente autônomo,
 * filtrando exclusivamente pela carteira do analista de CS autenticado.
 * Se o Firestore falhar ou estiver indisponível, retorna array vazio [] e status 200 em JSON.
 */
export async function GET(request: NextRequest) {
  try {
    const csUser = await extractCSUser(request);
    if (!csUser || !csUser.uid || !csUser.email || csUser.uid === "cs_lead_demo") {
      return NextResponse.json(
        { error: "Acesso não autorizado. Faça login primeiro." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    // Verifica disponibilidade do Firestore de forma segura
    const db = getAdminFirestore();
    if (!db) {
      console.warn("⚠️ [/api/alerts] Firestore indisponível. Retornando lista vazia com status 200.");
      return NextResponse.json(
        {
          success: true,
          total: 0,
          cs: csUser,
          alerts: [],
          notice: "Firestore indisponível (sem credenciais configuradas).",
        },
        { status: 200 }
      );
    }

    let alerts: any[] = [];
    try {
      alerts = await getAlertsHistory(limit, csUser || undefined);
    } catch (fsErr: any) {
      console.warn("⚠️ [/api/alerts] Falha ao consultar histórico:", fsErr.message);
      alerts = [];
    }

    return NextResponse.json(
      {
        success: true,
        total: alerts.length,
        cs: csUser,
        alerts,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("❌ [/api/alerts] Erro inesperado:", error.message);
    // Retorna array vazio com status 200 para não quebrar a tela do frontend
    return NextResponse.json(
      {
        success: true,
        total: 0,
        cs: null,
        alerts: [],
        error: error.message,
      },
      { status: 200 }
    );
  }
}
