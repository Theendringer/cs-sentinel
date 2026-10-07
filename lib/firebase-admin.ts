import { initializeApp, cert, getApps, App } from "firebase-admin/app";
import { getFirestore, FieldValue, Firestore } from "firebase-admin/firestore";
import { getAuth, Auth } from "firebase-admin/auth";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

let firebaseApp: App;

function getServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    } catch (err) {
      console.error("❌ Falha ao fazer parse de FIREBASE_SERVICE_ACCOUNT_KEY:", err);
    }
  }

  // Fallback local caso o arquivo exista em ambiente de desenvolvimento
  const localPath = path.resolve(process.cwd(), "firebase-service-account.json");
  if (fs.existsSync(localPath)) {
    return JSON.parse(fs.readFileSync(localPath, "utf8"));
  }

  throw new Error(
    "Nenhuma credencial do Firebase Admin encontrada (FIREBASE_SERVICE_ACCOUNT_KEY ou arquivo local)."
  );
}

if (!getApps().length) {
  const serviceAccount = getServiceAccount();
  firebaseApp = initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
  console.log(
    `🔥 [Firebase Admin] Inicializado com sucesso para o projeto: "${serviceAccount.project_id}"`
  );
} else {
  firebaseApp = getApps()[0];
}

// Inicialização explícita do Firestore com databaseId '(default)'
export const firestore: Firestore = getFirestore("(default)");
export const adminAuth: Auth = getAuth(firebaseApp);

export function getAdminFirestore(): Firestore {
  return firestore;
}

export interface CSUserFilter {
  uid?: string;
  email?: string;
  name?: string;
}

export interface MonitoredTenant {
  entidadeId: string;
  nome: string;
  active: boolean;
  assignedCS: {
    uid?: string;
    name: string;
    email: string;
  };
  thresholds: {
    diasSemAcessoAlerta: number;
    maxErros2h: number;
    tiposMonitorados?: string[];
  };
  updatedAt?: string;
}

export interface AlertRecord {
  id?: string;
  entidadeId?: string;
  entidadeNome: string;
  csUid?: string;
  csEmail?: string;
  csName?: string;
  assignedCS?: {
    uid?: string;
    name: string;
    email: string;
  };
  tipoRisco: string;
  motivo: string;
  acaoRecomendada: string;
  status: "ativo" | "resolvido";
  disparadoEm: string;
  ultimaOcorrencia?: string;
  resolvidoEm?: string | null;
  resolvidoMotivo?: string | null;
  origem?: string;
  createdAt?: any;
  updatedAt?: any;
}

/**
 * Extrai o analista de CS autenticado a partir de Firebase ID Token, headers ou query parameters.
 */
export async function extractCSUser(
  request: Request | NextRequest,
  explicitData?: { csUid?: string; csEmail?: string; csName?: string; assignedCS?: any }
): Promise<CSUserFilter | null> {
  // 1. Tenta autenticar via Firebase ID Token no header Authorization
  const authHeader =
    request.headers.get("authorization") || request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split("Bearer ")[1].trim();
    if (token && token !== process.env.CRON_SECRET) {
      try {
        const decoded = await adminAuth.verifyIdToken(token);
        if (decoded && (decoded.uid || decoded.email)) {
          return {
            uid: decoded.uid,
            email: decoded.email || explicitData?.csEmail || "cs@kenit.com.br",
            name:
              decoded.name ||
              decoded.email?.split("@")[0] ||
              explicitData?.csName ||
              "Analista de CS",
          };
        }
      } catch {}
    }
  }

  // 2. Extrai de headers customizados enviados pelo frontend (x-cs-uid, x-cs-email)
  const headerUid = request.headers.get("x-cs-uid");
  const headerEmail = request.headers.get("x-cs-email");
  const headerName = request.headers.get("x-cs-name");
  if (headerUid || headerEmail) {
    return {
      uid:
        headerUid ||
        (headerEmail
          ? headerEmail.toLowerCase().replace(/[^a-z0-9]/g, "_")
          : "cs_analyst"),
      email: headerEmail || "cs@kenit.com.br",
      name: headerName || headerEmail?.split("@")[0] || "Analista de CS",
    };
  }

  // 3. Extrai de query parameters (?csUid=...&csEmail=...)
  try {
    const url = new URL(request.url);
    const qUid = url.searchParams.get("csUid");
    const qEmail = url.searchParams.get("csEmail");
    const qName = url.searchParams.get("csName");
    if (qUid || qEmail) {
      return {
        uid:
          qUid ||
          (qEmail
            ? qEmail.toLowerCase().replace(/[^a-z0-9]/g, "_")
            : "cs_analyst"),
        email: qEmail || "cs@kenit.com.br",
        name: qName || qEmail?.split("@")[0] || "Analista de CS",
      };
    }
  } catch {}

  // 4. Extrai de payload explícito enviado no body
  if (explicitData) {
    const bUid = explicitData.csUid || explicitData.assignedCS?.uid;
    const bEmail = explicitData.csEmail || explicitData.assignedCS?.email;
    const bName = explicitData.csName || explicitData.assignedCS?.name;
    if (bUid || bEmail) {
      return {
        uid:
          bUid ||
          (bEmail
            ? bEmail.toLowerCase().replace(/[^a-z0-9]/g, "_")
            : "cs_analyst"),
        email: bEmail || "cs@kenit.com.br",
        name: bName || bEmail?.split("@")[0] || "Analista de CS",
      };
    }
  }

  return null;
}

