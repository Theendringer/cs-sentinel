import { NextRequest, NextResponse } from "next/server";
import { getMongoDb } from "@/lib/mongodb";
import { firestore, extractCSUser } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/entidades
 * - Consulta todas as empresas no MongoDB (READ-ONLY).
 * - Busca no Firestore a carteira filtrando estritamente por assignedCS.uid == user.uid (ou email).
 * - Retorna isMonitored: true e active: true apenas para as empresas que o analista logado escolheu monitorar.
 */
export async function GET(request: NextRequest) {
  try {
    const csUser = await extractCSUser(request);
    const dbName = process.env.MONGODB_DB_NAME || "hackathon_db";
    console.log(
      `🍃 [MongoDB READ-ONLY] Listando empresas para o CS: ${csUser?.name || "Geral"} (${
        csUser?.email || "sem email"
      })...`
    );

    const db = await getMongoDb();

    // 1. Busca todas as empresas no MongoDB (apenas leitura find().toArray())
    const entidades = await db.collection("entidades").find({}).toArray();

    // 2. Busca registros no Firestore na collection 'monitored_tenants'
    const monitoredMap = new Map<string, any>();

    try {
      const snapshot = await firestore.collection("monitored_tenants").get();

      snapshot.forEach((doc: any) => {
        const data = doc.data();
        const tenantCsUid = data.assignedCS?.uid;
        const tenantCsEmail = data.assignedCS?.email?.toLowerCase();

        // Se o analista estiver identificado, filtra estritamente por ele
        if (csUser) {
          const matchesUid = csUser.uid && tenantCsUid && tenantCsUid === csUser.uid;
          const matchesEmail =
            csUser.email &&
            tenantCsEmail &&
            tenantCsEmail === csUser.email.toLowerCase();

          if (!matchesUid && !matchesEmail) {
            return;
          }
        }

        const rawEntidadeId = data.entidadeId || doc.id;
        const cleanEntidadeId =
          rawEntidadeId.includes("_") && doc.id.length > 24
            ? rawEntidadeId.split("_").pop() || rawEntidadeId
            : rawEntidadeId;

        monitoredMap.set(String(cleanEntidadeId), data);
      });

      console.log(
        `🔥 [Firestore] ${monitoredMap.size} entidade(s) monitorada(s) encontrada(s) na carteira deste analista.`
      );
    } catch (fsErr: any) {
      console.warn(`⚠️ [Firestore] Falha ao ler 'monitored_tenants' (${fsErr.message}).`);
    }

    // 3. Cruzamento em Memória (Node.js) com isolamento de carteira
    const resultado = entidades.map((doc) => {
      const idStr = doc._id ? doc._id.toString() : "";
      const monitoredData = monitoredMap.get(idStr);

      // isMonitored é true apenas se o CS logado estiver monitorando a conta
      const isMonitored = Boolean(monitoredData && monitoredData.active === true);

      const assignedCS = {
        uid: monitoredData?.assignedCS?.uid || csUser?.uid || "cs_default",
        name: monitoredData?.assignedCS?.name || csUser?.name || "Time de CS",
        email: monitoredData?.assignedCS?.email || csUser?.email || "cs@kenit.com.br",
      };

      const thresholds = {
        diasSemAcessoAlerta: Number(monitoredData?.thresholds?.diasSemAcessoAlerta ?? 7),
        maxErros2h: Number(monitoredData?.thresholds?.maxErros2h ?? 5),
        tiposMonitorados: Array.isArray(monitoredData?.thresholds?.tiposMonitorados)
          ? monitoredData.thresholds.tiposMonitorados
          : [],
      };

      return {
        _id: idStr,
        nome: doc.nome || "Entidade Sem Nome",
        status: doc.status !== undefined ? doc.status : "ativo",
        dataCriacao: doc.dataCriacao ? new Date(doc.dataCriacao).toISOString() : null,
        isMonitored,
        active: isMonitored,
        assignedCS,
        thresholds,
      };
    });

    return NextResponse.json({
      success: true,
      total: resultado.length,
      cs: csUser,
      entidades: resultado,
    });
  } catch (error: any) {
    console.error("❌ [/api/entidades] Erro:", error.message);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        entidades: [],
      },
      { status: 500 }
    );
  }
}
