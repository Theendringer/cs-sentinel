import { NextRequest, NextResponse } from "next/server";
import { getMongoDb, ObjectId } from "@/lib/mongodb";
import { getAdminFirestore, extractCSUser } from "@/lib/firebase-admin";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * GET /api/entidades/[id]/analytics
 * Retorna diagnóstico sob demanda e telemetria profunda da entidade no MongoDB.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json(
        { success: false, error: "ID de entidade inválido (esperado 24 caracteres hexadecimais)." },
        { status: 400 }
      );
    }

    const targetObjectId = new ObjectId(id);
    const db = await getMongoDb();

    // 1. Consulta dados cadastrais da empresa no MongoDB
    const entidadeDoc = await db.collection("entidades").findOne({ _id: targetObjectId });

    if (!entidadeDoc) {
      return NextResponse.json(
        { success: false, error: "Entidade não encontrada no MongoDB." },
        { status: 404 }
      );
    }

    const agora = Date.now();
    const seteDiasAtras = new Date(agora - 7 * 24 * 60 * 60 * 1000);
    const quinzeDiasAtras = new Date(agora - 15 * 24 * 60 * 60 * 1000);
    const trintaDiasAtras = new Date(agora - 30 * 24 * 60 * 60 * 1000);
    const duasHorasAtras = new Date(agora - 2 * 60 * 60 * 1000);
    const vinteQuatroHorasAtras = new Date(agora - 24 * 60 * 60 * 1000);

    // 2. Consulta todos os usuários associados
    const userQuery = {
      $or: [{ entidade: targetObjectId }, { entidade: id }],
    };

    const usuariosRaw = await db.collection("usuarios").find(userQuery).toArray();

    let ativos7d = 0;
    let ativos15d = 0;
    let ativos30d = 0;

    const listaUsuarios = usuariosRaw.map((u) => {
      const dataAcesso = u.ultimoAcesso ? new Date(u.ultimoAcesso) : null;
      let diasSemAcesso: number | string = "Nunca acessou";
      let statusAcesso: "recente" | "moderado" | "inativo" = "inativo";

      if (dataAcesso && !isNaN(dataAcesso.getTime())) {
        const diffMs = agora - dataAcesso.getTime();
        diasSemAcesso = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

        if (dataAcesso >= seteDiasAtras) {
          ativos7d++;
          ativos15d++;
          ativos30d++;
          statusAcesso = "recente";
        } else if (dataAcesso >= quinzeDiasAtras) {
          ativos15d++;
          ativos30d++;
          statusAcesso = "moderado";
        } else if (dataAcesso >= trintaDiasAtras) {
          ativos30d++;
          statusAcesso = "inativo";
        }
      }

      return {
        _id: u._id.toString(),
        nome: u.nome || "Usuário sem nome",
        email: u.email || "Sem e-mail cadastrado",
        cargo: u.cargo || u.role || "Membro",
        ultimoAcesso: dataAcesso ? dataAcesso.toISOString() : null,
        diasSemAcesso,
        statusAcesso,
      };
    });

    const totalUsuarios = listaUsuarios.length;
    const taxaAdesao7d = totalUsuarios > 0 ? Math.round((ativos7d / totalUsuarios) * 100) : 0;
    const taxaAdesao30d = totalUsuarios > 0 ? Math.round((ativos30d / totalUsuarios) * 100) : 0;

    // 3. Consulta de configurações no Firestore (para saber os tiposMonitorados configurados)
    let monitoringConfig = {
      active: false,
      assignedCS: { name: "Time de CS", email: "cs@kenit.com.br" },
      thresholds: {
        diasSemAcessoAlerta: 7,
        maxErros2h: 5,
        tiposMonitorados: [] as string[],
      },
    };

    try {
      const csUser = await extractCSUser(request);
      const firestoreDb = getAdminFirestore();

      // Busca primeiro pelo documento isolado do analista: ${csUser.uid}_${id}
      let docSnap: any = null;
      if (firestoreDb) {
        if (csUser?.uid) {
          docSnap = await firestoreDb.collection("monitored_tenants").doc(`${csUser.uid}_${id}`).get();
        }

        // Se não encontrou, busca pelo docId tradicional ou por query
        if (!docSnap || !docSnap.exists) {
          docSnap = await firestoreDb.collection("monitored_tenants").doc(id).get();
        }
      }

      if (docSnap && docSnap.exists) {
        const d = docSnap.data();
        monitoringConfig = {
          active: Boolean(d.active),
          assignedCS: {
            name: d.assignedCS?.name || csUser?.name || "Time de CS",
            email: d.assignedCS?.email || csUser?.email || "cs@kenit.com.br",
          },
          thresholds: {
            diasSemAcessoAlerta: Number(d.thresholds?.diasSemAcessoAlerta ?? 7),
            maxErros2h: Number(d.thresholds?.maxErros2h ?? 5),
            tiposMonitorados: Array.isArray(d.thresholds?.tiposMonitorados)
              ? d.thresholds.tiposMonitorados
              : [],
          },
        };
      } else if (csUser) {
        monitoringConfig.assignedCS = {
          name: csUser.name,
          email: csUser.email,
        };
      }
    } catch (fsErr: any) {
      console.warn(`⚠️ [Firestore] Não foi possível ler regras para a conta ${id}:`, fsErr.message);
    }

    // 4. Histórico de erros na collection 'errosintegracoes' (Read-Only)
    const matchEntidade = { $or: [{ entidade: targetObjectId }, { entidade: id }] };

    const queryIntegracoes2h: any = {
      $and: [
        matchEntidade,
        { status: "pendente" },
        {
          $or: [
            { dataCriacao: { $gte: duasHorasAtras } },
            { ultimaAtualizacao: { $gte: duasHorasAtras } },
            { dataCriacao: { $gte: duasHorasAtras.toISOString() } },
            { ultimaAtualizacao: { $gte: duasHorasAtras.toISOString() } },
          ],
        },
      ],
    };

    const queryIntegracoes24h: any = {
      $and: [
        matchEntidade,
        { status: "pendente" },
        {
          $or: [
            { dataCriacao: { $gte: vinteQuatroHorasAtras } },
            { ultimaAtualizacao: { $gte: vinteQuatroHorasAtras } },
            { dataCriacao: { $gte: vinteQuatroHorasAtras.toISOString() } },
            { ultimaAtualizacao: { $gte: vinteQuatroHorasAtras.toISOString() } },
          ],
        },
      ],
    };

    // Aplica filtro de tiposMonitorados se configurado
    const tiposAtivos = monitoringConfig.thresholds.tiposMonitorados.filter(
      (t) => typeof t === "string" && t.trim().length > 0
    );

    if (tiposAtivos.length > 0) {
      const regexList = tiposAtivos.flatMap((tipo) => {
        const trimmed = tipo.trim();
        const unaccented = trimmed.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const escapedUnaccented = unaccented.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const list = [new RegExp(`^${escaped}$`, "i")];
        if (escaped.toLowerCase() !== escapedUnaccented.toLowerCase()) {
          list.push(new RegExp(`^${escapedUnaccented}$`, "i"));
        }
        return list;
      });
      queryIntegracoes2h.$and.push({ tipoIntegracao: { $in: regexList } });
      queryIntegracoes24h.$and.push({ tipoIntegracao: { $in: regexList } });
    }

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

    const [countIntegracoes2h, countIntegracoes24h, amostraIntegracoes] = await Promise.all([
      db.collection("errosintegracoes").countDocuments(queryIntegracoes2h),
      db.collection("errosintegracoes").countDocuments(queryIntegracoes24h),
      db
        .collection("errosintegracoes")
        .find(queryIntegracoes24h, { projection })
        .sort({ dataCriacao: -1, ultimaAtualizacao: -1 })
        .limit(10)
        .toArray(),
    ]);

    let totalErros2h = countIntegracoes2h;
    let totalErros24h = countIntegracoes24h;
    let amostraMensagens: any[] = [];

    if (countIntegracoes24h > 0) {
      amostraMensagens = amostraIntegracoes.map((item) => {
        let msg = "";
        if (Array.isArray(item.mensagens) && item.mensagens.length > 0) {
          const first = item.mensagens[0];
          msg = typeof first === "string" ? first : first?.texto || "";
        }
        if (!msg && item.requisicao?.retorno?.data) {
          msg =
            typeof item.requisicao.retorno.data === "string"
              ? item.requisicao.retorno.data
              : JSON.stringify(item.requisicao.retorno.data).slice(0, 160);
        }
        if (!msg) msg = "Falha de integração registrada";

        return {
          mensagem: msg,
          data: item.dataCriacao || item.ultimaAtualizacao || new Date().toISOString(),
          tipo: item.tipoIntegracao || "Geral",
          layoutIntegracao: item.layoutIntegracao || "Geral",
          tipoIntegracao: item.tipoIntegracao || "Geral",
          codigoRegistro: item.codigoRegistro || null,
        };
      });
    } else {
      // Fallback legado para coleções de teste logs_erros e erros
      const legacyQuery2h = {
        $and: [
          matchEntidade,
          {
            $or: [
              { data: { $gte: duasHorasAtras } },
              { timestamp: { $gte: duasHorasAtras } },
            ],
          },
        ],
      };

      const legacyQuery24h = {
        $and: [
          matchEntidade,
          {
            $or: [
              { data: { $gte: vinteQuatroHorasAtras } },
              { timestamp: { $gte: vinteQuatroHorasAtras } },
            ],
          },
        ],
      };

      const [countLogs2h, countErros2h, countLogs24h, countErros24h, amostraLogs, amostraErros] =
        await Promise.all([
          db.collection("logs_erros").countDocuments(legacyQuery2h),
          db.collection("erros").countDocuments(legacyQuery2h),
          db.collection("logs_erros").countDocuments(legacyQuery24h),
          db.collection("erros").countDocuments(legacyQuery24h),
          db.collection("logs_erros").find(legacyQuery24h).sort({ data: -1, timestamp: -1 }).limit(3).toArray(),
          db.collection("erros").find(legacyQuery24h).sort({ data: -1, timestamp: -1 }).limit(3).toArray(),
        ]);

      totalErros2h = countLogs2h + countErros2h;
      totalErros24h = countLogs24h + countErros24h;

      amostraMensagens = [...amostraLogs, ...amostraErros].slice(0, 5).map((item) => ({
        mensagem: item.mensagem || item.error || item.status || "Erro interno",
        data: item.data || item.timestamp || new Date().toISOString(),
        tipo: item.tipo || item.statusCode || "Falha",
        layoutIntegracao: "Geral",
        tipoIntegracao: item.tipo || "Geral",
        codigoRegistro: null,
      }));
    }

    // 5. Cálculo do Score de Engajamento e Diagnóstico de Saúde
    let scoreEngajamento = totalUsuarios > 0 ? taxaAdesao7d : 100;
    if (totalErros2h > 0) {
      scoreEngajamento = Math.max(0, scoreEngajamento - totalErros2h * 10);
    }

    let nivelRisco: "SAUDAVEL" | "CHURN" | "CRITICO" = "SAUDAVEL";
    let statusOperacional = "Operação Saudável";
    let motivo = "Engajamento estável e sem ocorrência de falhas técnicas recentes.";
    let acaoRecomendada = "Manter acompanhamento mensal e rotina regular de Customer Success.";

    const maxErrosPermitidos = monitoringConfig.thresholds.maxErros2h;
    const diasAlerta = monitoringConfig.thresholds.diasSemAcessoAlerta;

    if (totalUsuarios === 0) {
      nivelRisco = "SAUDAVEL";
      statusOperacional = "Sem Usuários Cadastrados";
      scoreEngajamento = 100;
      motivo = "Conta recém-criada ou aguardando cadastro dos primeiros membros.";
      acaoRecomendada = "Cadastrar os primeiros usuários da empresa para iniciar o monitoramento de adoção.";
    } else if (totalErros2h >= maxErrosPermitidos) {
      nivelRisco = "CRITICO";
      statusOperacional = "Risco Operacional de Integração";
      motivo = `${totalErros2h} erro(s) de integração pendentes nas últimas 2 horas (limite tolerado: ${maxErrosPermitidos}).`;
      acaoRecomendada =
        "Acionar equipe de suporte e contatar preventivamente o cliente com diagnóstico comercial da integração.";
    } else if (ativos7d === 0 || taxaAdesao7d < 30) {
      nivelRisco = "CHURN";
      statusOperacional = "Risco de Churn / Desengajamento";
      motivo = `${totalUsuarios - ativos7d} de ${totalUsuarios} usuários sem acesso nos últimos ${diasAlerta} dias (${taxaAdesao7d}% de adesão semanal).`;
      acaoRecomendada =
        "Executar plano de ativação imediato, reagendar treinamento e identificar blockers de adoção.";
    }

    return NextResponse.json({
      success: true,
      entidade: {
        _id: id,
        nome: entidadeDoc.nome || "Entidade Sem Nome",
        status: entidadeDoc.status !== undefined ? entidadeDoc.status : "ativo",
        dataCriacao: entidadeDoc.dataCriacao || null,
        segmento: entidadeDoc.segmento || "Enterprise SaaS",
        plano: entidadeDoc.plano || "Enterprise",
      },
      analytics: {
        totalUsuarios,
        ativos7d,
        ativos15d,
        ativos30d,
        taxaAdesao7d,
        taxaAdesao30d,
        erros2h: totalErros2h,
        erros24h: totalErros24h,
        amostraErros: amostraMensagens,
        usuarios: listaUsuarios,
        saude: {
          scoreEngajamento,
          nivelRisco,
          statusOperacional,
          motivo,
          acaoRecomendada,
        },
        monitoring: monitoringConfig,
      },
    });
  } catch (error: any) {
    console.error("❌ [/api/entidades/[id]/analytics] Erro:", error.message);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