/**
 * 1. getActiveMonitoredTenants(csFilter?)
 * Consulta a collection 'monitored_tenants' no Firestore onde active == true.
 * Se 'csFilter' for fornecido, filtra estritamente pela carteira do analista de CS (assignedCS.uid ou assignedCS.email).
 * O MongoDB é estritamente READ-ONLY de telemetria.
 */
export async function getActiveMonitoredTenants(
  csFilter?: CSUserFilter
): Promise<MonitoredTenant[]> {
  const monitored: MonitoredTenant[] = [];

  try {
    const snapshot = await firestore
      .collection("monitored_tenants")
      .where("active", "==", true)
      .get();

    snapshot.forEach((doc: any) => {
      const data = doc.data();
      const tenantCsUid = data.assignedCS?.uid;
      const tenantCsEmail = data.assignedCS?.email?.toLowerCase();

      // Filtro por analista de CS logado (se fornecido)
      if (csFilter) {
        const matchesUid = csFilter.uid && tenantCsUid && tenantCsUid === csFilter.uid;
        const matchesEmail =
          csFilter.email &&
          tenantCsEmail &&
          tenantCsEmail === csFilter.email.toLowerCase();

        // Se nenhum dos identificadores bater, ignora o tenant
        if (!matchesUid && !matchesEmail) {
          return;
        }
      }

      // Extrai o entidadeId limpo (remove prefixo ${uid}_ se presente no ID do doc)
      const rawEntidadeId = data.entidadeId || doc.id;
      const cleanEntidadeId = rawEntidadeId.includes("_") && doc.id.length > 24
        ? rawEntidadeId.split("_").pop() || rawEntidadeId
        : rawEntidadeId;

      monitored.push({
        entidadeId: cleanEntidadeId,
        nome: data.nome || "Entidade Sem Nome",
        active: Boolean(data.active),
        assignedCS: {
          uid: data.assignedCS?.uid,
          name: data.assignedCS?.name || "Time de CS",
          email: data.assignedCS?.email || "cs@kenit.com.br",
        },
        thresholds: {
          diasSemAcessoAlerta: Number(data.thresholds?.diasSemAcessoAlerta ?? 7),
          maxErros2h: Number(data.thresholds?.maxErros2h ?? 5),
          tiposMonitorados: Array.isArray(data.thresholds?.tiposMonitorados)
            ? data.thresholds.tiposMonitorados
            : [],
        },
        updatedAt: data.updatedAt,
      });
    });

    console.log(
      `🔥 [Firestore] ${monitored.length} entidade(s) monitorada(s) ativa(s) carregada(s)${
        csFilter ? ` para o CS: ${csFilter.email || csFilter.uid}` : ""
      }.`
    );
  } catch (fsError: any) {
    console.error(`❌ [Firestore] Erro ao consultar 'monitored_tenants':`, fsError.message);
  }

  return monitored;
}

/**
 * 2. upsertMonitoredTenants(tenantsList, csUser?)
 * Salva ou atualiza entidades EXCLUSIVAMENTE no Firestore (collection 'monitored_tenants').
 * Utiliza ${user.uid}_${entidadeId} como ID do documento para garantir isolamento por carteira.
 * PROIBIDA qualquer escrita no MongoDB.
 */
