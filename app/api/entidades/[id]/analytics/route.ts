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
    const csUser = await extractCSUser(request);
    if (!csUser || !csUser.uid || !csUser.email || csUser.uid === "cs_lead_demo") {
      return NextResponse.json(
        { error: "Acesso não autorizado. Faça login primeiro." },
        { status: 401 }
      );
    }

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

    // 2. Consulta de configurações no Firestore (para saber os limiares e tiposMonitorados)
    let monitoringConfig = {
      active: false,
      assignedCS: { name: "Time de CS", email: "cs@kenit.com.br" },
      thresholds: {
        diasSemAcessoAlerta: 7,
        maxErros2h: 5,
        tiposMonitorados: [] as string[],
        gruposMonitoramento: [] as any[],
      },
      incidentFeedback: {} as Record<string, any>,
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
            gruposMonitoramento: Array.isArray(d.thresholds?.gruposMonitoramento)
              ? d.thresholds.gruposMonitoramento
              : [],
          },
          incidentFeedback: d.incidentFeedback || {},
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

    const diasAlerta = monitoringConfig.thresholds.diasSemAcessoAlerta;
    const limiteInatividade = new Date(agora - diasAlerta * 24 * 60 * 60 * 1000);

    // 3. Consulta todos os usuários associados da entidade no MongoDB
    const userQuery = {
      $or: [{ entidade: targetObjectId }, { entidade: id }],
    };

    const usuariosRaw = await db.collection("usuarios").find(userQuery).toArray();

    let usuarioMaisRecente: any = null;
    let dataAcessoMaisRecente: Date | null = null;
    let ativosNoPeriodo = 0;
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

        if (!dataAcessoMaisRecente || dataAcesso > dataAcessoMaisRecente) {
          dataAcessoMaisRecente = dataAcesso;
          usuarioMaisRecente = u;
        }

        if (dataAcesso >= limiteInatividade) {
          ativosNoPeriodo++;
        }

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

    // Cálculo do Último Acesso Geral da Conta
    const diasDesdeUltimoAcessoGlobal = dataAcessoMaisRecente
      ? Math.max(0, Math.floor((agora - dataAcessoMaisRecente.getTime()) / (1000 * 60 * 60 * 24)))
      : null;

    let tempoRelativo = "Nenhum acesso registrado";
    if (diasDesdeUltimoAcessoGlobal !== null) {
      if (diasDesdeUltimoAcessoGlobal === 0) {
        tempoRelativo = "Hoje";
      } else if (diasDesdeUltimoAcessoGlobal === 1) {
        tempoRelativo = "Há 1 dia";
      } else if (diasDesdeUltimoAcessoGlobal > diasAlerta) {
        tempoRelativo = `Sem acessos há ${diasDesdeUltimoAcessoGlobal} dias`;
      } else {
        tempoRelativo = `Há ${diasDesdeUltimoAcessoGlobal} dias`;
      }
    }

    const ultimoAcessoGeral = {
      data: dataAcessoMaisRecente ? dataAcessoMaisRecente.toISOString() : null,
      usuarioNome: usuarioMaisRecente ? (usuarioMaisRecente.nome || "Usuário") : null,
      usuarioEmail: usuarioMaisRecente ? (usuarioMaisRecente.email || null) : null,
      diasSemAcesso: diasDesdeUltimoAcessoGlobal,
      tempoRelativo,
    };

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
        .limit(300)
        .toArray(),
    ]);

    let totalErros2h = countIntegracoes2h;
    let totalErros24h = countIntegracoes24h;
    let amostraMensagens: any[] = [];
    let gruposErros: any[] = [];

    if (countIntegracoes24h > 0) {
      const gruposMap = new Map<string, {
        canal: string;
        tipo: string;
        totalOcorrencias: number;
        ultimaOcorrencia: string;
        resumoMensagem: string;
        amostraRegistros: string[];
        registrosSet: Set<string>;
        itens: Array<{
          mensagem: string;
          data: string;
          tipo: string;
          layoutIntegracao: string;
          tipoIntegracao: string;
          codigoRegistro: string | null;
          requisicaoRetornoData?: any;
        }>;
      }>();

      for (const item of amostraIntegracoes) {
        const canal = item.layoutIntegracao || "Geral";
        const tipo = item.tipoIntegracao || "Geral";
        const chave = `${canal}_${tipo}`;

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

        const dataIso = item.dataCriacao
          ? new Date(item.dataCriacao).toISOString()
          : item.ultimaAtualizacao
          ? new Date(item.ultimaAtualizacao).toISOString()
          : new Date().toISOString();

        const codReg = item.codigoRegistro ? String(item.codigoRegistro) : null;
        const retornoData = item.requisicao?.retorno?.data || null;

        const erroDetalhe = {
          mensagem: msg,
          data: dataIso,
          tipo,
          layoutIntegracao: canal,
          tipoIntegracao: tipo,
          codigoRegistro: codReg,
          requisicaoRetornoData: retornoData,
        };

        let grupo = gruposMap.get(chave);
        if (!grupo) {
          grupo = {
            canal,
            tipo,
            totalOcorrencias: 0,
            ultimaOcorrencia: dataIso,
            resumoMensagem: msg,
            amostraRegistros: [],
            registrosSet: new Set<string>(),
            itens: [],
          };
          gruposMap.set(chave, grupo);
        }

        grupo.totalOcorrencias++;
        grupo.itens.push(erroDetalhe);

        // Atualiza para manter timestamp e mensagem mais recentes
        if (new Date(dataIso) >= new Date(grupo.ultimaOcorrencia)) {
          grupo.ultimaOcorrencia = dataIso;
          grupo.resumoMensagem = msg;
        }

        if (codReg && !grupo.registrosSet.has(codReg)) {
          grupo.registrosSet.add(codReg);
          if (grupo.amostraRegistros.length < 5) {
            grupo.amostraRegistros.push(codReg);
          }
        }
      }

      gruposErros = Array.from(gruposMap.values())
        .map(({ registrosSet, ...resto }) => {
          const chave = `${resto.canal}_${resto.tipo}`;
          const feedback = monitoringConfig.incidentFeedback?.[chave] || null;
          return {
            ...resto,
            feedback,
          };
        })
        .sort((a, b) => {
          if (b.totalOcorrencias !== a.totalOcorrencias) {
            return b.totalOcorrencias - a.totalOcorrencias;
          }
          return new Date(b.ultimaOcorrencia).getTime() - new Date(a.ultimaOcorrencia).getTime();
        });

      amostraMensagens = amostraIntegracoes.slice(0, 10).map((item) => {
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
          requisicaoRetornoData: item.requisicao?.retorno?.data || null,
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
          db.collection("logs_erros").find(legacyQuery24h).sort({ data: -1, timestamp: -1 }).limit(10).toArray(),
          db.collection("erros").find(legacyQuery24h).sort({ data: -1, timestamp: -1 }).limit(10).toArray(),
        ]);

      totalErros2h = countLogs2h + countErros2h;
      totalErros24h = countLogs24h + countErros24h;

      const fallbackItens = [...amostraLogs, ...amostraErros];
      amostraMensagens = fallbackItens.slice(0, 5).map((item) => ({
        mensagem: item.mensagem || item.error || item.status || "Erro interno",
        data: item.data || item.timestamp || new Date().toISOString(),
        tipo: item.tipo || item.statusCode || "Falha",
        layoutIntegracao: "Geral",
        tipoIntegracao: item.tipo || "Geral",
        codigoRegistro: null,
      }));

      if (fallbackItens.length > 0) {
        gruposErros = [
          {
            canal: "Geral",
            tipo: "Sistema",
            totalOcorrencias: totalErros24h,
            ultimaOcorrencia: fallbackItens[0]?.data || fallbackItens[0]?.timestamp || new Date().toISOString(),
            resumoMensagem: fallbackItens[0]?.mensagem || fallbackItens[0]?.error || "Falha técnica no sistema",
            amostraRegistros: [],
            itens: fallbackItens.map((it) => ({
              mensagem: it.mensagem || it.error || it.status || "Erro interno",
              data: it.data || it.timestamp || new Date().toISOString(),
              tipo: it.tipo || "Geral",
              layoutIntegracao: "Geral",
              tipoIntegracao: "Geral",
              codigoRegistro: null,
            })),
          },
        ];
      }
    }

    // 4.1 Avaliação por Grupos de Monitoramento Customizados
    const avaliacaoGrupos: any[] = [];
    const gruposParaAvaliar =
      Array.isArray(monitoringConfig.thresholds.gruposMonitoramento) &&
      monitoringConfig.thresholds.gruposMonitoramento.length > 0
        ? monitoringConfig.thresholds.gruposMonitoramento
        : [
            {
              id: "grupo_padrao",
              nome: "Geral",
              tipos: monitoringConfig.thresholds.tiposMonitorados || [],
              limiteErros: monitoringConfig.thresholds.maxErros2h ?? 5,
              janelaValor: 2,
              janelaUnidade: "horas",
            },
          ];

    for (const g of gruposParaAvaliar) {
      const janelaHoras = g.janelaUnidade === "dias" ? (Number(g.janelaValor) || 1) * 24 : (Number(g.janelaValor) || 2);
      const dataCorte = new Date(agora - janelaHoras * 60 * 60 * 1000);

      const gQuery: any = {
        $and: [
          matchEntidade,
          { status: "pendente" },
          {
            $or: [
              { dataCriacao: { $gte: dataCorte } },
              { ultimaAtualizacao: { $gte: dataCorte } },
              { dataCriacao: { $gte: dataCorte.toISOString() } },
              { ultimaAtualizacao: { $gte: dataCorte.toISOString() } },
            ],
          },
        ],
      };

      if (Array.isArray(g.tipos) && g.tipos.length > 0) {
        const regexList = g.tipos.flatMap((t: string) => {
          const trimmed = t.trim();
          const unaccented = trimmed.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const escapedUnaccented = unaccented.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const list = [new RegExp(`^${escaped}$`, "i")];
          if (escaped.toLowerCase() !== escapedUnaccented.toLowerCase()) {
            list.push(new RegExp(`^${escapedUnaccented}$`, "i"));
          }
          return list;
        });
        gQuery.$and.push({ tipoIntegracao: { $in: regexList } });
      }

      const countG = await db.collection("errosintegracoes").countDocuments(gQuery);
      const violouSLA = countG > Number(g.limiteErros ?? 5);

      avaliacaoGrupos.push({
        id: g.id,
        nome: g.nome || "Grupo",
        tipos: g.tipos || [],
        limiteErros: Number(g.limiteErros ?? 5),
        janelaValor: Number(g.janelaValor ?? 2),
        janelaUnidade: g.janelaUnidade || "horas",
        totalErros: countG,
        violouSLA,
      });
    }

    const gruposViolados = avaliacaoGrupos.filter((g) => g.violouSLA);
    const temViolacaoGrupo = gruposViolados.length > 0;

    // 5. Cálculo do Score de Engajamento e Diagnóstico de Saúde
    const maxErrosPermitidos = monitoringConfig.thresholds.maxErros2h;

    // Regra: Conta é Ativa/Saudável se ao menos 1 usuário vinculou login dentro do período tolerado (diasAlerta)
    const temAoMenosUmUsuarioAtivo =
      dataAcessoMaisRecente !== null &&
      dataAcessoMaisRecente >= limiteInatividade;

    let nivelRisco: "SAUDAVEL" | "CHURN" | "CRITICO" = "SAUDAVEL";
    let statusOperacional = "Operação Saudável";
    let motivo = "Engajamento estável e sem ocorrência de falhas técnicas recentes.";
    let acaoRecomendada = "Manter acompanhamento mensal e rotina regular de Customer Success.";

    let scoreEngajamento = 100;

    if (totalUsuarios === 0) {
      nivelRisco = "SAUDAVEL";
      statusOperacional = "Sem Usuários Cadastrados";
      scoreEngajamento = 100;
      motivo = "Conta recém-criada ou aguardando cadastro dos primeiros membros.";
      acaoRecomendada = "Cadastrar os primeiros usuários da empresa para iniciar o monitoramento de adoção.";
    } else if (temViolacaoGrupo || totalErros2h >= maxErrosPermitidos) {
      nivelRisco = "CRITICO";
      statusOperacional = "Risco Operacional de Integração";
      if (temViolacaoGrupo) {
        motivo = `SLA violado no(s) grupo(s): ${gruposViolados
          .map((g) => `${g.nome} (${g.totalErros}/${g.limiteErros} falhas nas últimas ${g.janelaValor}${g.janelaUnidade === "dias" ? "d" : "h"})`)
          .join(", ")}.`;
      } else {
        motivo = `${totalErros2h} erro(s) de integração pendentes nas últimas 2 horas (limite tolerado: ${maxErrosPermitidos}).`;
      }
      acaoRecomendada =
        "Acionar equipe de suporte e contatar preventivamente o cliente com diagnóstico comercial da integração.";
      scoreEngajamento = Math.max(10, 70 - (temViolacaoGrupo ? gruposViolados.length * 15 : totalErros2h * 10));
    } else if (!temAoMenosUmUsuarioAtivo) {
      // Nova regra: Só classifica como Risco de Churn se NENHUM usuário logou nos últimos X dias
      nivelRisco = "CHURN";
      statusOperacional = "Risco de Churn por Inatividade";
      if (!dataAcessoMaisRecente) {
        motivo = `Nenhum dos ${totalUsuarios} usuários cadastrados realizou login desde o cadastro (limiar de tolerância: ${diasAlerta} dias).`;
        scoreEngajamento = 20;
      } else {
        motivo = `Nenhum usuário acessou a conta nos últimos ${diasAlerta} dias. O último login geral registrado foi há ${diasDesdeUltimoAcessoGlobal} dias (${usuarioMaisRecente?.nome || "usuário"}).`;
        const excesso = Math.max(0, (diasDesdeUltimoAcessoGlobal ?? 0) - diasAlerta);
        scoreEngajamento = Math.max(15, 50 - excesso * 4);
      }
      acaoRecomendada =
        "Executar plano de ativação imediato, contatar pontos focais da empresa e identificar possíveis blockers ou desuso.";
    } else {
      nivelRisco = "SAUDAVEL";
      statusOperacional = "Operação Saudável";
      motivo = `Conta ativa com login recente há ${diasDesdeUltimoAcessoGlobal === 0 ? "menos de 24h" : `${diasDesdeUltimoAcessoGlobal} dia(s)`} por ${usuarioMaisRecente?.nome || "usuário"} e sem falhas técnicas recentes.`;
      acaoRecomendada = "Manter acompanhamento mensal e rotina regular de Customer Success.";
      scoreEngajamento = 100;
      if (totalErros2h > 0) {
        scoreEngajamento = Math.max(0, scoreEngajamento - totalErros2h * 10);
      }
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
        ativosNoPeriodo,
        ativos7d,
        ativos15d,
        ativos30d,
        taxaAdesao7d,
        taxaAdesao30d,
        ultimoAcessoGeral,
        ultimoAcessoMaisRecente: ultimoAcessoGeral,
        erros2h: totalErros2h,
        erros24h: totalErros24h,
        gruposErros,
        avaliacaoGrupos,
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
