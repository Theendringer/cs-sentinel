import { NextRequest, NextResponse } from "next/server";
import { getAlertsHistory, extractCSUser } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/alerts
 * Retorna o histórico de alertas emitidos pelo agente autônomo,
 * filtrando exclusivamente pela carteira do analista de CS autenticado.
 */
export async function GET(request: NextRequest) {
  try {
    const csUser = await extractCSUser(request);
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const alerts = await getAlertsHistory(limit, csUser || undefined);

    return NextResponse.json({
      success: true,
      total: alerts.length,
      cs: csUser,
      alerts,
    });
  } catch (error: any) {
    console.error("❌ [/api/alerts] Erro:", error.message);
    return NextResponse.json(
      { success: false, error: error.message, alerts: [] },
      { status: 500 }
    );
  }
}