export async function upsertMonitoredTenants(
  tenantsList: MonitoredTenant[],
  csUser?: CSUserFilter
): Promise<{
  success: boolean;
  count: number;
  firestoreSuccess: boolean;
  firestoreError?: string;
}> {
  let firestoreSuccess = false;
  let lastFsErrorMsg = "";

  console.log(`💾 [Firestore Exclusivo] Gravando ${tenantsList.length} registro(s) em 'monitored_tenants'...`);

  try {
    const writes = tenantsList.map(async (tenant) => {
      if (!tenant.entidadeId) return;

      const csUid = csUser?.uid || tenant.assignedCS?.uid || "cs_default";
      const csName = csUser?.name || tenant.assignedCS?.name || "Time de CS";
      const csEmail = csUser?.email || tenant.assignedCS?.email || "cs@kenit.com.br";

      const docData = {
        entidadeId: String(tenant.entidadeId),
        nome: tenant.nome,
        active: Boolean(tenant.active),
        assignedCS: {
          uid: csUid,
          name: csName,
          email: csEmail,
        },
        thresholds: {
          diasSemAcessoAlerta: Number(tenant.thresholds?.diasSemAcessoAlerta ?? 7),
          maxErros2h: Number(tenant.thresholds?.maxErros2h ?? 5),
          tiposMonitorados: Array.isArray(tenant.thresholds?.tiposMonitorados)
            ? tenant.thresholds.tiposMonitorados
            : [],
        },
        updatedAt: new Date().toISOString(),
      };

      // ID do documento com vínculo do analista: ${user.uid}_${entidadeId}
      const docId = `${csUid}_${tenant.entidadeId}`;
      const docRef = firestore.collection("monitored_tenants").doc(docId);
      await docRef.set(docData, { merge: true });
      console.log(
        `🔥 [Firestore] Documento gravado com ID '${docId}': active=${docData.active} | CS: ${csName} (${csEmail})`
      );
    });

    await Promise.all(writes);
    firestoreSuccess = true;
    console.log(`✅ [Firestore] Gravação concluída com sucesso na collection 'monitored_tenants'.`);
  } catch (fsError: any) {
    lastFsErrorMsg = fsError.message || "indisponível";
    console.error(`❌ [Firestore Detail Error] Erro ao gravar: ${lastFsErrorMsg}`);
  }

  return {
    success: firestoreSuccess,
    count: tenantsList.length,
    firestoreSuccess,
    firestoreError: lastFsErrorMsg || undefined,
  };
}

/**
 * Gera um ID de documento determinístico para deduplicação no Firestore: ${csUid}_${entidadeId}_${tipoRisco}
 */
export function generateAlertDocId(
  entidadeId: string,
  tipoRisco: string,
  csUid?: string
): string {
  const safeId = (entidadeId || "entidade").trim();
  const safeRisk = (tipoRisco || "geral")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const prefix = csUid ? `${csUid.trim()}_` : "";
  return `${prefix}${safeId}_${safeRisk}`;
}

/**
 * 3. getAlertsHistory(limitCount, csFilter?)
 * Retorna histórico de alertas do Firestore, filtrando por analista de CS (assignedCS.uid ou assignedCS.email).
 */
