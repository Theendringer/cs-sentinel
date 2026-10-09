import { NextRequest, NextResponse } from "next/server";
import { extractCSUser, saveIncidentFeedback } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/entidades/[id]/feedback-erro
 * Registra nota do CS e parametriza silenciamento temporário (Snooze)
 * para um grupo de falhas específico (${canal}_${tipo}).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: "ID da entidade não fornecido." },
        { status: 400 }
      );
    }

    let body: any = null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Corpo da requisição deve ser um JSON válido." },
        { status: 400 }
      );
    }

    const csUser = await extractCSUser(request, body);
    if (!csUser || !csUser.email) {
      return NextResponse.json(
        { success: false, error: "Acesso não autorizado. Faça login primeiro." },
        { status: 401 }
      );
    }

    const { canal, tipo, observacao, lembrarEmDias } = body || {};

    if (!canal || !tipo) {
      return NextResponse.json(
        {
          success: false,
          error: "Os campos 'canal' e 'tipo' são obrigatórios para identificar o grupo de erros.",
        },
        { status: 400 }
      );
    }

    if (observacao === undefined || observacao === null) {
      return NextResponse.json(
        { success: false, error: "O campo 'observacao' é obrigatório." },
        { status: 400 }
      );
    }

    // Calcula a data de término do silenciamento caso 'lembrarEmDias' seja positivo
    let silenciadoAte: string | null = null;
    const diasNum = Number(lembrarEmDias);
    if (!isNaN(diasNum) && diasNum > 0) {
      const msToAdd = diasNum * 24 * 60 * 60 * 1000;
      silenciadoAte = new Date(Date.now() + msToAdd).toISOString();
    }

    const result = await saveIncidentFeedback(
      id,
      String(canal),
      String(tipo),
      String(observacao),
      silenciadoAte,
      csUser
    );

    return NextResponse.json({
      success: true,
      message: silenciadoAte
        ? `Observação registrada e erros silenciados até ${new Date(silenciadoAte).toLocaleDateString("pt-BR")}.`
        : "Observação do CS registrada com sucesso.",
      chave: result.chave,
      feedback: result.feedback,
    });
  } catch (error: any) {
    console.error("❌ [/api/entidades/[id]/feedback-erro] Erro:", error.message);
    return NextResponse.json(
      { success: false, error: error.message || "Falha ao registrar feedback." },
      { status: 500 }
    );
  }
}
