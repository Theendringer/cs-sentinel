import { NextRequest, NextResponse } from "next/server";
import { getMongoDb } from "@/lib/mongodb";
import { getAdminFirestore, extractCSUser } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/entidades
 * - Consulta todas as empresas no MongoDB (READ-ONLY).
 * - Busca no Firestore a carteira filtrando estritamente por assignedCS.uid == user.uid (ou email).
 * - Se Firestore for null ou falhar, devolve a lista das entidades com isMonitored: false e status 200 em formato JSON.
 * - Totalmente resiliente para Serverless na Vercel.
 */
export async function GET(request: NextRequest) {
  try {
    let csUser = null;
    try {
      csUser = await extractCSUser(request);
    } catch (authErr: any) {
      console.warn("⚠️ [Auth CS] Falha ao extrair analista autenticado:", authErr.message);
    }

    console.log(
      `🍃 [MongoDB READ-ONLY] Listando empresas para o CS: ${csUser?.name || "Geral"} (${
        csUser?.email || "sem email"
      })...`
    );

    // 1. Busca todas as empresas no MongoDB (isolado em bloco próprio)
    let entidades: any[] = [];
    try {
      const db = await getMongoDb();
      entidades = await db.collection("entidades").find({}).toArray();
      console.log(`🍃 [MongoDB] ${entidades.length} entidade(s) encontrada(s) no banco.`);
    } catch (mongoErr: any) {
      console.error("❌ [MongoDB Error]:", mongoErr);
      return NextResponse.json(
        { 
          success: false,
          error: "Falha ao conectar ou buscar entidades no MongoDB: " + (mongoErr.message || mongoErr),
          detail: String(mongoErr),
          entidades: [],
        },
        { status: 500 }
      );
    }

    // 2. Busca registros no Firestore na collection 'monitored_tenants' via getAdminFirestore() (isolado)
    const monitoredMap = new Map<string, any>();
    try {
      const firestoreDb = getAdminFirestore();
      if (firestoreDb) {
        const snapshot = await firestoreDb.collection("monitored_tenants").get();

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
      } else {
        console.warn("⚠️ [Firestore] getAdminFirestore() retornou null. Prosseguindo com isMonitored: false.");
      }
    } catch (fsErr: any) {
      console.warn(
        `⚠️ [Firestore Warning] Falha ao ler 'monitored_tenants' (${fsErr.message}). Retornando entidades do Mongo com isMonitored: false.`
      );
    }

    // 3. Cruzamento em Memória (Node.js) com isolamento de carteira
    // Se o Firestore falhou ou o mapa está vazio, todas as entidades são retornadas com isMonitored: false
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
    }, { status: 200 });
  } catch (error: any) {
    console.error('[API /api/entidades crash]:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error.message || 'Erro interno no servidor',
        detail: String(error),
        entidades: [],
      },
      { status: 500 }
    );
  }
}
