import { MongoClient, Db, ObjectId } from "mongodb";

const defaultDbName = "hackathon_db";

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

/**
 * Obtém ou inicializa a Promise de conexão do MongoClient com cache global.
 */
function getClientPromise(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "Variável de ambiente MONGODB_URI não configurada no servidor. Configure MONGODB_URI nas variáveis da Vercel."
    );
  }

  if (!global._mongoClientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 10000,
    });
    global._mongoClientPromise = client.connect();
  }

  return global._mongoClientPromise;
}

/**
 * Obtém a instância conectada do banco de dados MongoDB
 */
export async function getMongoDb(): Promise<Db> {
  const dbName = process.env.MONGODB_DB_NAME || defaultDbName;
  const connectedClient = await getClientPromise();
  return connectedClient.db(dbName);
}

export { ObjectId };

export interface ErroGrupoResumo {
  layoutIntegracao: string;
  tipoIntegracao: string;
  totalErros: number;
  codigosAfetados: string[];
  amostraMensagens: string[];
  detalheRequisicao?: any;
}

export interface TenantHealthResult {
  entidadeId: string;
  nomeEntidade: string;
  totalUsuariosCadastrados: number;
  usuariosAtivosNoPeriodo: number;
  totalUsuariosInativos: number;
  usuariosInativos: Array<{
    nome: string;
    email: string;
    ultimoAcesso: string;
    diasSemAcesso: number | string;
  }>;
  errosRecentesUltimas2h: number;
  amostraErros: string[];
  gruposErros?: ErroGrupoResumo[];
  tiposMonitoradosFiltrados?: string[];
  periodoDiasAnalise: number;
}

/**
 * Normaliza um tipo de erro para regex case-insensitive e tolerante a acentuação
 */
function buildTipoIntegracaoRegex(tipo: string): RegExp[] {
  const trimmed = tipo.trim();
  const unaccented = trimmed.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedUnaccented = unaccented.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const regexes = [new RegExp(`^${escaped}$`, "i")];
  if (escaped.toLowerCase() !== escapedUnaccented.toLowerCase()) {
    regexes.push(new RegExp(`^${escapedUnaccented}$`, "i"));
  }
  return regexes;
}

/**
 * Executa a auditoria de telemetria no MongoDB convertendo entidadeId para ObjectId
 * e consultando erros na collection 'errosintegracoes' com agrupamento por canal e tipo.
 */
