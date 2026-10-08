import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "fs";

function getCredentials() {
  const envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (envKey) {
    try {
      let cleaned = envKey.trim();
      if (
        (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
        (cleaned.startsWith("'") && cleaned.endsWith("'"))
      ) {
        cleaned = cleaned.slice(1, -1).trim();
      }

      const jsonStr = cleaned.startsWith("{")
        ? cleaned
        : Buffer.from(cleaned, "base64").toString("utf8");

      const parsed = JSON.parse(jsonStr);
      if (parsed.private_key && typeof parsed.private_key === "string") {
        parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
      }
      return parsed;
    } catch (err) {
      console.error(
        "[Firebase Admin] Erro crítico ao processar FIREBASE_SERVICE_ACCOUNT_KEY:",
        err.message || String(err)
      );
    }
  }

  // Fallback local caso o arquivo exista em ambiente de desenvolvimento
  try {
    const serviceAccountUrl = new URL("./firebase-service-account.json", import.meta.url);
    if (existsSync(serviceAccountUrl)) {
      return JSON.parse(readFileSync(serviceAccountUrl, "utf-8"));
    }
  } catch (fsErr) {
    // ignora se não existir
  }

  return null;
}

export function getAdminFirestore() {
  try {
    if (!getApps().length) {
      const creds = getCredentials();
      if (creds && (creds.project_id || creds.projectId)) {
        initializeApp({
          credential: cert(creds),
          projectId: creds.project_id || creds.projectId,
        });
        console.log(
          `🔥 [Firebase Admin] Inicializado com sucesso para o projeto: "${
            creds.project_id || creds.projectId
          }"`
        );
      } else {
        console.warn(
          "[Firebase Admin] Nenhuma credencial encontrada. Operações com Firestore serão ignoradas."
        );
        return null;
      }
    }
    return getFirestore("(default)");
  } catch (err) {
    console.error("[Firebase Admin] Erro ao obter Firestore:", err.message);
    try {
      return getFirestore();
    } catch {
      return null;
    }
  }
}

// Proxy seguro para o Firestore
export const firestore = new Proxy({}, {
  get(target, prop, receiver) {
    const db = getAdminFirestore();
    if (!db) {
      throw new Error(
        "[Firebase Admin] Firestore indisponível. Verifique a variável FIREBASE_SERVICE_ACCOUNT_KEY."
      );
    }
    const val = Reflect.get(db, prop, receiver);
    return typeof val === "function" ? val.bind(db) : val;
  },
});
export const firestoreDb = firestore; // Alias retrocompatível

/**
 * Consulta a collection 'monitored_tenants' no Firestore onde active == true.
 * Retorna as entidades configuradas para monitoramento pelo time de CS.
 * O MongoDB é estritamente READ-ONLY (telemetria intocável).
 */
export async function getActiveMonitoredTenants() {
  console.log("🔥 [Firestore] Buscando entidades ativas em 'monitored_tenants'...");
  try {
    const snapshot = await firestore
      .collection("monitored_tenants")
      .where("active", "==", true)
      .get();

    const monitoredTenants = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      monitoredTenants.push({
        firestoreDocId: doc.id,
        entidadeId: data.entidadeId || doc.id,
        nome: data.nome || "Entidade Sem Nome",
        assignedCS: data.assignedCS || { name: "Time de CS", email: "cs@kenit.com.br" },
        active: Boolean(data.active),
        thresholds: {
          diasSemAcessoAlerta: Number(data.thresholds?.diasSemAcessoAlerta ?? 7),
          maxErros2h: Number(data.thresholds?.maxErros2h ?? 5),
          tiposMonitorados: Array.isArray(data.thresholds?.tiposMonitorados)
            ? data.thresholds.tiposMonitorados
            : [],
        },
      });
    });

    console.log(`🔥 [Firestore] Encontradas ${monitoredTenants.length} entidades monitoradas ativas.`);
    return monitoredTenants;
  } catch (err) {
    console.error(`❌ [Firestore Query Error] Código: ${err.code || "N/A"} | Detalhe: ${err.message}`);
    if (err.code === 5 || err.message?.includes("NOT_FOUND")) {
      console.warn("⚠️ [Firestore] Banco '(default)' reportou NOT_FOUND no GCP. Verifique a ativação no Firebase Console.");
    }
    return [];
  }
}

