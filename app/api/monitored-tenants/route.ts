import { NextRequest, NextResponse } from "next/server";
import {
  extractCSUser,
  upsertMonitoredTenants,
  getActiveMonitoredTenants,
} from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitored-tenants
 * Retorna as entidades monitoradas ativas da carteira do analista de CS autenticado.
 */
export async function GET(request: NextRequest) {
  try {
    const csUser = await extractCSUser(request);
    const tenants = await getActiveMonitoredTenants(csUser || undefined);

    return NextResponse.json({
      success: true,
      total: tenants.length,
      cs: csUser,
      tenants,
    });
  } catch (error: any) {
    console.error("❌ [GET /api/monitored-tenants] Erro:", error.message);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/monitored-tenants
 * Salva ou atualiza a configuração de monitoramento das entidades no Firestore.
 * Utiliza o ID do documento isolado por analista: `${user.uid}_${entidadeId}`.
 * O MongoDB é estritamente READ-ONLY (proibida qualquer escrita/mutação).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Normaliza o payload para array de entidades
    let items: any[] = [];
    if (Array.isArray(body)) {
      items = body;
    } else if (Array.isArray(body.tenants)) {
      items = body.tenants;
    } else if (body && typeof body === "object") {
      items = [body];
    }

    if (!items || items.length === 0) {
      return NextResponse.json(
        { success: false, error: "Nenhum payload de entidade fornecido." },
        { status: 400 }
      );
    }

    // 1. Extração da sessão do analista de CS (via Token Bearer, headers x-cs-* ou body)
    const firstItem = items[0] || {};
    const authenticatedUser = await extractCSUser(request, {
      csUid: body.csUid || firstItem.csUid || firstItem.assignedCS?.uid,
      csEmail: body.csEmail || firstItem.csEmail || firstItem.assignedCS?.email,
      csName: body.csName || firstItem.csName || firstItem.assignedCS?.name,
      assignedCS: firstItem.assignedCS,
    });

    console.log(
      `📥 [/api/monitored-tenants] Gravando ${items.length} entidade(s) para o analista: ${
        authenticatedUser?.name || "Desconhecido"
      } (${authenticatedUser?.email || "sem email"})...`
    );

    // 2. Gravação isolada por carteira com ID `${csUser.uid}_${entidadeId}`
    const result = await upsertMonitoredTenants(items, authenticatedUser || undefined);

    return NextResponse.json({
      success: result.success,
      count: result.count,
      cs: authenticatedUser,
      firestoreSuccess: result.firestoreSuccess,
      firestoreError: result.firestoreError || null,
      message: result.success
        ? `${items.length} entidade(s) vinculada(s) à carteira com sucesso.`
        : `Erro ao salvar no Firestore: ${result.firestoreError}`,
    });
  } catch (error: any) {
    console.error("❌ [POST /api/monitored-tenants] Erro interno:", error.message);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Erro interno ao processar requisição.",
      },
      { status: 500 }
    );
  }
}