export async function checkTenantHealthMetrics(
  entidadeId: string,
  diasSemAcesso: number = 7,
  tiposMonitorados?: string[]
): Promise<TenantHealthResult | { error: string }> {
  try {
    const db = await getMongoDb();

    // Conversão obrigatória da string entidadeId para new ObjectId(entidadeId)
    let targetObjectId: ObjectId;
    try {
      targetObjectId = new ObjectId(entidadeId);
    } catch {
      return { error: `ID inválido fornecido: '${entidadeId}'. Esperado formato ObjectId de 24 hex.` };
    }

    const agora = Date.now();
    const limiteDias = Number(diasSemAcesso) || 7;
    const limiteInatividade = new Date(agora - limiteDias * 24 * 60 * 60 * 1000);
    const duasHorasAtras = new Date(agora - 2 * 60 * 60 * 1000);

    // 1. Busca nome da entidade para conferência humana
    const entidadeDoc = await db.collection("entidades").findOne({ _id: targetObjectId });
    const nomeEntidade = entidadeDoc ? String(entidadeDoc.nome) : "Entidade Desconhecida";

    // 2. Consulta Usuários no MongoDB (collection: usuarios)
    const usuarios = await db.collection("usuarios").find({ entidade: targetObjectId }).toArray();
    const totalUsuarios = usuarios.length;

    const ativos: any[] = [];
    const inativos: any[] = [];

    for (const u of usuarios) {
      const dataAcesso = u.ultimoAcesso ? new Date(u.ultimoAcesso) : null;
      const isAtivo = dataAcesso && dataAcesso >= limiteInatividade;

      if (isAtivo) {
        ativos.push(u);
      } else {
        const diasInativo = dataAcesso
          ? Math.floor((agora - dataAcesso.getTime()) / (1000 * 60 * 60 * 24))
          : "Nunca acessou";

        inativos.push({
          nome: u.nome || "Usuário",
          email: u.email || "Sem e-mail",
          ultimoAcesso: dataAcesso ? dataAcesso.toISOString() : "Nunca acessou",
          diasSemAcesso: diasInativo,
        });
      }
    }

    // 3. Consulta de Erros na collection 'errosintegracoes' (Read-Only)
    const errorQuery: any = {
      entidade: targetObjectId,
      status: "pendente",
      $or: [
        { dataCriacao: { $gte: duasHorasAtras } },
        { ultimaAtualizacao: { $gte: duasHorasAtras } },
        { dataCriacao: { $gte: duasHorasAtras.toISOString() } },
        { ultimaAtualizacao: { $gte: duasHorasAtras.toISOString() } },
      ],
    };

    // Se houver tipos configurados no Firestore, adiciona o filtro normalizado case-insensitive
    const tiposAtivos = Array.isArray(tiposMonitorados)
      ? tiposMonitorados.filter((t) => typeof t === "string" && t.trim().length > 0)
      : [];

    if (tiposAtivos.length > 0) {
      const regexList = tiposAtivos.flatMap(buildTipoIntegracaoRegex);
      errorQuery.tipoIntegracao = { $in: regexList };
    }

    // Projeta apenas os campos essenciais: layoutIntegracao, tipoIntegracao, codigoRegistro, mensagens.texto, requisicao.retorno.data
    const projection = {
      layoutIntegracao: 1,
      tipoIntegracao: 1,
      codigoRegistro: 1,
      "mensagens.texto": 1,
      "mensagens.tipo": 1,
      "requisicao.retorno.data": 1,
      dataCriacao: 1,
      ultimaAtualizacao: 1,
    };

    const errosDocs = await db
      .collection("errosintegracoes")
      .find(errorQuery, { projection })
      .sort({ dataCriacao: -1, ultimaAtualizacao: -1 })
      .limit(300)
      .toArray();

    let totalErros2h = errosDocs.length;
    let gruposErros: ErroGrupoResumo[] = [];
    let mensagensErros: string[] = [];

    if (errosDocs.length > 0) {
      // Agrupa os erros em memória por layoutIntegracao + tipoIntegracao
      const gruposMap = new Map<string, {
        layoutIntegracao: string;
        tipoIntegracao: string;
        totalErros: number;
        codigosAfetados: Set<string>;
        amostraMensagens: Set<string>;
        detalheRequisicao?: any;
      }>();

      for (const doc of errosDocs) {
        const canal = doc.layoutIntegracao || "Geral";
        const tipo = doc.tipoIntegracao || "Integracao";
        const chave = `${canal}__${tipo}`.toLowerCase();

        let grupo = gruposMap.get(chave);
        if (!grupo) {
          grupo = {
            layoutIntegracao: canal,
            tipoIntegracao: tipo,
            totalErros: 0,
            codigosAfetados: new Set<string>(),
            amostraMensagens: new Set<string>(),
          };
          gruposMap.set(chave, grupo);
        }

        grupo.totalErros++;

        if (doc.codigoRegistro && grupo.codigosAfetados.size < 5) {
          grupo.codigosAfetados.add(String(doc.codigoRegistro));
        }

        // Extrai mensagens de erro (amostra de 2 a 3 por padrão recorrente)
        if (Array.isArray(doc.mensagens)) {
          for (const m of doc.mensagens) {
            const txt = typeof m === "string" ? m : m?.texto;
            if (txt && grupo.amostraMensagens.size < 3) {
              grupo.amostraMensagens.add(String(txt).trim());
            }
          }
        }

        // Se mensagens estava vazio, busca dados de retorno bruto da API
        if (grupo.amostraMensagens.size < 3 && doc.requisicao?.retorno?.data) {
          const retStr =
            typeof doc.requisicao.retorno.data === "string"
              ? doc.requisicao.retorno.data
              : JSON.stringify(doc.requisicao.retorno.data).slice(0, 160);
          grupo.amostraMensagens.add(retStr);
        }

        if (!grupo.detalheRequisicao && doc.requisicao?.retorno?.data) {
          grupo.detalheRequisicao =
            typeof doc.requisicao.retorno.data === "object"
              ? JSON.stringify(doc.requisicao.retorno.data).slice(0, 200)
              : String(doc.requisicao.retorno.data).slice(0, 200);
        }
      }

      gruposErros = Array.from(gruposMap.values()).map((g) => ({
        layoutIntegracao: g.layoutIntegracao,
        tipoIntegracao: g.tipoIntegracao,
        totalErros: g.totalErros,
        codigosAfetados: Array.from(g.codigosAfetados),
        amostraMensagens: Array.from(g.amostraMensagens),
        detalheRequisicao: g.detalheRequisicao,
      }));

      for (const g of gruposErros) {
        for (const msg of g.amostraMensagens) {
          if (mensagensErros.length < 5) {
            mensagensErros.push(`[${g.layoutIntegracao} | ${g.tipoIntegracao}] ${msg}`);
          }
        }
      }
    } else {
      // Fallback para coleções legadas (logs_erros / erros) se errosintegracoes não tiver registros para essa entidade
      const legacyQuery = {
        entidade: targetObjectId,
        $or: [
          { data: { $gte: duasHorasAtras } },
          { timestamp: { $gte: duasHorasAtras } },
        ],
      };

      const [countLogsErros, countErros, amostraLogs, amostraErrosLegacy] = await Promise.all([
        db.collection("logs_erros").countDocuments(legacyQuery),
        db.collection("erros").countDocuments(legacyQuery),
        db.collection("logs_erros").find(legacyQuery).sort({ data: -1, timestamp: -1 }).limit(3).toArray(),
        db.collection("erros").find(legacyQuery).sort({ data: -1, timestamp: -1 }).limit(3).toArray(),
      ]);

      totalErros2h = countLogsErros + countErros;
      mensagensErros = [...amostraLogs, ...amostraErrosLegacy]
        .slice(0, 3)
        .map((e) => e.mensagem || e.status || e.error || "Erro registrado");
    }

    return {
      entidadeId,
      nomeEntidade,
      totalUsuariosCadastrados: totalUsuarios,
      usuariosAtivosNoPeriodo: ativos.length,
      totalUsuariosInativos: inativos.length,
      usuariosInativos: inativos.slice(0, 5),
      errosRecentesUltimas2h: totalErros2h,
      amostraErros: mensagensErros,
      gruposErros,
      tiposMonitoradosFiltrados: tiposAtivos,
      periodoDiasAnalise: limiteDias,
    };
  } catch (error: any) {
    console.error(`❌ [MongoDB] Erro ao auditar entidade ${entidadeId}:`, error.message);
    return { error: error.message };
  }
}