/**
 * Gera um ID de documento determinístico para deduplicação no Firestore: ${entidadeId}_${tipoRisco}
 */
export function generateAlertDocId(entidadeId, tipoRisco) {
  const safeId = String(entidadeId || "entidade").trim();
  const safeRisk = String(tipoRisco || "geral")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `${safeId}_${safeRisk}`;
}

/**
 * Salva ou atualiza um alerta disparado na collection 'cs_alerts_history' do Firestore com deduplicação.
 * Persistência exclusiva no Firestore. Proibida qualquer escrita no MongoDB.
 */
export async function saveCSAlertToFirestore(alertData) {
  const entidadeId =
    alertData.entidadeId ||
    alertData.entidadeNome.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const docId = generateAlertDocId(entidadeId, alertData.tipoRisco);
  const docRef = firestore.collection("cs_alerts_history").doc(docId);
  const now = new Date().toISOString();

  try {
    const existingDoc = await docRef.get();

    if (existingDoc.exists) {
      const existingData = existingDoc.data() || {};
      const updatePayload = {
        entidadeId,
        entidadeNome: alertData.entidadeNome,
        csEmail: alertData.csEmail || existingData.csEmail || "cs@kenit.com.br",
        csName: alertData.csName || existingData.csName || "Time de CS",
        tipoRisco: alertData.tipoRisco,
        motivo: alertData.motivo,
        acaoRecomendada: alertData.acaoRecomendada,
        status: "ativo",
        ultimaOcorrencia: now,
        resolvidoEm: null,
        resolvidoMotivo: null,
        origem: alertData.origem || existingData.origem || "cs-agent-sentinel",
        updatedAt: now,
      };

      await docRef.set(updatePayload, { merge: true });
      console.log(`🔄 [Firestore Upsert] Alerta atualizado (ativo) em 'cs_alerts_history' com ID: ${docId}`);
    } else {
      const createPayload = {
        entidadeId,
        entidadeNome: alertData.entidadeNome,
        csEmail: alertData.csEmail || "cs@kenit.com.br",
        csName: alertData.csName || "Time de CS",
        tipoRisco: alertData.tipoRisco,
        motivo: alertData.motivo,
        acaoRecomendada: alertData.acaoRecomendada,
        status: "ativo",
        disparadoEm: alertData.disparadoEm || now,
        ultimaOcorrencia: now,
        resolvidoEm: null,
        resolvidoMotivo: null,
        origem: alertData.origem || "cs-agent-sentinel",
        createdAt: now,
        updatedAt: now,
        firestoreTimestamp: FieldValue.serverTimestamp(),
      };

      await docRef.set(createPayload);
      console.log(`💾 [Firestore Upsert] Novo alerta criado (ativo) em 'cs_alerts_history' com ID: ${docId}`);
    }

    return docId;
  } catch (err) {
    console.error(`❌ [Firestore Alerta Error] Código: ${err.code || "N/A"} | Detalhe: ${err.message}`);
    throw err;
  }
}

/**
 * Marca como 'resolvido' todos os alertas 'ativos' de uma entidade considerada saudável.
 */
export async function resolveTenantAlertsInFirestore(entidadeId, motivo = "Entidade saudável na última auditoria") {
  if (!entidadeId) return 0;

  try {
    const snapshot = await firestore
      .collection("cs_alerts_history")
      .where("entidadeId", "==", String(entidadeId))
      .where("status", "==", "ativo")
      .get();

    if (snapshot.empty) return 0;

    const now = new Date().toISOString();
    const batch = firestore.batch();

    snapshot.forEach((doc) => {
      batch.update(doc.ref, {
        status: "resolvido",
        resolvidoEm: now,
        resolvidoMotivo: motivo,
        updatedAt: now,
      });
    });

    await batch.commit();
    console.log(`✅ [Firestore Resolution] ${snapshot.size} alerta(s) ativo(s) da entidade '${entidadeId}' marcados como resolvidos.`);
    return snapshot.size;
  } catch (err) {
    console.error(`❌ [Firestore Resolution Error] Erro ao resolver alertas de '${entidadeId}':`, err.message);
    return 0;
  }
}