export async function getAlertsHistory(
  limitCount: number = 50,
  csFilter?: CSUserFilter
): Promise<AlertRecord[]> {
  const alerts: AlertRecord[] = [];

  try {
    const snapshot = await firestore
      .collection("cs_alerts_history")
      .limit(limitCount * 3)
      .get();

    snapshot.forEach((doc: any) => {
      const data = doc.data();
      const alertCsUid = data.csUid || data.assignedCS?.uid;
      const alertCsEmail = (data.csEmail || data.assignedCS?.email || "").toLowerCase();

      // Filtragem por analista de CS (se fornecido)
      if (csFilter) {
        const matchesUid = csFilter.uid && alertCsUid && alertCsUid === csFilter.uid;
        const matchesEmail =
          csFilter.email &&
          alertCsEmail &&
          alertCsEmail === csFilter.email.toLowerCase();

        if (!matchesUid && !matchesEmail) {
          return;
        }
      }

      alerts.push({
        id: doc.id,
        entidadeId: data.entidadeId,
        entidadeNome: data.entidadeNome || "Entidade",
        csUid: alertCsUid,
        csEmail: data.csEmail || data.assignedCS?.email,
        csName: data.csName || data.assignedCS?.name,
        assignedCS: {
          uid: alertCsUid,
          name: data.csName || data.assignedCS?.name || "Time de CS",
          email: data.csEmail || data.assignedCS?.email || "cs@kenit.com.br",
        },
        tipoRisco: data.tipoRisco || "RISCO NÃO ESPECIFICADO",
        motivo: data.motivo || "",
        acaoRecomendada: data.acaoRecomendada || "",
        status: data.status === "resolvido" ? "resolvido" : "ativo",
        disparadoEm: data.disparadoEm || data.createdAt || new Date().toISOString(),
        ultimaOcorrencia: data.ultimaOcorrencia || data.disparadoEm || new Date().toISOString(),
        resolvidoEm: data.resolvidoEm || null,
        resolvidoMotivo: data.resolvidoMotivo || null,
        origem: data.origem || "cs-agent-sentinel",
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    });

    // Ordenação decrescente pela última ocorrência
    alerts.sort((a, b) => {
      const dateA = new Date(a.ultimaOcorrencia || a.disparadoEm).getTime();
      const dateB = new Date(b.ultimaOcorrencia || b.disparadoEm).getTime();
      return dateB - dateA;
    });
  } catch (error: any) {
    console.warn("⚠️ [Firestore] Falha ao consultar 'cs_alerts_history':", error.message);
  }

  return alerts.slice(0, limitCount);
}

/**
 * 4. saveCSAlert(alertData)
 * Persiste ou atualiza um alerta com deduplicação determinística no Firestore ('cs_alerts_history').
 * Utiliza doc(`${csUid}_${entidadeId}_${tipoRisco}`).set({ ... }, { merge: true }).
 * Mantém status='ativo' e atualiza ultimaOcorrencia.
 */
export async function saveCSAlert(
  alertData: Partial<AlertRecord> & {
    entidadeNome: string;
    tipoRisco: string;
    motivo: string;
    acaoRecomendada: string;
    csUid?: string;
  },
  explicitCsUid?: string
): Promise<string> {
  const entidadeId =
    alertData.entidadeId ||
    alertData.entidadeNome.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const csUid = explicitCsUid || alertData.csUid || alertData.assignedCS?.uid;
  const docId = generateAlertDocId(entidadeId, alertData.tipoRisco, csUid);
  const docRef = firestore.collection("cs_alerts_history").doc(docId);

  const now = new Date().toISOString();
  const csName = alertData.csName || alertData.assignedCS?.name || "Time de CS";
  const csEmail = alertData.csEmail || alertData.assignedCS?.email || "cs@kenit.com.br";

  try {
    const existingDoc = await docRef.get();

    if (existingDoc.exists) {
      const existingData = existingDoc.data() || {};
      const updatePayload = {
        entidadeId,
        entidadeNome: alertData.entidadeNome,
        csUid: csUid || existingData.csUid,
        csEmail: csEmail || existingData.csEmail || "cs@kenit.com.br",
        csName: csName || existingData.csName || "Time de CS",
        assignedCS: {
          uid: csUid || existingData.csUid,
          name: csName || existingData.csName || "Time de CS",
          email: csEmail || existingData.csEmail || "cs@kenit.com.br",
        },
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
      console.log(
        `🔄 [Firestore Upsert] Alerta atualizado (ativo) em 'cs_alerts_history' com ID '${docId}'.`
      );
    } else {
      const createPayload = {
        entidadeId,
        entidadeNome: alertData.entidadeNome,
        csUid,
        csEmail,
        csName,
        assignedCS: {
          uid: csUid,
          name: csName,
          email: csEmail,
        },
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
      console.log(
        `💾 [Firestore Upsert] Novo alerta criado (ativo) em 'cs_alerts_history' com ID '${docId}'.`
      );
    }

    return docId;
  } catch (fsErr: any) {
    console.error(
      `❌ [Firestore] Falha ao persistir alerta em 'cs_alerts_history':`,
      fsErr.message
    );
    throw fsErr;
  }
}

/**
 * 5. resolveTenantAlerts(entidadeId, motivo, csUid?)
 * Marca como 'resolvido' todos os alertas 'ativos' de uma entidade considerada saudável.
 */
export async function resolveTenantAlerts(
  entidadeId: string,
  motivo: string = "Entidade saudável na última auditoria",
  csUid?: string
): Promise<number> {
  if (!entidadeId) return 0;

  try {
    const query = firestore
      .collection("cs_alerts_history")
      .where("entidadeId", "==", entidadeId)
      .where("status", "==", "ativo");

    const snapshot = await query.get();

    if (snapshot.empty) {
      return 0;
    }

    const now = new Date().toISOString();
    const batch = firestore.batch();
    let count = 0;

    snapshot.forEach((doc) => {
      const data = doc.data();
      if (csUid) {
        const docCsUid = data.csUid || data.assignedCS?.uid;
        if (docCsUid && docCsUid !== csUid) {
          return;
        }
      }
      batch.update(doc.ref, {
        status: "resolvido",
        resolvidoEm: now,
        resolvidoMotivo: motivo,
        updatedAt: now,
      });
      count++;
    });

    if (count > 0) {
      await batch.commit();
      console.log(
        `✅ [Firestore Resolution] ${count} alerta(s) ativo(s) da entidade '${entidadeId}' marcados como resolvidos.`
      );
    }
    return count;
  } catch (err: any) {
    console.error(
      `❌ [Firestore Resolution Error] Erro ao resolver alertas de '${entidadeId}':`,
      err.message
    );
    return 0;
  }
}
