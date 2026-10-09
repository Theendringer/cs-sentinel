"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { clientAuth } from "@/lib/firebase-client";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  LayoutDashboard,
  Search,
  Building2,
  Users,
  AlertTriangle,
  Flame,
  CheckCircle2,
  Sparkles,
  RefreshCw,
  LogOut,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Bell,
  Sliders,
  Mail,
  User,
  Clock,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
  Save,
  Activity,
  Check,
  Layers,
  FileText,
  X,
  ExternalLink,
  Tag,
  Filter,
  ChevronUp,
  Copy,
  Code,
  ArrowUpDown,
  Plus,
  Trash2,
  MessageSquare,
  Calendar,
  BellOff,
} from "lucide-react";
import { TIPOS_ERROS_INTEGRACOES } from "@/lib/constants";

export interface IncidentFeedbackItem {
  observacao: string;
  silenciadoAte?: string | null;
  atualizadoPor: string;
  atualizadoEm: string;
}

export interface GrupoMonitoramento {
  id: string;
  nome: string; // ex: 'Operação de Pedidos', 'Catálogo e Anúncios'
  tipos: string[]; // ex: ['Pedido', 'Pedido Faturado', 'Pedido Liberado']
  limiteErros: number; // ex: 5
  janelaValor: number; // ex: 2, 6, 12, 24 ou 1, 2, 7
  janelaUnidade: "horas" | "dias"; // unidade de tempo
}

export interface AvaliacaoGrupoMonitoramento {
  id: string;
  nome: string;
  tipos: string[];
  limiteErros: number;
  janelaValor: number;
  janelaUnidade: "horas" | "dias";
  totalErros: number;
  violouSLA: boolean;
  amostraCodigos: string[];
  amostraMensagens: string[];
}

interface EntidadeItem {
  _id: string;
  nome: string;
  status: string | boolean;
  dataCriacao?: string | null;
  isMonitored: boolean;
  active: boolean;
  assignedCS: {
    name: string;
    email: string;
  };
  thresholds: {
    diasSemAcessoAlerta: number;
    maxErros2h?: number;
    tiposMonitorados?: string[];
    gruposMonitoramento?: GrupoMonitoramento[];
  };
}

interface AlertItem {
  id?: string;
  entidadeId?: string;
  entidadeNome: string;
  csEmail?: string;
  csName?: string;
  tipoRisco: string;
  motivo: string;
  acaoRecomendada: string;
  status?: "ativo" | "resolvido";
  disparadoEm: string;
  ultimaOcorrencia?: string;
  resolvidoEm?: string | null;
  resolvidoMotivo?: string | null;
  origem?: string;
}

interface UsuarioConta {
  _id: string;
  nome: string;
  email: string;
  cargo: string;
  ultimoAcesso: string | null;
  diasSemAcesso: number | string;
  statusAcesso: "recente" | "moderado" | "inativo";
}

interface ItemErroIntegracao {
  mensagem: string;
  data: string;
  tipo: string;
  layoutIntegracao?: string;
  tipoIntegracao?: string;
  codigoRegistro?: string | number | null;
  requisicaoRetornoData?: any;
}

interface GrupoErroConta {
  canal: string;
  tipo: string;
  totalOcorrencias: number;
  ultimaOcorrencia: string;
  resumoMensagem: string;
  amostraRegistros: (string | number)[];
  itens: ItemErroIntegracao[];
  feedback?: IncidentFeedbackItem | null;
}

interface AnalyticsConta {
  totalUsuarios: number;
  ativos7d: number;
  ativos15d: number;
  ativos30d: number;
  taxaAdesao7d: number;
  taxaAdesao30d: number;
  ultimoAcessoGeral?: {
    data: string | null;
    usuarioNome: string | null;
    usuarioEmail: string | null;
    diasSemAcesso: number | null;
    tempoRelativo: string;
  } | null;
  ultimoAcessoMaisRecente?: {
    data: string | null;
    usuarioNome: string | null;
    usuarioEmail: string | null;
    diasSemAcesso: number | null;
    tempoRelativo: string;
  } | null;
  erros2h: number;
  erros24h: number;
  gruposErros?: GrupoErroConta[];
  avaliacaoGrupos?: AvaliacaoGrupoMonitoramento[];
  amostraErros: ItemErroIntegracao[];
  usuarios: UsuarioConta[];
  saude: {
    scoreEngajamento: number;
    nivelRisco: "SAUDAVEL" | "CHURN" | "CRITICO";
    statusOperacional: string;
    motivo: string;
    acaoRecomendada: string;
  };
  monitoring: {
    active: boolean;
    assignedCS: { name: string; email: string };
    thresholds: {
      diasSemAcessoAlerta: number;
      maxErros2h?: number;
      tiposMonitorados?: string[];
      gruposMonitoramento?: GrupoMonitoramento[];
    };
    incidentFeedback?: Record<string, IncidentFeedbackItem>;
  };
}

export default function DashboardPage() {
  const router = useRouter();

  // Estados principais da navegação
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [entidades, setEntidades] = useState<EntidadeItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [riskFilter, setRiskFilter] = useState<"TODOS" | "CRITICO" | "CHURN">("TODOS");

  // Estado da Visão Individual (Raio-X da Entidade)
  const [tenantAnalytics, setTenantAnalytics] = useState<AnalyticsConta | null>(null);
  const [selectedTenantInfo, setSelectedTenantInfo] = useState<any>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState("");
  const [showUsersTable, setShowUsersTable] = useState(false);
  const [tipoErrorSearch, setTipoErrorSearch] = useState("");
  const [groupSearchTerms, setGroupSearchTerms] = useState<Record<string, string>>({});
  const [openGroupTypeSelector, setOpenGroupTypeSelector] = useState<Record<string, boolean>>({});
  const [expandedErrorGroups, setExpandedErrorGroups] = useState<Record<string, boolean>>({});
  const [errorSortBy, setErrorSortBy] = useState<"volume" | "recente">("volume");
  const [copiedPayloadGroup, setCopiedPayloadGroup] = useState<string | null>(null);
  const [canalErrorFilter, setCanalErrorFilter] = useState<string>("TODOS");
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    type: "success" | "error" | "warning";
  } | null>(null);

  // Estado do Modal de Observação e Silenciamento (Snooze) de Grupo de Falhas
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [feedbackTargetGroup, setFeedbackTargetGroup] = useState<GrupoErroConta | null>(null);
  const [feedbackObservacao, setFeedbackObservacao] = useState("");
  const [feedbackLembrarEmDias, setFeedbackLembrarEmDias] = useState<number>(0);
  const [savingFeedback, setSavingFeedback] = useState(false);

  // Estado do Modal de Execução do Agente de IA
  const [showExecutionModal, setShowExecutionModal] = useState(false);
  const [runningAgent, setRunningAgent] = useState(false);
  const [agentLogs, setAgentLogs] = useState<string[]>([]);
  const [executiveReport, setExecutiveReport] = useState<string>("");
  const [executionResult, setExecutionResult] = useState<any>(null);

  // Estado do E-mail de Teste e Prévia Visual
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [emailPreviewHtml, setEmailPreviewHtml] = useState<string | null>(null);
  const [showEmailPreviewModal, setShowEmailPreviewModal] = useState(false);

  // Usuário CS logado
  const [currentUser, setCurrentUser] = useState<{
    uid: string;
    name: string;
    email: string;
  } | null>(null);

  // Auxiliar para obter cabeçalhos de autenticação e parâmetros de identificação do CS
  const getAuthContext = async (overrideUser?: {
    uid?: string;
    email?: string;
    name?: string;
  }) => {
    const activeUser = clientAuth.currentUser;
    let idToken: string | null = null;
    if (activeUser) {
      try {
        idToken = await activeUser.getIdToken();
      } catch (e) {
        console.warn("Erro ao obter idToken:", e);
      }
    }

    const userObj = overrideUser || currentUser;
    const uid = activeUser?.uid || userObj?.uid || "";
    const email = activeUser?.email || userObj?.email || "";
    const name = activeUser?.displayName || userObj?.name || (email ? email.split("@")[0] : "");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-cs-uid": uid,
      "x-cs-email": email,
      "x-cs-name": encodeURIComponent(name),
    };

    if (idToken) {
      headers["Authorization"] = `Bearer ${idToken}`;
    }

    const queryParams = new URLSearchParams({
      csUid: uid,
      csEmail: email,
      csName: name,
    }).toString();

    return {
      uid,
      email,
      name,
      idToken,
      headers,
      queryParams,
    };
  };

  // Carregamento inicial de dados e sincronização automática com Firebase Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(clientAuth, async (user) => {
      if (user && user.email) {
        const authUser = {
          uid: user.uid,
          name: user.displayName || user.email.split("@")[0],
          email: user.email,
        };
        setCurrentUser(authUser);
        fetchData(authUser);
      } else {
        setCurrentUser(null);
        router.replace("/login");
      }
    });

    return () => unsubscribe();
  }, [router]);

  const fetchData = async (userContext?: { uid?: string; email?: string; name?: string }) => {
    setLoading(true);
    try {
      const authCtx = await getAuthContext(userContext);
      const [resEntidades, resAlerts] = await Promise.all([
        fetch(`/api/entidades?${authCtx.queryParams}`, { headers: authCtx.headers }),
        fetch(`/api/alerts?${authCtx.queryParams}`, { headers: authCtx.headers }),
      ]);

      if (!resEntidades.ok) {
        throw new Error(`Falha ao carregar entidades: HTTP ${resEntidades.status}`);
      }
      if (!resAlerts.ok) {
        throw new Error(`Falha ao carregar alertas: HTTP ${resAlerts.status}`);
      }

      const dataEntidades = await resEntidades.json();
      const dataAlerts = await resAlerts.json();

      if (dataEntidades.success && Array.isArray(dataEntidades.entidades)) {
        setEntidades(dataEntidades.entidades);
      }

      if (dataAlerts.success && Array.isArray(dataAlerts.alerts)) {
        setAlerts(dataAlerts.alerts);
      }
    } catch (err: any) {
      console.error("Erro ao carregar dados gerais:", err);
    } finally {
      setLoading(false);
    }
  };

  // Carrega diagnóstico sob demanda quando uma entidade é selecionada
  const handleSelectTenant = async (id: string) => {
    setSelectedTenantId(id);
    setLoadingAnalytics(true);
    setTenantAnalytics(null);
    setSaveSuccessMsg("");
    setShowUsersTable(false);
    setExpandedErrorGroups({});
    setCanalErrorFilter("TODOS");

    try {
      const authCtx = await getAuthContext();
      const res = await fetch(`/api/entidades/${id}/analytics?${authCtx.queryParams}`, {
        headers: authCtx.headers,
      });
      if (!res.ok) {
        throw new Error(`Falha ao obter analytics da entidade: HTTP ${res.status}`);
      }
      const data = await res.json();

      if (data.success) {
        const analytics = data.analytics;
        if (analytics?.monitoring?.thresholds) {
          const thresh = analytics.monitoring.thresholds;
          if (!Array.isArray(thresh.gruposMonitoramento) || thresh.gruposMonitoramento.length === 0) {
            thresh.gruposMonitoramento = [
              {
                id: "grupo_padrao",
                nome: "Operação Geral",
                tipos: Array.isArray(thresh.tiposMonitorados) ? thresh.tiposMonitorados : [],
                limiteErros: Number(thresh.maxErros2h) || 5,
                janelaValor: 2,
                janelaUnidade: "horas",
              },
            ];
          }
        }
        setTenantAnalytics(analytics);
        setSelectedTenantInfo(data.entidade);
      } else {
        console.error("Falha ao obter analytics:", data.error);
      }
    } catch (err: any) {
      console.error("Erro ao buscar analytics:", err);
    } finally {
      setLoadingAnalytics(false);
    }
  };

  // Voltar para o Cockpit Geral
  const handleBackToGeneral = () => {
    setSelectedTenantId(null);
    setTenantAnalytics(null);
    setSelectedTenantInfo(null);
    setShowUsersTable(false);
    setExpandedErrorGroups({});
    setCanalErrorFilter("TODOS");
  };

  // Toggle rápido de monitoramento (pela sidebar ou cabeçalho)
  const handleToggleMonitoring = async (
    e: React.MouseEvent,
    tenantId: string,
    currentActive: boolean
  ) => {
    e.stopPropagation();
    const newStatus = !currentActive;

    // Atualiza estado local de entidades imediatamente
    setEntidades((prev) =>
      prev.map((item) =>
        item._id === tenantId
          ? { ...item, active: newStatus, isMonitored: newStatus }
          : item
      )
    );

    // Se estiver com essa entidade aberta no Raio-X, atualiza o analytics também
    if (tenantAnalytics && selectedTenantId === tenantId) {
      setTenantAnalytics((prev) =>
        prev
          ? {
              ...prev,
              monitoring: { ...prev.monitoring, active: newStatus },
            }
          : null
      );
    }

    try {
      const authCtx = await getAuthContext();
      const assignedCS = {
        uid: authCtx.uid,
        name: authCtx.name,
        email: authCtx.email,
      };

      const target = entidades.find((x) => x._id === tenantId);
      const payload = [
        {
          entidadeId: tenantId,
          nome: target?.nome || "Entidade",
          active: newStatus,
          assignedCS,
          thresholds: target?.thresholds || {
            diasSemAcessoAlerta: 7,
            maxErros2h: 5,
            tiposMonitorados: [],
          },
        },
      ];

      const res = await fetch(`/api/monitored-tenants?${authCtx.queryParams}`, {
        method: "POST",
        headers: authCtx.headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`Falha ao salvar monitoramento: HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.success) {
        setToastMessage({
          text: newStatus
            ? "Monitoramento ativado com sucesso para a sua carteira."
            : "Monitoramento pausado para a sua carteira.",
          type: "success",
        });
      } else {
        setToastMessage({
          text: `Erro ao salvar status: ${data.error || "Falha na requisição"}`,
          type: "error",
        });
      }
    } catch (err: any) {
      console.error("Erro ao alternar monitoramento:", err);
      setToastMessage({
        text: `Erro de comunicação: ${err.message}`,
        type: "error",
      });
    } finally {
      setTimeout(() => setToastMessage(null), 4000);
    }
  };

  // Atualizar campo de threshold no Raio-X
  const handleUpdateAnalyticsThreshold = (field: string, value: any) => {
    if (!tenantAnalytics) return;

    if (field === "diasSemAcessoAlerta") {
      setTenantAnalytics({
        ...tenantAnalytics,
        monitoring: {
          ...tenantAnalytics.monitoring,
          thresholds: {
            ...tenantAnalytics.monitoring.thresholds,
            diasSemAcessoAlerta: Math.max(1, Number(value)),
          },
        },
      });
    } else if (field === "maxErros2h") {
      setTenantAnalytics({
        ...tenantAnalytics,
        monitoring: {
          ...tenantAnalytics.monitoring,
          thresholds: {
            ...tenantAnalytics.monitoring.thresholds,
            maxErros2h: Math.max(0, Number(value)),
          },
        },
      });
    }
  };

  // Manipulação de Grupos de Monitoramento Customizados
  const handleAddGrupoMonitoramento = () => {
    if (!tenantAnalytics) return;
    const currentGrupos = tenantAnalytics.monitoring.thresholds.gruposMonitoramento || [];
    const newGrupo: GrupoMonitoramento = {
      id: `grp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      nome: `Novo Grupo de Regras ${currentGrupos.length + 1}`,
      tipos: [],
      limiteErros: 5,
      janelaValor: 2,
      janelaUnidade: "horas",
    };
    setTenantAnalytics({
      ...tenantAnalytics,
      monitoring: {
        ...tenantAnalytics.monitoring,
        thresholds: {
          ...tenantAnalytics.monitoring.thresholds,
          gruposMonitoramento: [...currentGrupos, newGrupo],
        },
      },
    });
  };

  const handleRemoveGrupoMonitoramento = (grupoId: string) => {
    if (!tenantAnalytics) return;
    const currentGrupos = tenantAnalytics.monitoring.thresholds.gruposMonitoramento || [];
    if (currentGrupos.length <= 1) {
      setToastMessage({
        text: "A conta deve ter ao menos um grupo de monitoramento configurado.",
        type: "warning",
      });
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    const updated = currentGrupos.filter((g) => g.id !== grupoId);
    setTenantAnalytics({
      ...tenantAnalytics,
      monitoring: {
        ...tenantAnalytics.monitoring,
        thresholds: {
          ...tenantAnalytics.monitoring.thresholds,
          gruposMonitoramento: updated,
        },
      },
    });
  };

  const handleUpdateGrupoMonitoramento = (
    grupoId: string,
    field: keyof GrupoMonitoramento,
    value: any
  ) => {
    if (!tenantAnalytics) return;
    const currentGrupos = tenantAnalytics.monitoring.thresholds.gruposMonitoramento || [];
    const updated = currentGrupos.map((g) => {
      if (g.id !== grupoId) return g;
      if (field === "limiteErros" || field === "janelaValor") {
        return { ...g, [field]: Math.max(1, Number(value) || 1) };
      }
      return { ...g, [field]: value };
    });
    setTenantAnalytics({
      ...tenantAnalytics,
      monitoring: {
        ...tenantAnalytics.monitoring,
        thresholds: {
          ...tenantAnalytics.monitoring.thresholds,
          gruposMonitoramento: updated,
        },
      },
    });
  };

  const handleToggleTipoInGrupo = (grupoId: string, tipo: string) => {
    if (!tenantAnalytics) return;
    const currentGrupos = tenantAnalytics.monitoring.thresholds.gruposMonitoramento || [];
    const updated = currentGrupos.map((g) => {
      if (g.id !== grupoId) return g;
      const currentTipos = g.tipos || [];
      const exists = currentTipos.includes(tipo);
      const newTipos = exists
        ? currentTipos.filter((t) => t !== tipo)
        : [...currentTipos, tipo];
      return { ...g, tipos: newTipos };
    });
    setTenantAnalytics({
      ...tenantAnalytics,
      monitoring: {
        ...tenantAnalytics.monitoring,
        thresholds: {
          ...tenantAnalytics.monitoring.thresholds,
          gruposMonitoramento: updated,
        },
      },
    });
  };

  const handleSelectAllTiposInGrupo = (grupoId: string) => {
    if (!tenantAnalytics) return;
    const currentGrupos = tenantAnalytics.monitoring.thresholds.gruposMonitoramento || [];
    const updated = currentGrupos.map((g) => {
      if (g.id !== grupoId) return g;
      return { ...g, tipos: [...TIPOS_ERROS_INTEGRACOES] };
    });
    setTenantAnalytics({
      ...tenantAnalytics,
      monitoring: {
        ...tenantAnalytics.monitoring,
        thresholds: {
          ...tenantAnalytics.monitoring.thresholds,
          gruposMonitoramento: updated,
        },
      },
    });
  };

  const handleClearAllTiposInGrupo = (grupoId: string) => {
    if (!tenantAnalytics) return;
    const currentGrupos = tenantAnalytics.monitoring.thresholds.gruposMonitoramento || [];
    const updated = currentGrupos.map((g) => {
      if (g.id !== grupoId) return g;
      return { ...g, tipos: [] };
    });
    setTenantAnalytics({
      ...tenantAnalytics,
      monitoring: {
        ...tenantAnalytics.monitoring,
        thresholds: {
          ...tenantAnalytics.monitoring.thresholds,
          gruposMonitoramento: updated,
        },
      },
    });
  };

  // Toggle de um tipo específico no multi-select (retrocompatibilidade)
  const handleToggleTipoMonitorado = (tipo: string) => {
    if (!tenantAnalytics) return;
    const current = tenantAnalytics.monitoring.thresholds.tiposMonitorados || [];
    const exists = current.includes(tipo);
    const updated = exists ? current.filter((t) => t !== tipo) : [...current, tipo];

    setTenantAnalytics({
      ...tenantAnalytics,
      monitoring: {
        ...tenantAnalytics.monitoring,
        thresholds: {
          ...tenantAnalytics.monitoring.thresholds,
          tiposMonitorados: updated,
        },
      },
    });
  };

  const handleSelectAllTipos = () => {
    if (!tenantAnalytics) return;
    setTenantAnalytics({
      ...tenantAnalytics,
      monitoring: {
        ...tenantAnalytics.monitoring,
        thresholds: {
          ...tenantAnalytics.monitoring.thresholds,
          tiposMonitorados: [...TIPOS_ERROS_INTEGRACOES],
        },
      },
    });
  };

  const handleClearAllTipos = () => {
    if (!tenantAnalytics) return;
    setTenantAnalytics({
      ...tenantAnalytics,
      monitoring: {
        ...tenantAnalytics.monitoring,
        thresholds: {
          ...tenantAnalytics.monitoring.thresholds,
          tiposMonitorados: [],
        },
      },
    });
  };

  // Filtragem rápida da lista oficial de tipos pelo termo digitado
  const filteredTipos = useMemo(() => {
    if (!tipoErrorSearch.trim()) return TIPOS_ERROS_INTEGRACOES;
    const term = tipoErrorSearch.toLowerCase().trim();
    return TIPOS_ERROS_INTEGRACOES.filter((t) => t.toLowerCase().includes(term));
  }, [tipoErrorSearch]);

  // Salvar regras da conta no Firestore
  const handleSaveAccountRules = async () => {
    if (!selectedTenantId || !tenantAnalytics) return;
    setSavingSettings(true);
    setSaveSuccessMsg("");

    const authCtx = await getAuthContext();
    const assignedCS = {
      uid: authCtx.uid,
      name: authCtx.name,
      email: authCtx.email,
    };

    // 1. Atualização otimista imediata do estado local
    setEntidades((prev) =>
      prev.map((item) =>
        item._id === selectedTenantId
          ? {
              ...item,
              active: tenantAnalytics.monitoring.active,
              isMonitored: tenantAnalytics.monitoring.active,
              assignedCS,
              thresholds: tenantAnalytics.monitoring.thresholds,
            }
          : item
      )
    );

    try {
      const payload = [
        {
          entidadeId: selectedTenantId,
          nome: selectedTenantInfo?.nome || "Entidade",
          active: Boolean(tenantAnalytics.monitoring.active),
          assignedCS,
          thresholds: {
            diasSemAcessoAlerta:
              Number(tenantAnalytics.monitoring.thresholds.diasSemAcessoAlerta) || 7,
            gruposMonitoramento:
              tenantAnalytics.monitoring.thresholds.gruposMonitoramento || [],
            maxErros2h:
              tenantAnalytics.monitoring.thresholds.gruposMonitoramento?.[0]?.limiteErros || 5,
            tiposMonitorados:
              tenantAnalytics.monitoring.thresholds.gruposMonitoramento?.[0]?.tipos || [],
          },
        },
      ];

      const res = await fetch(`/api/monitored-tenants?${authCtx.queryParams}`, {
        method: "POST",
        headers: authCtx.headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`Falha ao salvar regras no servidor: HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.success) {
        const msg = "Regras salvas e sincronizadas na sua carteira com sucesso!";
        setSaveSuccessMsg(msg);
        setToastMessage({ text: msg, type: "success" });
        setTimeout(() => setSaveSuccessMsg(""), 5000);
      } else {
        setToastMessage({
          text: `Erro ao salvar regras no Firestore: ${data.error || "Falha na requisição"}`,
          type: "error",
        });
      }
    } catch (err: any) {
      setToastMessage({
        text: `Erro ao salvar configurações: ${err.message}`,
        type: "error",
      });
    } finally {
      setSavingSettings(false);
      setTimeout(() => setToastMessage(null), 5000);
    }
  };

  // Disparar Auditoria Geral da IA
  const handleRunAgentAudit = async () => {
    setRunningAgent(true);
    setShowExecutionModal(true);
    setAgentLogs([
      "[0s] 🚀 Inicializando Cockpit de IA da Kenit com Google Gemini...",
      `[1s] 🔍 Consultando entidades da carteira de ${currentUser?.name || "CS"} para auditoria preventiva...`,
    ]);
    setExecutiveReport("");
    setExecutionResult(null);

    try {
      const authCtx = await getAuthContext();
      const res = await fetch(`/api/run-agent?${authCtx.queryParams}`, {
        method: "POST",
        headers: authCtx.headers,
        body: JSON.stringify({
          csUid: authCtx.uid,
          csEmail: authCtx.email,
          csName: authCtx.name,
        }),
      });
      if (!res.ok) {
        throw new Error(`Falha na requisição da auditoria: HTTP ${res.status}`);
      }
      const data = await res.json();

      if (data.success && data.data) {
        setExecutionResult(data.data);
        setAgentLogs(data.data.logs || []);
        setExecutiveReport(data.data.executiveReport || "");
        fetchData();
        if (selectedTenantId) {
          handleSelectTenant(selectedTenantId);
        }
      } else {
        setAgentLogs((prev) => [
          ...prev,
          `❌ Erro na auditoria: ${data.error || "Falha desconhecida"}`,
        ]);
      }
    } catch (err: any) {
      setAgentLogs((prev) => [
        ...prev,
        `❌ Erro de conexão com o agente: ${err.message}`,
      ]);
    } finally {
      setRunningAgent(false);
    }
  };

  // Disparo de E-mail de Teste com o Template Visual Kenit
  const handleSendTestEmail = async () => {
    setSendingTestEmail(true);
    try {
      const authCtx = await getAuthContext();
      const currentEntityName = selectedTenantInfo?.nome || "NovaTech Solutions";

      const res = await fetch(`/api/test-email?${authCtx.queryParams}`, {
        method: "POST",
        headers: authCtx.headers,
        body: JSON.stringify({
          to: authCtx.email,
          csName: authCtx.name,
          entidadeNome: currentEntityName,
        }),
      });
      if (!res.ok) {
        throw new Error(`Falha no envio de e-mail de teste: HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.success) {
        const recipient = data.recipient || currentUser?.email || authCtx.email;
        setToastMessage({
          text: `E-mail de demonstração enviado para ${recipient}!`,
          type: "success",
        });

        if (data.html) {
          setEmailPreviewHtml(data.html);
        }
      } else {
        setToastMessage({
          text: `Erro ao enviar e-mail: ${data.error || "Falha na requisição"}`,
          type: "error",
        });
      }
    } catch (err: any) {
      console.error("Erro ao enviar e-mail de teste:", err);
      setToastMessage({
        text: `Erro de conexão ao enviar e-mail: ${err.message}`,
        type: "error",
      });
    } finally {
      setSendingTestEmail(false);
      setTimeout(() => setToastMessage(null), 5000);
    }
  };

  const handleLogout = async () => {
    try {
      localStorage.removeItem("cs_sentinel_demo_user");
      await signOut(clientAuth);
    } catch (err) {
      console.warn("Erro ao fazer signOut:", err);
    } finally {
      setCurrentUser(null);
      router.replace("/login");
    }
  };

  // Entidades filtradas na barra lateral
  const filteredEntidades = useMemo(() => {
    if (!searchTerm.trim()) return entidades;
    return entidades.filter((e) =>
      e.nome.toLowerCase().includes(searchTerm.toLowerCase().trim())
    );
  }, [entidades, searchTerm]);

  // Alertas com status ativo (ignora os marcados como resolvido)
  const activeAlerts = useMemo(() => {
    return alerts.filter((a) => !a.status || a.status === "ativo");
  }, [alerts]);

  // Cálculo resiliente do Último Acesso Geral da Conta
  const ultimoAcessoInfo = useMemo(() => {
    if (!tenantAnalytics) return null;
    if (tenantAnalytics.ultimoAcessoGeral) return tenantAnalytics.ultimoAcessoGeral;
    if (tenantAnalytics.ultimoAcessoMaisRecente) return tenantAnalytics.ultimoAcessoMaisRecente;

    // Fallback defensivo a partir da lista de usuários
    if (tenantAnalytics.usuarios && tenantAnalytics.usuarios.length > 0) {
      let maisRecente: any = null;
      let dataMaisRecente: Date | null = null;
      for (const u of tenantAnalytics.usuarios) {
        if (u.ultimoAcesso) {
          const d = new Date(u.ultimoAcesso);
          if (!isNaN(d.getTime())) {
            if (!dataMaisRecente || d > dataMaisRecente) {
              dataMaisRecente = d;
              maisRecente = u;
            }
          }
        }
      }
      const diasAlerta = tenantAnalytics.monitoring?.thresholds?.diasSemAcessoAlerta || 7;
      const dias = dataMaisRecente
        ? Math.max(0, Math.floor((Date.now() - dataMaisRecente.getTime()) / (1000 * 60 * 60 * 24)))
        : null;

      let tempo = "Nenhum acesso registrado";
      if (dias !== null) {
        if (dias === 0) tempo = "Hoje";
        else if (dias === 1) tempo = "Há 1 dia";
        else if (dias > diasAlerta) tempo = `Sem acessos há ${dias} dias`;
        else tempo = `Há ${dias} dias`;
      }

      return {
        data: dataMaisRecente ? dataMaisRecente.toISOString() : null,
        usuarioNome: maisRecente?.nome || null,
        usuarioEmail: maisRecente?.email || null,
        diasSemAcesso: dias,
        tempoRelativo: tempo,
      };
    }
    return null;
  }, [tenantAnalytics]);

  // Helpers de Estilização e Formatação para Erros Agrupados
  const getChannelBadgeStyle = (canal: string) => {
    const norm = (canal || "").toLowerCase();
    if (norm.includes("mercado livre") || norm.includes("mercadolivre") || norm.includes("meli")) {
      return {
        bg: "bg-amber-50 text-amber-900 border-amber-300 ring-amber-500/20",
        dot: "bg-amber-500",
        label: "Mercado Livre",
      };
    }
    if (norm.includes("vtex")) {
      return {
        bg: "bg-fuchsia-50 text-fuchsia-900 border-fuchsia-300 ring-fuchsia-500/20",
        dot: "bg-fuchsia-600",
        label: "VTEX",
      };
    }
    if (norm.includes("shopee")) {
      return {
        bg: "bg-orange-50 text-orange-900 border-orange-300 ring-orange-500/20",
        dot: "bg-orange-500",
        label: "Shopee",
      };
    }
    if (norm.includes("amazon")) {
      return {
        bg: "bg-yellow-50 text-yellow-900 border-yellow-300 ring-yellow-500/20",
        dot: "bg-yellow-600",
        label: "Amazon",
      };
    }
    if (norm.includes("magalu") || norm.includes("magazine")) {
      return {
        bg: "bg-blue-50 text-blue-900 border-blue-300 ring-blue-500/20",
        dot: "bg-blue-600",
        label: "Magalu",
      };
    }
    if (norm.includes("shein")) {
      return {
        bg: "bg-zinc-100 text-zinc-900 border-zinc-300 ring-zinc-500/20",
        dot: "bg-zinc-800",
        label: "Shein",
      };
    }
    return {
      bg: "bg-indigo-50 text-[#1D00EB] border-indigo-200 ring-indigo-500/20",
      dot: "bg-[#1D00EB]",
      label: canal || "Canal Integrado",
    };
  };

  const getTipoBadgeStyle = (tipo: string) => {
    const norm = (tipo || "").toLowerCase();
    if (norm.includes("anuncio") || norm.includes("anúncio")) {
      return "bg-sky-50 text-sky-800 border-sky-200";
    }
    if (norm.includes("pedido")) {
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    }
    if (norm.includes("estoque")) {
      return "bg-purple-50 text-purple-800 border-purple-200";
    }
    if (norm.includes("preco") || norm.includes("preço")) {
      return "bg-amber-50 text-amber-800 border-amber-200";
    }
    if (norm.includes("categoria")) {
      return "bg-teal-50 text-teal-800 border-teal-200";
    }
    return "bg-slate-100 text-slate-700 border-slate-200";
  };

  const formatTempoRelativo = (dataStr: string) => {
    if (!dataStr) return "Sem registro";
    try {
      const data = new Date(dataStr);
      const agora = new Date();
      const diffMs = agora.getTime() - data.getTime();
      if (isNaN(diffMs)) return dataStr;
      if (diffMs < 0) return "Agora mesmo";
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return "Há menos de 1 minuto";
      if (diffMin < 60) return `Há ${diffMin} min atrás`;
      const diffHoras = Math.floor(diffMin / 60);
      if (diffHoras < 24) return `Há ${diffHoras}h atrás`;
      const diffDias = Math.floor(diffHoras / 24);
      if (diffDias === 1) return `Há 1 dia atrás`;
      return `Há ${diffDias} dias atrás`;
    } catch {
      return dataStr;
    }
  };

  // Agrupamento consolidado e ordenação de erros de integração
  const errorGroups = useMemo<GrupoErroConta[]>(() => {
    if (!tenantAnalytics) return [];

    let groups: GrupoErroConta[] = [];

    if (tenantAnalytics.gruposErros && tenantAnalytics.gruposErros.length > 0) {
      groups = tenantAnalytics.gruposErros.map((g) => ({
        canal: g.canal || "Geral",
        tipo: g.tipo || "Geral",
        totalOcorrencias: g.totalOcorrencias || 1,
        ultimaOcorrencia: g.ultimaOcorrencia || new Date().toISOString(),
        resumoMensagem: g.resumoMensagem || "Falha de integração registrada",
        amostraRegistros: Array.isArray(g.amostraRegistros) ? g.amostraRegistros : [],
        itens: Array.isArray(g.itens) ? g.itens : [],
        feedback:
          g.feedback ||
          tenantAnalytics.monitoring?.incidentFeedback?.[`${g.canal}_${g.tipo}`] ||
          null,
      }));
    } else if (tenantAnalytics.amostraErros && tenantAnalytics.amostraErros.length > 0) {
      // Agrupamento utilitário no cliente (fallback)
      const map = new Map<string, GrupoErroConta>();
      for (const err of tenantAnalytics.amostraErros) {
        const canal = err.layoutIntegracao || "Geral";
        const tipo = err.tipoIntegracao || err.tipo || "Geral";
        const chave = `${canal}_${tipo}`;
        const dataIso = err.data || new Date().toISOString();
        const codReg = err.codigoRegistro;

        if (!map.has(chave)) {
          map.set(chave, {
            canal,
            tipo,
            totalOcorrencias: 0,
            ultimaOcorrencia: dataIso,
            resumoMensagem: err.mensagem,
            amostraRegistros: [],
            itens: [],
            feedback: tenantAnalytics.monitoring?.incidentFeedback?.[chave] || null,
          });
        }

        const g = map.get(chave)!;
        g.totalOcorrencias++;
        g.itens.push(err);
        if (new Date(dataIso) >= new Date(g.ultimaOcorrencia)) {
          g.ultimaOcorrencia = dataIso;
          g.resumoMensagem = err.mensagem;
        }
        if (codReg && !g.amostraRegistros.includes(codReg)) {
          if (g.amostraRegistros.length < 5) {
            g.amostraRegistros.push(codReg);
          }
        }
      }
      groups = Array.from(map.values());
    }

    // Filtro por canal se aplicável
    if (canalErrorFilter !== "TODOS") {
      groups = groups.filter((g) => g.canal === canalErrorFilter);
    }

    // Ordenação configurável: Maior volume de erros vs Mais recente
    return groups.sort((a, b) => {
      if (errorSortBy === "volume") {
        if (b.totalOcorrencias !== a.totalOcorrencias) {
          return b.totalOcorrencias - a.totalOcorrencias;
        }
        return new Date(b.ultimaOcorrencia).getTime() - new Date(a.ultimaOcorrencia).getTime();
      } else {
        if (new Date(b.ultimaOcorrencia).getTime() !== new Date(a.ultimaOcorrencia).getTime()) {
          return new Date(b.ultimaOcorrencia).getTime() - new Date(a.ultimaOcorrencia).getTime();
        }
        return b.totalOcorrencias - a.totalOcorrencias;
      }
    });
  }, [tenantAnalytics, errorSortBy, canalErrorFilter]);

  // Lista de canais distintos para filtro
  const distinctErrorChannels = useMemo(() => {
    if (!tenantAnalytics) return [];
    const set = new Set<string>();
    if (tenantAnalytics.gruposErros) {
      tenantAnalytics.gruposErros.forEach((g) => {
        if (g.canal) set.add(g.canal);
      });
    } else if (tenantAnalytics.amostraErros) {
      tenantAnalytics.amostraErros.forEach((e) => {
        if (e.layoutIntegracao) set.add(e.layoutIntegracao);
      });
    }
    return Array.from(set);
  }, [tenantAnalytics]);

  const toggleErrorGroup = (chave: string) => {
    setExpandedErrorGroups((prev) => ({
      ...prev,
      [chave]: !prev[chave],
    }));
  };

  const toggleAllErrorGroups = () => {
    const allExpanded =
      errorGroups.length > 0 &&
      errorGroups.every((g) => expandedErrorGroups[`${g.canal}_${g.tipo}`]);
    if (allExpanded) {
      setExpandedErrorGroups({});
    } else {
      const nextState: Record<string, boolean> = {};
      errorGroups.forEach((g) => {
        nextState[`${g.canal}_${g.tipo}`] = true;
      });
      setExpandedErrorGroups(nextState);
    }
  };

  const handleCopyPayload = (text: string, chave: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedPayloadGroup(chave);
      setTimeout(() => {
        setCopiedPayloadGroup(null);
      }, 2000);
    }
  };

  const getRawPayloadDisplay = (grupo: GrupoErroConta) => {
    const itemComPayload =
      grupo.itens.find((it) => it.requisicaoRetornoData !== undefined && it.requisicaoRetornoData !== null) ||
      grupo.itens[0];

    if (itemComPayload?.requisicaoRetornoData) {
      const val = itemComPayload.requisicaoRetornoData;
      if (typeof val === "string") {
        try {
          const parsed = JSON.parse(val);
          return JSON.stringify(parsed, null, 2);
        } catch {
          return val;
        }
      }
      return JSON.stringify(val, null, 2);
    }

    if (itemComPayload?.mensagem) {
      return JSON.stringify(
        {
          mensagem: itemComPayload.mensagem,
          data: itemComPayload.data,
          codigoRegistro: itemComPayload.codigoRegistro,
        },
        null,
        2
      );
    }

    return JSON.stringify({ status: "Sem dados brutos de retorno", canal: grupo.canal, tipo: grupo.tipo }, null, 2);
  };

  // Abertura do Modal de Observação e Silenciamento (Snooze)
  const handleOpenFeedbackModal = (grupo: GrupoErroConta) => {
    const chave = `${grupo.canal}_${grupo.tipo}`;
    const existingFeedback =
      grupo.feedback || tenantAnalytics?.monitoring?.incidentFeedback?.[chave];

    setFeedbackTargetGroup(grupo);
    setFeedbackObservacao(existingFeedback?.observacao || "");

    if (existingFeedback?.silenciadoAte) {
      const diffMs = new Date(existingFeedback.silenciadoAte).getTime() - Date.now();
      const diasRestantes = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      setFeedbackLembrarEmDias(diasRestantes > 0 ? diasRestantes : 0);
    } else {
      setFeedbackLembrarEmDias(0);
    }

    setFeedbackModalOpen(true);
  };

  // Salvar nota do CS e parametrização de snooze
  const handleSaveFeedback = async () => {
    if (!selectedTenantId || !feedbackTargetGroup) return;
    setSavingFeedback(true);

    const authCtx = await getAuthContext();
    const chave = `${feedbackTargetGroup.canal}_${feedbackTargetGroup.tipo}`;

    try {
      const payload = {
        canal: feedbackTargetGroup.canal,
        tipo: feedbackTargetGroup.tipo,
        observacao: feedbackObservacao,
        lembrarEmDias: feedbackLembrarEmDias,
      };

      const res = await fetch(`/api/entidades/${selectedTenantId}/feedback-erro?${authCtx.queryParams}`, {
        method: "POST",
        headers: authCtx.headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Falha ao salvar observação.");
      }

      const updatedFeedback: IncidentFeedbackItem = data.feedback;

      // Atualiza o estado local imediatamente
      setTenantAnalytics((prev) => {
        if (!prev) return null;
        const currentIncidentFeedback = prev.monitoring.incidentFeedback || {};
        const updatedIncidentMap = {
          ...currentIncidentFeedback,
          [chave]: updatedFeedback,
        };

        const updatedGruposErros = (prev.gruposErros || []).map((g) => {
          if (g.canal === feedbackTargetGroup.canal && g.tipo === feedbackTargetGroup.tipo) {
            return { ...g, feedback: updatedFeedback };
          }
          return g;
        });

        return {
          ...prev,
          gruposErros: updatedGruposErros,
          monitoring: {
            ...prev.monitoring,
            incidentFeedback: updatedIncidentMap,
          },
        };
      });

      setToastMessage({
        text: updatedFeedback.silenciadoAte
          ? `Grupo silenciado até ${new Date(updatedFeedback.silenciadoAte).toLocaleDateString("pt-BR")}. O Agente pausará novos alertas.`
          : "Observação registrada com sucesso para o grupo.",
        type: "success",
      });
      setFeedbackModalOpen(false);
    } catch (err: any) {
      setToastMessage({
        text: `Erro ao registrar observação: ${err.message}`,
        type: "error",
      });
    } finally {
      setSavingFeedback(false);
      setTimeout(() => setToastMessage(null), 4000);
    }
  };

  // Alertas filtrados no Cockpit Geral
  const filteredAlerts = useMemo(() => {
    if (riskFilter === "CRITICO") {
      return alerts.filter(
        (a) =>
          a.tipoRisco.includes("CRITICO") ||
          a.tipoRisco.includes("TECNICO") ||
          a.tipoRisco.includes("OPERACIONAL")
      );
    }
    if (riskFilter === "CHURN") {
      return alerts.filter((a) => a.tipoRisco.includes("CHURN"));
    }
    return alerts;
  }, [alerts, riskFilter]);

  // Contadores globais: refletem a quantidade de ENTIDADES ÚNICAS DISTINTAS com status ativo
  const totalNoMongo = entidades.length;
  const totalMonitoradas = entidades.filter((e) => e.active).length;

  const totalCriticos = useMemo(() => {
    const criticosAtivos = activeAlerts.filter(
      (a) =>
        a.tipoRisco.includes("CRITICO") ||
        a.tipoRisco.includes("TECNICO") ||
        a.tipoRisco.includes("OPERACIONAL")
    );
    const uniqueEntities = new Set(
      criticosAtivos.map((a) => a.entidadeId || a.entidadeNome.trim().toLowerCase())
    );
    return uniqueEntities.size;
  }, [activeAlerts]);

  const totalChurn = useMemo(() => {
    const churnAtivos = activeAlerts.filter((a) => a.tipoRisco.includes("CHURN"));
    const uniqueEntities = new Set(
      churnAtivos.map((a) => a.entidadeId || a.entidadeNome.trim().toLowerCase())
    );
    return uniqueEntities.size;
  }, [activeAlerts]);

  return (
    <div className="flex min-h-screen bg-[#F8FAFC] text-slate-900">
      {/* ============================================================ */}
      {/* 1. SIDEBAR FIXA À ESQUERDA (ESTILO KENIT ENTERPRISE) */}
      {/* ============================================================ */}
      <aside className="fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-slate-200 bg-white">
        {/* Topo: Logo Kenit + Subtítulo */}
        <div className="border-b border-slate-200 px-6 py-5">
          <div className="flex items-center gap-2">
            <Image
              src="/logo-kenit-full.png"
              alt="Kenit"
              width={140}
              height={38}
              className="h-8 w-auto object-contain"
              priority
            />
          </div>
          <p className="mt-1.5 text-[11px] font-medium text-slate-500">
            Observability & CS Cockpit
          </p>
        </div>

        {/* Navegação Superior da Sidebar */}
        <div className="px-3 pt-4">
          <button
            onClick={handleBackToGeneral}
            className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-xs font-semibold transition-all ${
              selectedTenantId === null
                ? "bg-[#EEF0FF] text-[#1D00EB] shadow-card-sm"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <LayoutDashboard className="h-4 w-4" />
              <span>Cockpit Geral</span>
            </div>
            {activeAlerts.length > 0 && (
              <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                {activeAlerts.length}
              </span>
            )}
          </button>
        </div>

        {/* Seção: Entidades Cadastradas */}
        <div className="mt-4 flex flex-1 flex-col overflow-hidden px-3">
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Entidades Cadastradas
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
              {entidades.length}
            </span>
          </div>

          {/* Campo de Busca Rápida */}
          <div className="relative mb-2">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#1D00EB] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1D00EB] transition"
            />
          </div>

          {/* Lista com Scroll das Entidades */}
          <div className="flex-1 space-y-1 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                <RefreshCw className="h-5 w-5 animate-spin text-[#1D00EB]" />
                <span className="mt-2 text-[11px]">Carregando do MongoDB...</span>
              </div>
            ) : filteredEntidades.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                Nenhum cliente encontrado.
              </div>
            ) : (
              filteredEntidades.map((ent) => {
                const isSelected = selectedTenantId === ent._id;

                return (
                  <div
                    key={ent._id}
                    onClick={() => handleSelectTenant(ent._id)}
                    className={`group flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-xs transition-all ${
                      isSelected
                        ? "border border-[#1D00EB]/30 bg-[#EEF0FF] text-[#1D00EB] font-semibold"
                        : "border border-transparent text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="truncate font-medium">{ent.nome}</div>
                      <div className="mt-1 flex items-center gap-1.5">
                        {ent.active ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 border border-emerald-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Monitorado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                            Pausa
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Switch Rápido Ligar/Desligar */}
                    <div
                      onClick={(e) => handleToggleMonitoring(e, ent._id, ent.active)}
                      className="flex-shrink-0"
                      title={ent.active ? "Pausar monitoramento" : "Ativar monitoramento"}
                    >
                      <div
                        className={`relative h-4 w-8 rounded-full transition-colors cursor-pointer ${
                          ent.active ? "bg-[#1D00EB]" : "bg-slate-300"
                        }`}
                      >
                        <div
                          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                            ent.active ? "left-4" : "left-0.5"
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Rodapé da Sidebar: Info do CSM + Logout */}
        <div className="border-t border-slate-200 bg-slate-50/60 p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#EEF0FF] text-xs font-bold text-[#1D00EB]">
                {currentUser?.name ? currentUser.name.charAt(0).toUpperCase() : "CS"}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-800">
                  {currentUser?.name || "Analista de CS"}
                </p>
                <p className="truncate text-[10px] text-slate-400">
                  {currentUser?.email || "Autenticado"}
                </p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              title="Encerrar Sessão"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ============================================================ */}
      {/* 2. ÁREA DE CONTEÚDO PRINCIPAL (COM MARGEM ESQUERDA DA SIDEBAR) */}
      {/* ============================================================ */}
      <main className="ml-72 flex min-h-screen flex-1 flex-col bg-[#F8FAFC]">
        {/* TOPBAR SUPERIOR */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/90 px-8 py-3.5 backdrop-blur-md">
          {selectedTenantId ? (
            /* Breadcrumb quando em uma entidade */
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={handleBackToGeneral}
                className="flex items-center gap-1 font-semibold text-slate-500 hover:text-[#1D00EB] transition"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Cockpit Geral</span>
              </button>
              <span className="text-slate-300">/</span>
              <span className="font-bold text-slate-900">
                {selectedTenantInfo?.nome || "Carregando..."}
              </span>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                MongoDB Ativo
              </span>
            </div>
          ) : (
            /* Título do Cockpit Geral */
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-900">
                  Cockpit de Observabilidade & CS
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#1D00EB]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#1D00EB] border border-[#1D00EB]/20">
                  Carteira: {currentUser?.name || "Analista de CS"}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Monitoramento proativo e inteligência preditiva de churn com IA Kenit
              </p>
            </div>
          )}

          {/* Ações do Topo */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchData()}
              disabled={loading}
              title="Atualizar dados do servidor"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-[#1D00EB]" : ""}`} />
            </button>

            {/* Botão Secundário: Disparar E-mail de Teste */}
            <button
              onClick={handleSendTestEmail}
              disabled={sendingTestEmail}
              title={`Disparar e-mail de demonstração para ${currentUser?.email || "seu e-mail"}`}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition disabled:opacity-50"
            >
              {sendingTestEmail ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#1D00EB] border-t-transparent" />
              ) : (
                <Mail className="h-4 w-4 text-[#1D00EB]" />
              )}
              <span>Disparar E-mail de Teste</span>
            </button>

            {emailPreviewHtml && (
              <button
                onClick={() => setShowEmailPreviewModal(true)}
                title="Abrir prévia visual do e-mail"
                className="flex items-center gap-1.5 rounded-xl border border-[#1D00EB]/20 bg-[#EEF0FF] hover:bg-[#E0E3FF] px-3 py-2 text-xs font-semibold text-[#1D00EB] transition"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Ver Prévia</span>
              </button>
            )}

            {/* Botão de Destaque Kenit: Executar Auditoria */}
            <button
              onClick={handleRunAgentAudit}
              disabled={runningAgent}
              className="flex items-center gap-2 rounded-xl bg-[#1D00EB] hover:bg-[#1500B8] px-4 py-2 text-xs font-semibold text-white shadow-card-sm transition disabled:opacity-50"
            >
              {runningAgent ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <Sparkles className="h-4 w-4 text-cyan-200" />
              )}
              <span>Executar Auditoria Preventiva da IA</span>
            </button>
          </div>
        </header>

        {/* ============================================================ */}
        {/* CORPO: VISÃO INDIVIDUAL OU COCKPIT GERAL */}
        {/* ============================================================ */}
        <div className="p-8">
          {selectedTenantId ? (
            /* ========================================================== */
            /* MODO A: RAIO-X INDIVIDUAL DA CONTA SELECIONADA             */
            /* ========================================================== */
            <div>
              {loadingAnalytics ? (
                <div className="flex min-h-[400px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 text-slate-500 shadow-card-sm">
                  <RefreshCw className="h-8 w-8 animate-spin text-[#1D00EB]" />
                  <p className="mt-3 text-sm font-semibold text-slate-700">
                    Processando Telemetria do MongoDB...
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Calculando logins recentes, histórico de falhas e score de saúde.
                  </p>
                </div>
              ) : tenantAnalytics ? (
                <div className="space-y-6">
                  {/* 1. Header Card da Conta */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2.5">
                          <h2 className="text-xl font-bold text-slate-900">
                            {selectedTenantInfo?.nome}
                          </h2>
                          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                            {selectedTenantInfo?.plano || "Plano Enterprise"}
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-xs text-slate-400">
                          ID MongoDB: {selectedTenantId}
                        </p>
                      </div>

                      {/* Status de Monitoramento e Ação Rápida */}
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-[11px] text-slate-400 font-medium">
                            Monitoramento Autônomo
                          </p>
                          <p className="text-xs font-bold text-slate-800">
                            {tenantAnalytics.monitoring.active ? (
                              <span className="text-emerald-700">Habilitado</span>
                            ) : (
                              <span className="text-slate-500">Pausado</span>
                            )}
                          </p>
                        </div>
                        <button
                          onClick={(e) =>
                            handleToggleMonitoring(
                              e,
                              selectedTenantId,
                              tenantAnalytics.monitoring.active
                            )
                          }
                          className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                            tenantAnalytics.monitoring.active
                              ? "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                              : "bg-[#EEF0FF] text-[#1D00EB] border border-[#1D00EB]/20 hover:bg-[#E0E3FF]"
                          }`}
                        >
                          {tenantAnalytics.monitoring.active
                            ? "Pausar Monitoramento"
                            : "Ativar Monitoramento"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 2. Grid com 4 Cards de Métricas da Conta */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Card 1: Último Acesso na Conta (Novo foco de engajamento) */}
                    {(() => {
                      const diasAlerta =
                        tenantAnalytics.monitoring.thresholds.diasSemAcessoAlerta || 7;
                      const semAcessos =
                        ultimoAcessoInfo?.diasSemAcesso === null ||
                        ultimoAcessoInfo?.diasSemAcesso === undefined;
                      const ultrapassouLimite =
                        semAcessos ||
                        (ultimoAcessoInfo?.diasSemAcesso !== null &&
                          ultimoAcessoInfo.diasSemAcesso > diasAlerta);

                      return (
                        <div
                          className={`rounded-2xl border p-5 shadow-card-sm transition-all ${
                            ultrapassouLimite
                              ? "border-rose-200 bg-rose-50/50"
                              : "border-slate-200 bg-white"
                          }`}
                        >
                          <div className="flex items-center justify-between text-slate-400">
                            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                              Último Acesso na Conta
                            </span>
                            <Clock
                              className={`h-4 w-4 ${
                                ultrapassouLimite ? "text-rose-500" : "text-[#1D00EB]"
                              }`}
                            />
                          </div>

                          <div className="mt-2 flex items-baseline gap-2 flex-wrap">
                            <span
                              className={`text-2xl font-bold ${
                                ultrapassouLimite ? "text-rose-700" : "text-slate-900"
                              }`}
                            >
                              {ultimoAcessoInfo?.tempoRelativo || "Sem acessos"}
                            </span>
                            {ultrapassouLimite ? (
                              <span className="rounded-full bg-rose-100 border border-rose-200 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                                {semAcessos
                                  ? "Sem acessos registrados"
                                  : `Inativo (> ${diasAlerta}d)`}
                              </span>
                            ) : (
                              <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                Ativo (≤ ${diasAlerta}d)
                              </span>
                            )}
                          </div>

                          <div className="mt-1.5 min-w-0">
                            {ultimoAcessoInfo?.data ? (
                              <p
                                className="text-[11px] text-slate-500 truncate"
                                title={`Último login por: ${
                                  ultimoAcessoInfo.usuarioNome ||
                                  ultimoAcessoInfo.usuarioEmail ||
                                  "Usuário"
                                } (${new Date(ultimoAcessoInfo.data).toLocaleString("pt-BR")})`}
                              >
                                Último login por:{" "}
                                <strong className="text-slate-700 font-semibold">
                                  {ultimoAcessoInfo.usuarioNome ||
                                    ultimoAcessoInfo.usuarioEmail ||
                                    "Usuário"}
                                </strong>{" "}
                                ({new Date(ultimoAcessoInfo.data).toLocaleString("pt-BR")})
                              </p>
                            ) : (
                              <p className="text-[11px] text-slate-400">
                                Nenhum login registrado entre os usuários
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Card 2: Usuários Cadastrados (Card limpo, sem foco pesado de adesão) */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card-sm">
                      <div className="flex items-center justify-between text-slate-400">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                          Usuários Cadastrados
                        </span>
                        <Users className="h-4 w-4 text-slate-500" />
                      </div>
                      <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-slate-900">
                          {tenantAnalytics.totalUsuarios}
                        </span>
                        <span className="text-xs text-slate-400">membros vinculados</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <p className="text-[11px] text-slate-500">
                          Regra: min. 1 ativo p/ saúde
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowUsersTable((prev) => !prev)}
                          className="text-[11px] font-semibold text-[#1D00EB] hover:underline"
                        >
                          {showUsersTable ? "Ocultar lista" : "Ver usuários"}
                        </button>
                      </div>
                    </div>

                    {/* Card 3: Erros Recentes & Grupos de Monitoramento */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card-sm">
                      <div className="flex items-center justify-between text-slate-400">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                          Erros & Regras de SLA
                        </span>
                        <Flame
                          className={`h-4 w-4 ${
                            tenantAnalytics.erros2h > 0
                              ? "text-rose-600"
                              : "text-slate-400"
                          }`}
                        />
                      </div>
                      <div className="mt-2 flex items-baseline gap-2">
                        <span
                          className={`text-2xl font-bold ${
                            tenantAnalytics.erros2h > 0
                              ? "text-rose-600"
                              : "text-slate-900"
                          }`}
                        >
                          {tenantAnalytics.erros2h}
                        </span>
                        <span className="text-xs text-slate-500">em 2h</span>
                        <span className="text-xs text-slate-400">
                          ({tenantAnalytics.erros24h} em 24h)
                        </span>
                      </div>

                      {tenantAnalytics.avaliacaoGrupos && tenantAnalytics.avaliacaoGrupos.length > 0 ? (
                        <div className="mt-2.5 pt-2 border-t border-slate-100 space-y-1">
                          <div className="flex items-center justify-between text-[11px] font-semibold">
                            {tenantAnalytics.avaliacaoGrupos.some((g) => g.violouSLA) ? (
                              <span className="text-rose-600 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                {tenantAnalytics.avaliacaoGrupos.filter((g) => g.violouSLA).length} grupo(s) com SLA excedido
                              </span>
                            ) : (
                              <span className="text-emerald-600 flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                Todos os grupos dentro da margem
                              </span>
                            )}
                          </div>
                          <div className="space-y-0.5 max-h-16 overflow-y-auto">
                            {tenantAnalytics.avaliacaoGrupos.map((grp) => (
                              <div key={grp.id} className="flex items-center justify-between text-[10px]">
                                <span className="truncate text-slate-600 max-w-[120px] font-medium" title={grp.nome}>
                                  {grp.nome}:
                                </span>
                                <span
                                  className={`font-mono font-bold ${
                                    grp.violouSLA ? "text-rose-600" : "text-emerald-700"
                                  }`}
                                >
                                  {grp.totalErros}/{grp.limiteErros} ({grp.janelaValor}
                                  {grp.janelaUnidade === "horas" ? "h" : "d"})
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="mt-1 text-[11px] text-slate-500">
                          {tenantAnalytics.erros2h >= (tenantAnalytics.monitoring.thresholds.maxErros2h || 5)
                            ? "⚠️ Acima do limite tolerado"
                            : "Dentro da margem segura"}
                        </p>
                      )}
                    </div>

                    {/* Card 4: Nível de Risco Calculado */}
                    <div
                      className={`rounded-2xl border p-5 shadow-card-sm ${
                        tenantAnalytics.saude.nivelRisco === "CRITICO"
                          ? "border-rose-200 bg-rose-50/50"
                          : tenantAnalytics.saude.nivelRisco === "CHURN"
                          ? "border-amber-200 bg-amber-50/50"
                          : "border-emerald-200 bg-emerald-50/50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                          Saúde da Conta
                        </span>
                        <span className="text-xs font-bold text-slate-700">
                          Score: {tenantAnalytics.saude.scoreEngajamento}/100
                        </span>
                      </div>
                      <div className="mt-2">
                        {tenantAnalytics.saude.nivelRisco === "CRITICO" ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-800">
                            <Flame className="h-3.5 w-3.5" />
                            Crítico Técnico
                          </span>
                        ) : tenantAnalytics.saude.nivelRisco === "CHURN" ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Risco de Churn
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Saudável
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-[11px] text-slate-600 line-clamp-2">
                        {tenantAnalytics.saude.motivo}
                      </p>
                    </div>
                  </div>

                  {/* 3. Grid de Conteúdo Principal (Foco em Operação, Diagnóstico e Erros) */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Coluna 1 & 2: Centro Operacional & Falhas de Integração (2/3 da largura) */}
                    <div className="lg:col-span-2 space-y-6">
                      {/* Card de Diagnóstico Operacional & Adoção */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card-sm">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                          <div className="flex items-center gap-3">
                            <div
                              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                                tenantAnalytics.saude.nivelRisco === "CRITICO"
                                  ? "bg-rose-100 text-rose-700"
                                  : tenantAnalytics.saude.nivelRisco === "CHURN"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {tenantAnalytics.saude.nivelRisco === "CRITICO" ? (
                                <Flame className="h-5 w-5" />
                              ) : tenantAnalytics.saude.nivelRisco === "CHURN" ? (
                                <AlertTriangle className="h-5 w-5" />
                              ) : (
                                <ShieldCheck className="h-5 w-5" />
                              )}
                            </div>
                            <div>
                              <h3 className="text-base font-bold text-slate-900">
                                Diagnóstico de Saúde & Telemetria
                              </h3>
                              <p className="text-xs text-slate-500">
                                {tenantAnalytics.saude.statusOperacional}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-bold ${
                              tenantAnalytics.saude.nivelRisco === "CRITICO"
                                ? "bg-rose-100 text-rose-800"
                                : tenantAnalytics.saude.nivelRisco === "CHURN"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            Score: {tenantAnalytics.saude.scoreEngajamento}/100
                          </span>
                        </div>

                        <div className="space-y-3">
                          <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
                            <p className="text-xs font-semibold text-slate-800 leading-relaxed">
                              {tenantAnalytics.saude.motivo}
                            </p>
                          </div>

                          <div className="flex items-start gap-2.5 rounded-xl bg-indigo-50/60 border border-indigo-100/80 p-3 text-xs text-indigo-900">
                            <CheckCircle2 className="h-4 w-4 text-[#1D00EB] flex-shrink-0 mt-0.5" />
                            <div>
                              <span className="font-bold">Regra de Engajamento Ativa: </span>
                              <span>
                                A conta é considerada saudável se ao menos 1 membro da empresa
                                tiver acessado dentro da janela tolerada (
                                {tenantAnalytics.monitoring.thresholds.diasSemAcessoAlerta} dias).
                                O risco de churn por inatividade só é acionado se nenhum usuário
                                logar no período.
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Falhas de Integração Agrupadas por Canal e Tipo (errosintegracoes) */}
                      {errorGroups.length > 0 ? (
                        <div className="rounded-2xl border border-rose-200/90 bg-rose-50/20 p-5 shadow-card-sm space-y-4">
                          {/* Cabeçalho da Seção com Controles de Ordenação e Ações Globais */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-rose-100 pb-3">
                            <div className="flex items-center gap-2.5">
                              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-100 text-rose-600 shadow-xs">
                                <Flame className="h-5 w-5 text-rose-600" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <h4 className="text-xs font-bold text-rose-950 uppercase tracking-wide">
                                    Falhas de Integração Agrupadas
                                  </h4>
                                  <span className="rounded-full bg-rose-100 border border-rose-200 px-2 py-0.5 text-[11px] font-extrabold text-rose-700">
                                    {errorGroups.length} {errorGroups.length === 1 ? "grupo" : "grupos"}
                                  </span>
                                  <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 hidden md:inline">
                                    {errorGroups.reduce((acc, g) => acc + g.totalOcorrencias, 0)} falhas no total
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500 mt-0.5">
                                  Erros estritamente consolidados por mesmo Canal e mesmo Tipo de Operação
                                </p>
                              </div>
                            </div>

                            {/* Controles de Ordenação e Expandir/Recolher Todos */}
                            <div className="flex items-center gap-2 flex-wrap self-end sm:self-auto">
                              {/* Seletor de Ordenação */}
                              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-xs text-xs">
                                <button
                                  type="button"
                                  onClick={() => setErrorSortBy("volume")}
                                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold transition ${
                                    errorSortBy === "volume"
                                      ? "bg-rose-50 text-rose-700 shadow-xs"
                                      : "text-slate-600 hover:text-slate-900"
                                  }`}
                                  title="Ordenar por maior volume de falhas no topo"
                                >
                                  <ArrowUpDown className="h-3 w-3" />
                                  Maior Volume
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setErrorSortBy("recente")}
                                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold transition ${
                                    errorSortBy === "recente"
                                      ? "bg-rose-50 text-rose-700 shadow-xs"
                                      : "text-slate-600 hover:text-slate-900"
                                  }`}
                                  title="Ordenar por última ocorrência mais recente no topo"
                                >
                                  <Clock className="h-3 w-3" />
                                  Mais Recente
                                </button>
                              </div>

                              {/* Expandir / Recolher Todos */}
                              <button
                                type="button"
                                onClick={toggleAllErrorGroups}
                                className="px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 shadow-xs transition"
                              >
                                {errorGroups.every((g) => expandedErrorGroups[`${g.canal}_${g.tipo}`])
                                  ? "Recolher Todos"
                                  : "Expandir Todos"}
                              </button>
                            </div>
                          </div>

                          {/* Filtro Opcional por Canal (se houver mais de 1 canal) */}
                          {distinctErrorChannels.length > 1 && (
                            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mr-1">
                                Filtrar Canal:
                              </span>
                              <button
                                type="button"
                                onClick={() => setCanalErrorFilter("TODOS")}
                                className={`px-2 py-0.5 rounded-md text-xs font-semibold transition ${
                                  canalErrorFilter === "TODOS"
                                    ? "bg-slate-800 text-white shadow-xs"
                                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                                }`}
                              >
                                Todos ({distinctErrorChannels.length})
                              </button>
                              {distinctErrorChannels.map((canal) => {
                                const style = getChannelBadgeStyle(canal);
                                const isSelected = canalErrorFilter === canal;
                                return (
                                  <button
                                    key={canal}
                                    type="button"
                                    onClick={() => setCanalErrorFilter(isSelected ? "TODOS" : canal)}
                                    className={`px-2 py-0.5 rounded-md text-xs font-semibold border transition flex items-center gap-1.5 ${
                                      isSelected
                                        ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                                    }`}
                                  >
                                    <span
                                      className={`h-1.5 w-1.5 rounded-full ${
                                        isSelected ? "bg-white" : style.dot
                                      }`}
                                    />
                                    {style.label}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* Listagem de Cards Agrupados (Incidentes) */}
                          <div className="space-y-3">
                            {errorGroups.map((grupo) => {
                              const chave = `${grupo.canal}_${grupo.tipo}`;
                              const isExpanded = !!expandedErrorGroups[chave];
                              const channelStyle = getChannelBadgeStyle(grupo.canal);
                              const tipoBadgeClass = getTipoBadgeStyle(grupo.tipo);
                              const rawPayload = getRawPayloadDisplay(grupo);
                              const isCopied = copiedPayloadGroup === chave;
                              const isSilenciado = Boolean(
                                grupo.feedback?.silenciadoAte &&
                                  new Date(grupo.feedback.silenciadoAte).getTime() > Date.now()
                              );
                              const isPrazoExpirado = Boolean(
                                grupo.feedback?.silenciadoAte &&
                                  new Date(grupo.feedback.silenciadoAte).getTime() <= Date.now()
                              );

                              return (
                                <div
                                  key={chave}
                                  className={`rounded-xl border transition-all duration-200 ${
                                    isExpanded
                                      ? "border-rose-300 bg-white shadow-md ring-1 ring-rose-200/60"
                                      : "border-rose-200/80 bg-white hover:border-rose-300 hover:shadow-xs"
                                  }`}
                                >
                                  {/* Visão Fechada (Card do Incidente) - Cabeçalho Interativo */}
                                  <div
                                    onClick={() => toggleErrorGroup(chave)}
                                    className="p-4 cursor-pointer select-none space-y-2.5"
                                  >
                                    {/* Linha Superior: Badges do Canal e Tipo + Contador em Destaque + Data/Hora + Ação */}
                                    <div className="flex flex-wrap items-center justify-between gap-2.5">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {/* Tag do Canal com Estilo da Integração */}
                                        <span
                                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${channelStyle.bg}`}
                                        >
                                          <span className={`h-2 w-2 rounded-full ${channelStyle.dot}`} />
                                          {channelStyle.label}
                                        </span>

                                        {/* Tag do Tipo de Erro */}
                                        <span
                                          className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${tipoBadgeClass}`}
                                        >
                                          {grupo.tipo}
                                        </span>

                                        {/* Contador em Destaque (Badge chamativo de ocorrências) */}
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black bg-rose-100 text-rose-800 border border-rose-300 shadow-xs">
                                          <Flame className="h-3.5 w-3.5 text-rose-600" />
                                          {grupo.totalOcorrencias}{" "}
                                          {grupo.totalOcorrencias === 1
                                            ? "ocorrência"
                                            : "ocorrências"}
                                        </span>

                                        {/* Indicador de Silenciamento / Snooze se ativo */}
                                        {isSilenciado && (
                                          <span
                                            title={`Silenciado por ${grupo.feedback?.atualizadoPor || "CS"}`}
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-900 border border-amber-300 shadow-xs"
                                          >
                                            <Clock className="h-3.5 w-3.5 text-amber-600 animate-pulse" />
                                            <span>
                                              ⏳ Silenciado até{" "}
                                              {new Date(grupo.feedback!.silenciadoAte!).toLocaleDateString("pt-BR", {
                                                day: "2-digit",
                                                month: "2-digit",
                                              })}
                                            </span>
                                          </span>
                                        )}

                                        {isPrazoExpirado && (
                                          <span
                                            title="Prazo de silenciamento encerrou. O Agente voltará a alertar."
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-300"
                                          >
                                            <Bell className="h-3 w-3 text-slate-500" />
                                            Prazo expirado
                                          </span>
                                        )}
                                      </div>

                                      <div className="flex items-center gap-2.5 flex-wrap">
                                        {/* Data/Hora da Última Ocorrência */}
                                        <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                                          <Clock className="h-3.5 w-3.5 text-slate-400" />
                                          <span>
                                            Último registro:{" "}
                                            <strong className="text-slate-800 font-bold">
                                              {formatTempoRelativo(grupo.ultimaOcorrencia)}
                                            </strong>
                                          </span>
                                          <span className="text-[11px] text-slate-400 hidden lg:inline">
                                            ({new Date(grupo.ultimaOcorrencia).toLocaleTimeString("pt-BR", {
                                              hour: "2-digit",
                                              minute: "2-digit",
                                            })})
                                          </span>
                                        </div>

                                        {/* Botão de Observação / Silenciar (Snooze) */}
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenFeedbackModal(grupo);
                                          }}
                                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition border ${
                                            grupo.feedback?.observacao
                                              ? "bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100 shadow-xs"
                                              : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 shadow-xs"
                                          }`}
                                          title="Adicionar ou editar anotação do CS e silenciar alertas deste grupo"
                                        >
                                          <MessageSquare className="h-3.5 w-3.5 text-amber-600" />
                                          <span>
                                            {grupo.feedback?.observacao
                                              ? "Editar Nota"
                                              : "+ Adicionar Observação / Silenciar"}
                                          </span>
                                        </button>

                                        {/* Botão/Ícone de Chevron [Detalhes / Expandir] */}
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleErrorGroup(chave);
                                          }}
                                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition border ${
                                            isExpanded
                                              ? "bg-rose-50 text-rose-700 border-rose-200"
                                              : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                                          }`}
                                        >
                                          <span>{isExpanded ? "Recolher" : "Detalhes"}</span>
                                          <ChevronDown
                                            className={`h-3.5 w-3.5 transition-transform duration-200 ${
                                              isExpanded ? "rotate-180" : ""
                                            }`}
                                          />
                                        </button>
                                      </div>
                                    </div>

                                    {/* Resumo do Problema (Mensagem Clara de Falha) */}
                                    <div className="flex items-start gap-2 pt-0.5">
                                      <AlertCircle className="h-4 w-4 text-rose-500 flex-shrink-0 mt-0.5" />
                                      <p className="font-mono text-xs font-semibold text-slate-800 leading-relaxed break-words">
                                        {grupo.resumoMensagem}
                                      </p>
                                    </div>

                                    {/* Nota do CS e Alinhamento Registrado */}
                                    {grupo.feedback?.observacao && (
                                      <div className="mt-2.5 flex items-start gap-2.5 rounded-xl bg-amber-50/90 border border-amber-200 p-3 text-xs text-amber-950 shadow-xs">
                                        <MessageSquare className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                                            <span className="font-bold text-amber-950 flex items-center gap-1.5">
                                              Nota do CS:
                                            </span>
                                            <div className="flex items-center gap-2 text-[11px] text-amber-800/80 font-medium">
                                              {grupo.feedback.atualizadoPor && (
                                                <span>por {grupo.feedback.atualizadoPor}</span>
                                              )}
                                              {grupo.feedback.atualizadoEm && (
                                                <span>• {formatTempoRelativo(grupo.feedback.atualizadoEm)}</span>
                                              )}
                                            </div>
                                          </div>
                                          <p className="font-medium text-slate-800 whitespace-pre-wrap leading-relaxed">
                                            {grupo.feedback.observacao}
                                          </p>
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {/* Visão Expandida (Gaveta / Acordeão ao clicar no grupo) */}
                                  {isExpanded && (
                                    <div className="border-t border-slate-100 bg-slate-50/70 p-4 rounded-b-xl space-y-4">
                                      {/* Os codigoRegistro dos anúncios/pedidos com falha */}
                                      <div>
                                        <div className="flex items-center justify-between mb-2">
                                          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                            <Tag className="h-3.5 w-3.5 text-[#1D00EB]" />
                                            Códigos / Registros com Falha:
                                          </span>
                                          <span className="text-[11px] text-slate-500 font-medium">
                                            {grupo.amostraRegistros.length > 0
                                              ? `Amostragem de até 5 registros (${grupo.totalOcorrencias} no grupo)`
                                              : `${grupo.itens.length} registro(s) associado(s)`}
                                          </span>
                                        </div>

                                        {grupo.amostraRegistros.length > 0 ? (
                                          <div className="flex flex-wrap items-center gap-2">
                                            {grupo.amostraRegistros.map((cod, i) => (
                                              <span
                                                key={i}
                                                className="inline-flex items-center gap-1 font-mono text-xs font-bold px-2.5 py-1 rounded-lg bg-white border border-indigo-200 text-[#1D00EB] shadow-xs"
                                              >
                                                <span className="text-slate-400 font-normal">#</span>
                                                {String(cod)}
                                              </span>
                                            ))}
                                            {grupo.totalOcorrencias > grupo.amostraRegistros.length && (
                                              <span className="text-[11px] font-semibold text-slate-600 bg-slate-200/80 px-2.5 py-1 rounded-lg">
                                                +{grupo.totalOcorrencias - grupo.amostraRegistros.length} outros itens no mesmo grupo
                                              </span>
                                            )}
                                          </div>
                                        ) : (
                                          <div className="text-xs text-slate-500 italic bg-white px-3 py-2 rounded-lg border border-slate-200">
                                            Nenhum identificador individual (SKU/Pedido) informado no registro de evento.
                                          </div>
                                        )}
                                      </div>

                                      {/* A resposta técnica bruta da requisição (requisicao.retorno.data) */}
                                      <div>
                                        <div className="flex items-center justify-between mb-2">
                                          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                            <Code className="h-3.5 w-3.5 text-amber-600" />
                                            Resposta Técnica Bruta da Requisição (requisicao.retorno.data):
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => handleCopyPayload(rawPayload, chave)}
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 shadow-xs transition"
                                          >
                                            {isCopied ? (
                                              <>
                                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                                                <span className="text-emerald-700 font-bold">Copiado!</span>
                                              </>
                                            ) : (
                                              <>
                                                <Copy className="h-3.5 w-3.5 text-slate-500" />
                                                <span>Copiar Payload JSON</span>
                                              </>
                                            )}
                                          </button>
                                        </div>

                                        <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-[#0A0F1D] p-3.5 shadow-inner">
                                          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80 text-[10px] text-slate-400 font-mono">
                                            <span>Payload de Retorno ({grupo.canal} / {grupo.tipo})</span>
                                            <span>JSON formatado</span>
                                          </div>
                                          <pre className="font-mono text-xs leading-relaxed overflow-x-auto max-h-56 scrollbar-thin text-emerald-400 selection:bg-emerald-800 selection:text-white">
                                            {rawPayload}
                                          </pre>
                                        </div>
                                      </div>

                                      {/* Histórico detalhado de ocorrências do grupo */}
                                      {grupo.itens.length > 1 && (
                                        <div className="pt-1">
                                          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
                                            Ocorrências Consolidadas neste Grupo ({grupo.itens.length}):
                                          </span>
                                          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                                            {grupo.itens.slice(0, 10).map((it, idx) => (
                                              <div
                                                key={idx}
                                                className="text-xs bg-white p-2.5 rounded-lg border border-slate-200 flex items-center justify-between gap-3 shadow-2xs"
                                              >
                                                <div className="flex items-center gap-2 truncate">
                                                  {it.codigoRegistro && (
                                                    <span className="font-mono text-[11px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 flex-shrink-0">
                                                      #{it.codigoRegistro}
                                                    </span>
                                                  )}
                                                  <span className="font-mono text-[11px] text-slate-700 truncate">
                                                    {it.mensagem}
                                                  </span>
                                                </div>
                                                <span className="text-[10px] text-slate-400 whitespace-nowrap flex-shrink-0 font-medium">
                                                  {new Date(it.data).toLocaleString("pt-BR")}
                                                </span>
                                              </div>
                                            ))}
                                            {grupo.itens.length > 10 && (
                                              <p className="text-[10px] text-slate-400 text-center italic py-1">
                                                Exibindo 10 de {grupo.itens.length} ocorrências do grupo.
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-card-sm flex items-center gap-3.5">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
                          <div>
                            <p className="text-xs font-bold text-emerald-900">
                              Nenhuma Falha de Integração Pendente
                            </p>
                            <p className="text-[11px] text-emerald-700 mt-0.5">
                              Todos os canais integrados (VTEX, Mercado Livre, Shopee) estão
                              sincronizando dados normalmente sem anomalias nas últimas horas.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Seção Secundária no Final da Página: Usuários Vinculados (Colapsável/Acordeão) */}
                      <div className="rounded-2xl border border-slate-200 bg-white shadow-card-sm overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setShowUsersTable((prev) => !prev)}
                          className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50/60 transition"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                              <Users className="h-4 w-4" />
                            </div>
                            <div>
                              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                Usuários Vinculados ({tenantAnalytics.usuarios.length})
                              </h3>
                              <p className="text-xs text-slate-500 mt-0.5">
                                Visualização secundária de membros cadastrados no MongoDB (clique
                                para {showUsersTable ? "recolher" : "expandir"})
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[#1D00EB]">
                              {showUsersTable ? "Recolher lista" : "Ver usuários"}
                            </span>
                            <ChevronDown
                              className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${
                                showUsersTable ? "rotate-180" : ""
                              }`}
                            />
                          </div>
                        </button>

                        {showUsersTable && (
                          <div className="border-t border-slate-200">
                            {tenantAnalytics.usuarios.length === 0 ? (
                              <div className="py-8 text-center text-slate-400 text-xs">
                                Nenhum usuário cadastrado para esta empresa no banco de dados.
                              </div>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs table-zebra">
                                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                                    <tr>
                                      <th className="px-6 py-3 font-semibold">Nome / E-mail</th>
                                      <th className="px-4 py-3 font-semibold">Cargo</th>
                                      <th className="px-4 py-3 font-semibold">Último Acesso</th>
                                      <th className="px-6 py-3 text-right font-semibold">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {tenantAnalytics.usuarios.map((u) => (
                                      <tr key={u._id} className="transition-colors">
                                        <td className="px-6 py-3.5">
                                          <div className="font-semibold text-slate-900">{u.nome}</div>
                                          <div className="text-[11px] text-slate-400">{u.email}</div>
                                        </td>
                                        <td className="px-4 py-3.5 text-slate-600">{u.cargo}</td>
                                        <td className="px-4 py-3.5">
                                          {u.statusAcesso === "recente" ? (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                              {u.diasSemAcesso === 0
                                                ? "Hoje"
                                                : `${u.diasSemAcesso}d atrás`}
                                            </span>
                                          ) : u.statusAcesso === "moderado" ? (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200">
                                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                              {u.diasSemAcesso}d atrás
                                            </span>
                                          ) : (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-[10px] font-semibold text-rose-700 border border-rose-200">
                                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                                              {u.diasSemAcesso === "Nunca acessou"
                                                ? "Nunca acessou"
                                                : `${u.diasSemAcesso}d inativo`}
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-6 py-3.5 text-right font-medium text-slate-500">
                                          {u.statusAcesso === "recente" ? "Ativo" : "Desengajado"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Coluna 3: Configurações de Limiares / Thresholds (1/3 da largura) */}
                    <div className="space-y-6">
                      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card-sm">
                        <div className="flex items-center gap-2 border-b border-slate-200 pb-3 mb-4">
                          <Sliders className="h-4 w-4 text-[#1D00EB]" />
                          <div>
                            <h3 className="text-sm font-bold text-slate-900">
                              Limiares de Alerta
                            </h3>
                            <p className="text-[11px] text-slate-400">
                              Regras de monitoramento no Firestore
                            </p>
                          </div>
                        </div>

                        {saveSuccessMsg && (
                          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                            <span>{saveSuccessMsg}</span>
                          </div>
                        )}

                        <div className="space-y-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              Dias sem Acesso (Alerta de Churn)
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="1"
                                max="60"
                                value={
                                  tenantAnalytics.monitoring.thresholds.diasSemAcessoAlerta
                                }
                                onChange={(e) =>
                                  handleUpdateAnalyticsThreshold(
                                    "diasSemAcessoAlerta",
                                    e.target.value
                                  )
                                }
                                className="w-24 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-semibold text-slate-900 focus:border-[#1D00EB] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1D00EB]"
                              />
                              <span className="text-xs text-slate-500">dias de tolerância</span>
                            </div>
                          </div>

                          {/* Gerenciador de Grupos de Regras Customizados */}
                          <div className="border-t border-slate-100 pt-3 space-y-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                  <Layers className="h-3.5 w-3.5 text-[#1D00EB]" />
                                  <span>Grupos de Monitoramento</span>
                                </label>
                                <p className="text-[11px] text-slate-400">
                                  Regras independentes de limite e janela por tipo de erro
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={handleAddGrupoMonitoramento}
                                className="inline-flex items-center gap-1 rounded-lg bg-[#1D00EB]/10 px-2.5 py-1 text-xs font-bold text-[#1D00EB] hover:bg-[#1D00EB]/20 border border-[#1D00EB]/30 transition"
                                title="Adicionar novo grupo de monitoramento"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                <span>+ Adicionar Grupo de Regras</span>
                              </button>
                            </div>

                            {/* Lista de Cards de Grupos */}
                            <div className="space-y-3">
                              {(tenantAnalytics.monitoring.thresholds.gruposMonitoramento || []).map(
                                (grupo, idx) => {
                                  const isPickerOpen = Boolean(openGroupTypeSelector[grupo.id]);
                                  const searchTerm = (groupSearchTerms[grupo.id] || "")
                                    .toLowerCase()
                                    .trim();
                                  const tiposDisponiveis = searchTerm
                                    ? TIPOS_ERROS_INTEGRACOES.filter((t) =>
                                        t.toLowerCase().includes(searchTerm)
                                      )
                                    : TIPOS_ERROS_INTEGRACOES;
                                  const avaliacao = tenantAnalytics.avaliacaoGrupos?.find(
                                    (a) => a.id === grupo.id
                                  );

                                  return (
                                    <div
                                      key={grupo.id}
                                      className={`rounded-xl border p-3.5 transition-all space-y-3 shadow-xs ${
                                        avaliacao?.violouSLA
                                          ? "border-rose-300 bg-rose-50/20"
                                          : "border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50"
                                      }`}
                                    >
                                      {/* Cabeçalho do Card do Grupo */}
                                      <div className="flex items-center justify-between gap-2 border-b border-slate-200/60 pb-2">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1D00EB] text-[10px] font-bold text-white shadow-xs">
                                            {idx + 1}
                                          </span>
                                          <span className="text-xs font-bold text-slate-800">
                                            Regra #{idx + 1}
                                          </span>
                                          {avaliacao && (
                                            <span
                                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                                avaliacao.violouSLA
                                                  ? "bg-rose-100 text-rose-700 border border-rose-200"
                                                  : "bg-emerald-100 text-emerald-700 border border-emerald-200"
                                              }`}
                                            >
                                              {avaliacao.violouSLA
                                                ? `SLA Violado (${avaliacao.totalErros}/${grupo.limiteErros})`
                                                : `OK (${avaliacao.totalErros}/${grupo.limiteErros})`}
                                            </span>
                                          )}
                                        </div>

                                        {(tenantAnalytics.monitoring.thresholds.gruposMonitoramento?.length || 0) > 1 && (
                                          <button
                                            type="button"
                                            onClick={() => handleRemoveGrupoMonitoramento(grupo.id)}
                                            className="text-slate-400 hover:text-rose-600 p-1 rounded-md hover:bg-rose-50 transition"
                                            title="Excluir este grupo de regras"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </button>
                                        )}
                                      </div>

                                      {/* Nome do Grupo */}
                                      <div>
                                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                                          Nome do Grupo
                                        </label>
                                        <input
                                          type="text"
                                          value={grupo.nome}
                                          onChange={(e) =>
                                            handleUpdateGrupoMonitoramento(grupo.id, "nome", e.target.value)
                                          }
                                          placeholder="Ex: Erros Críticos de Venda, Operação de Pedidos..."
                                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:border-[#1D00EB] focus:outline-none focus:ring-1 focus:ring-[#1D00EB]"
                                        />
                                      </div>

                                      {/* Limite de Ocorrências & Janela de Observação */}
                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                                            Limite de Ocorrências
                                          </label>
                                          <div className="flex items-center gap-1.5">
                                            <input
                                              type="number"
                                              min="1"
                                              max="500"
                                              value={grupo.limiteErros}
                                              onChange={(e) =>
                                                handleUpdateGrupoMonitoramento(
                                                  grupo.id,
                                                  "limiteErros",
                                                  Math.max(1, Number(e.target.value) || 1)
                                                )
                                              }
                                              className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs font-bold text-rose-600 focus:border-[#1D00EB] focus:outline-none focus:ring-1 focus:ring-[#1D00EB]"
                                            />
                                            <span className="text-[11px] text-slate-500">tolerados</span>
                                          </div>
                                        </div>

                                        <div>
                                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                                            Janela de Observação
                                          </label>
                                          <div className="flex items-center gap-1">
                                            <input
                                              type="number"
                                              min="1"
                                              max={grupo.janelaUnidade === "horas" ? 72 : 30}
                                              value={grupo.janelaValor}
                                              onChange={(e) =>
                                                handleUpdateGrupoMonitoramento(
                                                  grupo.id,
                                                  "janelaValor",
                                                  Math.max(1, Number(e.target.value) || 1)
                                                )
                                              }
                                              className="w-14 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs font-bold text-slate-900 focus:border-[#1D00EB] focus:outline-none focus:ring-1 focus:ring-[#1D00EB]"
                                            />
                                            <select
                                              value={grupo.janelaUnidade}
                                              onChange={(e) =>
                                                handleUpdateGrupoMonitoramento(
                                                  grupo.id,
                                                  "janelaUnidade",
                                                  e.target.value as "horas" | "dias"
                                                )
                                              }
                                              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-700 focus:border-[#1D00EB] focus:outline-none focus:ring-1 focus:ring-[#1D00EB]"
                                            >
                                              <option value="horas">Horas</option>
                                              <option value="dias">Dias</option>
                                            </select>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Seleção de Tipos */}
                                      <div className="border-t border-slate-200/60 pt-2 space-y-1.5">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                                            <Tag className="h-3 w-3 text-[#1D00EB]" />
                                            <span>Tipos Suportados</span>
                                          </span>
                                          <div className="flex items-center gap-1.5 text-[10px]">
                                            <button
                                              type="button"
                                              onClick={() => handleSelectAllTiposInGrupo(grupo.id)}
                                              className="text-[#1D00EB] font-bold hover:underline"
                                            >
                                              Todos
                                            </button>
                                            <span className="text-slate-300">|</span>
                                            <button
                                              type="button"
                                              onClick={() => handleClearAllTiposInGrupo(grupo.id)}
                                              className="text-slate-500 hover:text-rose-600 font-bold"
                                            >
                                              Limpar
                                            </button>
                                            <span className="text-slate-300">|</span>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setOpenGroupTypeSelector((prev) => ({
                                                  ...prev,
                                                  [grupo.id]: !prev[grupo.id],
                                                }))
                                              }
                                              className="text-[#1D00EB] font-bold hover:underline"
                                            >
                                              {isPickerOpen ? "Recolher" : "Configurar"}
                                            </button>
                                          </div>
                                        </div>

                                        {/* Badges dos Tipos Atualmente Selecionados */}
                                        <div className="min-h-[32px] rounded-lg border border-slate-200/80 bg-white p-1.5">
                                          {(!grupo.tipos || grupo.tipos.length === 0) ? (
                                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 py-0.5 px-1">
                                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                                              <span>Todos os tipos (Geral da Operação)</span>
                                            </div>
                                          ) : (
                                            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                                              {grupo.tipos.map((tipo) => (
                                                <span
                                                  key={tipo}
                                                  className="inline-flex items-center gap-1 rounded-md bg-[#1D00EB]/10 border border-[#1D00EB]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#1D00EB]"
                                                >
                                                  <span>{tipo}</span>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleToggleTipoInGrupo(grupo.id, tipo)}
                                                    className="text-[#1D00EB]/60 hover:text-rose-600"
                                                    title={`Remover ${tipo}`}
                                                  >
                                                    <X className="h-2.5 w-2.5" />
                                                  </button>
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </div>

                                        {/* Seletor Expansível de Tipos */}
                                        {isPickerOpen && (
                                          <div className="rounded-lg border border-slate-200 bg-white p-2 space-y-2 mt-1 shadow-xs">
                                            <div className="relative">
                                              <Search className="absolute left-2 top-2 h-3 w-3 text-slate-400" />
                                              <input
                                                type="text"
                                                placeholder="Filtrar tipos (ex: Pedido, Anúncio)..."
                                                value={groupSearchTerms[grupo.id] || ""}
                                                onChange={(e) =>
                                                  setGroupSearchTerms((prev) => ({
                                                    ...prev,
                                                    [grupo.id]: e.target.value,
                                                  }))
                                                }
                                                className="w-full rounded-md border border-slate-200 pl-6 pr-2 py-1 text-[11px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#1D00EB]"
                                              />
                                            </div>

                                            <div className="max-h-28 overflow-y-auto flex flex-wrap gap-1 pr-1">
                                              {tiposDisponiveis.map((tipo) => {
                                                const isSelected = Boolean(grupo.tipos?.includes(tipo));
                                                return (
                                                  <button
                                                    key={tipo}
                                                    type="button"
                                                    onClick={() => handleToggleTipoInGrupo(grupo.id, tipo)}
                                                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition ${
                                                      isSelected
                                                        ? "bg-[#1D00EB] text-white font-bold"
                                                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                                    }`}
                                                  >
                                                    {isSelected && <Check className="h-2.5 w-2.5" />}
                                                    <span>{tipo}</span>
                                                  </button>
                                                );
                                              })}
                                              {tiposDisponiveis.length === 0 && (
                                                <span className="text-[10px] text-slate-400 p-1">
                                                  Nenhum tipo encontrado.
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                }
                              )}
                            </div>
                          </div>

                          <div className="border-t border-slate-100 pt-3">
                            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                              CS Responsável (Sessão Ativa)
                            </label>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                              <div className="flex items-center gap-2.5">
                                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1D00EB]/10 text-[#1D00EB]">
                                  <User className="h-3.5 w-3.5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-bold text-slate-900 truncate">
                                    {currentUser?.name || "Analista de CS"}
                                  </div>
                                  <div className="text-[11px] text-slate-500 font-mono truncate">
                                    {currentUser?.email || "Autenticado"}
                                  </div>
                                </div>
                              </div>
                              <p className="mt-2 text-[10px] text-slate-400">
                                Capturado automaticamente via Firebase Auth (sem digitação manual)
                              </p>
                            </div>
                          </div>

                          <button
                            onClick={handleSaveAccountRules}
                            disabled={savingSettings}
                            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#1D00EB] hover:bg-[#1500B8] py-2.5 text-xs font-semibold text-white shadow-card-sm transition disabled:opacity-50"
                          >
                            {savingSettings ? (
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                            <span>Salvar Regras de Monitoramento</span>
                          </button>
                        </div>
                      </div>

                      {/* Card com Ação Recomendada da IA */}
                      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card-sm">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-900 mb-2">
                          <Sparkles className="h-4 w-4 text-[#1D00EB]" />
                          <span>Recomendação Preventiva</span>
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          {tenantAnalytics.saude.acaoRecomendada}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            /* ========================================================== */
            /* MODO B: COCKPIT GERAL CONSOLIDADO COM FEED DE ALERTAS       */
            /* ========================================================== */
            <div className="space-y-8">
              {/* Cards Executivos (Grid 4 colunas) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Card 1: Empresas no Banco */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card-sm">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-xs font-semibold uppercase tracking-wider">
                      Empresas no Banco
                    </span>
                    <Building2 className="h-4 w-4 text-slate-500" />
                  </div>
                  <div className="mt-2 text-3xl font-bold text-slate-900">{totalNoMongo}</div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Collection MongoDB `entidades`
                  </p>
                </div>

                {/* Card 2: Monitoramento Ativo */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card-sm">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-xs font-semibold uppercase tracking-wider">
                      Monitoramento Ativo
                    </span>
                    <ShieldCheck className="h-4 w-4 text-[#1D00EB]" />
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-[#1D00EB]">
                      {totalMonitoradas}
                    </span>
                    <span className="text-xs text-slate-400">
                      de {totalNoMongo} no banco
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Na sua carteira ({currentUser?.name || "CS"})
                  </p>
                </div>

                {/* Card 3: Risco de Churn */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card-sm">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-xs font-semibold uppercase tracking-wider">
                      Risco de Churn
                    </span>
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  </div>
                  <div className="mt-2 text-3xl font-bold text-amber-600">{totalChurn}</div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {totalChurn === 1 ? "1 conta em risco na sua carteira" : `${totalChurn} contas em risco na sua carteira`}
                  </p>
                </div>

                {/* Card 4: Alertas Críticos */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card-sm">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="text-xs font-semibold uppercase tracking-wider">
                      Alertas Críticos
                    </span>
                    <Flame className="h-4 w-4 text-rose-500" />
                  </div>
                  <div className="mt-2 text-3xl font-bold text-rose-600">
                    {totalCriticos}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {totalCriticos === 1 ? "1 conta crítica na sua carteira" : `${totalCriticos} contas críticas na sua carteira`}
                  </p>
                </div>
              </div>

              {/* Feed da Central de Alertas */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-card-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 px-6 py-4 gap-3">
                  <div className="flex items-center gap-2.5">
                    <Bell className="h-4 w-4 text-[#1D00EB]" />
                    <h2 className="text-sm font-bold text-slate-900">
                      Central de Alertas Preventivos
                    </h2>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                      {alerts.length} registros
                    </span>
                  </div>

                  {/* Filtros de Risco */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setRiskFilter("TODOS")}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                        riskFilter === "TODOS"
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      Todos ({alerts.length})
                    </button>
                    <button
                      onClick={() => setRiskFilter("CRITICO")}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                        riskFilter === "CRITICO"
                          ? "bg-rose-600 text-white"
                          : "bg-rose-50 text-rose-700 hover:bg-rose-100"
                      }`}
                    >
                      Crítico ({totalCriticos})
                    </button>
                    <button
                      onClick={() => setRiskFilter("CHURN")}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                        riskFilter === "CHURN"
                          ? "bg-amber-600 text-white"
                          : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                      }`}
                    >
                      Risco de Churn ({totalChurn})
                    </button>
                  </div>
                </div>

                {loading ? (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin text-[#1D00EB]" />
                    <p className="mt-2 text-xs">Consultando histórico no Firestore...</p>
                  </div>
                ) : filteredAlerts.length === 0 ? (
                  <div className="py-16 text-center text-slate-400">
                    <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500 opacity-80 mb-2" />
                    <p className="text-sm font-bold text-slate-800">
                      Nenhum alerta pendente no momento
                    </p>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                      Todas as contas monitoradas estão com engajamento estável e sem ocorrência de falhas técnicas.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {filteredAlerts.map((alert, idx) => {
                      const isCritico =
                        alert.tipoRisco.includes("CRITICO") ||
                        alert.tipoRisco.includes("TECNICO");

                      return (
                        <div
                          key={alert.id || idx}
                          className="flex flex-col sm:flex-row sm:items-start justify-between p-6 gap-4 hover:bg-slate-50/50 transition-colors"
                        >
                          <div className="space-y-2 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {/* Badge de Risco */}
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                  isCritico
                                    ? "bg-rose-50 text-rose-700 border border-rose-200"
                                    : "bg-amber-50 text-amber-700 border border-amber-200"
                                }`}
                              >
                                {isCritico ? (
                                  <Flame className="h-3 w-3" />
                                ) : (
                                  <AlertTriangle className="h-3 w-3" />
                                )}
                                {alert.tipoRisco}
                              </span>

                              {/* Badge de Status Ativo / Resolvido */}
                              {alert.status === "resolvido" ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                  Resolvido
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200 px-2.5 py-0.5 text-xs font-bold text-rose-700">
                                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                                  Ativo
                                </span>
                              )}

                              <span className="font-bold text-sm text-slate-900">
                                {alert.entidadeNome}
                              </span>

                              <span className="text-[11px] text-slate-400">
                                {alert.ultimaOcorrencia
                                  ? `Última ocorrência: ${new Date(alert.ultimaOcorrencia).toLocaleString("pt-BR")}`
                                  : alert.disparadoEm
                                  ? `Disparado: ${new Date(alert.disparadoEm).toLocaleString("pt-BR")}`
                                  : "Data não informada"}
                              </span>

                              {alert.resolvidoEm && (
                                <span className="text-[11px] font-medium text-emerald-600">
                                  • Resolvido em: {new Date(alert.resolvidoEm).toLocaleString("pt-BR")}
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-slate-700 font-medium">
                              {alert.motivo}
                            </p>

                            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-800">
                              <span className="font-bold text-[#1D00EB]">
                                Ação Recomendada pela IA:{" "}
                              </span>
                              {alert.acaoRecomendada}
                            </div>
                          </div>

                          {/* Botão de Atalho para o Raio-X da Empresa */}
                          {alert.entidadeNome && (
                            <button
                              onClick={() => {
                                const found = entidades.find(
                                  (e) =>
                                    e.nome.toLowerCase() ===
                                    alert.entidadeNome.toLowerCase()
                                );
                                if (found) {
                                  handleSelectTenant(found._id);
                                }
                              }}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-[#1D00EB] hover:text-[#1D00EB] transition self-start sm:self-center shadow-card-sm"
                            >
                              <span>Ver Raio-X</span>
                              <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ============================================================ */}
      {/* 3. MODAL DE EXECUÇÃO DA IA (KENIT AUDIT COCKPIT)             */}
      {/* ============================================================ */}
      {showExecutionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            {/* Topo do Modal */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#F8FAFC] px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EEF0FF] text-[#1D00EB]">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Auditoria de Observabilidade com Gemini
                  </h3>
                  <p className="text-xs text-slate-500">
                    Agente Autônomo com Function Calling nativo e análise de telemetria
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowExecutionModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Conteúdo do Modal */}
            <div className="max-h-[70vh] overflow-y-auto p-6 space-y-5">
              {/* Terminal de Logs */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-2">
                  <span>Logs da Execução do Agente</span>
                  {runningAgent && (
                    <span className="flex items-center gap-1.5 text-xs text-[#1D00EB]">
                      <span className="h-2 w-2 rounded-full bg-[#1D00EB] animate-pulse" />
                      Processando...
                    </span>
                  )}
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-slate-200 max-h-60 overflow-y-auto space-y-1.5">
                  {agentLogs.map((log, index) => (
                    <div
                      key={index}
                      className={
                        log.includes("❌")
                          ? "text-rose-400"
                          : log.includes("⚠️")
                          ? "text-amber-400"
                          : log.includes("🚨")
                          ? "text-rose-300 font-bold"
                          : log.includes("✅")
                          ? "text-emerald-400"
                          : "text-slate-300"
                      }
                    >
                      {log}
                    </div>
                  ))}
                </div>
              </div>

              {/* Relatório Executivo Gerado pelo Gemini */}
              {executiveReport && (
                <div className="rounded-2xl border border-slate-200 bg-[#F8FAFC] p-5">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900 mb-3">
                    <FileText className="h-4 w-4 text-[#1D00EB]" />
                    <span>Parecer Executivo do Especialista em CS (IA)</span>
                  </div>
                  <div className="whitespace-pre-wrap text-xs text-slate-700 leading-relaxed font-sans bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    {executiveReport}
                  </div>
                </div>
              )}
            </div>

            {/* Rodapé do Modal */}
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
              <span className="text-xs text-slate-500">
                {runningAgent
                  ? "Analisando MongoDB e disparando alertas no Firestore..."
                  : "Auditoria finalizada com sucesso."}
              </span>

              <button
                onClick={() => setShowExecutionModal(false)}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition"
              >
                Fechar Janela
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 4. MODAL DE PRÉVIA DO E-MAIL (PADRÃO VISUAL KENIT)           */}
      {/* ============================================================ */}
      {showEmailPreviewModal && emailPreviewHtml && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            {/* Topo do Modal */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#F8FAFC] px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EEF0FF] text-[#1D00EB]">
                  <Mail className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Prévia do E-mail Prescritivo • Padrão Visual Kenit
                  </h3>
                  <p className="text-xs text-slate-500">
                    Template HTML responsivo emitido para {currentUser?.email || "o analista de CS"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowEmailPreviewModal(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Visualizador do HTML via iframe isolado */}
            <div className="flex-1 bg-slate-100 p-4 overflow-hidden">
              <iframe
                title="Kenit Email Preview"
                srcDoc={emailPreviewHtml}
                className="w-full h-full min-h-[560px] rounded-xl border border-slate-200 bg-white shadow-sm"
              />
            </div>

            {/* Rodapé do Modal */}
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3.5">
              <span className="text-xs text-slate-500">
                Renderização fiel para clientes de e-mail (Gmail, Outlook, Apple Mail).
              </span>
              <button
                onClick={() => setShowEmailPreviewModal(false)}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition"
              >
                Fechar Prévia
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 5. MODAL DE OBSERVAÇÃO E SILENCIAMENTO (SNOOZE)              */}
      {/* ============================================================ */}
      {feedbackModalOpen && feedbackTargetGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-100 overflow-hidden flex flex-col">
            {/* Cabeçalho do Modal */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50/70">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Observação e Silenciamento (Snooze)
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Grupo: <strong className="text-slate-800">{feedbackTargetGroup.canal}</strong> •{" "}
                    <strong className="text-slate-800">{feedbackTargetGroup.tipo}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFeedbackModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Conteúdo do Modal */}
            <div className="p-6 space-y-5">
              {/* Contexto do Erro */}
              <div className="rounded-xl bg-rose-50/70 border border-rose-200/60 p-3 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-rose-900">
                    Resumo das Falhas ({feedbackTargetGroup.totalOcorrencias}{" "}
                    {feedbackTargetGroup.totalOcorrencias === 1 ? "registro" : "registros"}):
                  </span>
                  <span className="text-[11px] text-rose-600 font-medium">
                    {formatTempoRelativo(feedbackTargetGroup.ultimaOcorrencia)}
                  </span>
                </div>
                <p className="font-mono text-[11px] text-rose-800 leading-relaxed line-clamp-2">
                  {feedbackTargetGroup.resumoMensagem}
                </p>
              </div>

              {/* Campo de Texto da Observação */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Observação ou alinhamento com o cliente
                </label>
                <textarea
                  rows={3}
                  value={feedbackObservacao}
                  onChange={(e) => setFeedbackObservacao(e.target.value)}
                  placeholder="Ex: Cliente já avisado, TI deles vai corrigir semana que vem..."
                  className="w-full rounded-xl border border-slate-200 p-3 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#1D00EB] focus:ring-1 focus:ring-[#1D00EB] leading-relaxed transition"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Esta nota é exibida diretamente no card do grupo para a equipe de CS.
                </span>
              </div>

              {/* Seletor 'Lembrar-me em / Silenciar por' */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-slate-500" />
                  Lembrar-me em / Silenciar por:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { dias: 0, label: "Manter ativo", sub: "Sem silenciar" },
                    { dias: 1, label: "1 dia", sub: "24 horas" },
                    { dias: 2, label: "2 dias", sub: "48 horas" },
                    { dias: 3, label: "3 dias", sub: "72 horas" },
                    { dias: 7, label: "7 dias", sub: "1 semana" },
                  ].map((opt) => {
                    const isSelected = feedbackLembrarEmDias === opt.dias;
                    return (
                      <button
                        key={opt.dias}
                        type="button"
                        onClick={() => setFeedbackLembrarEmDias(opt.dias)}
                        className={`flex flex-col items-center justify-center p-2 rounded-xl border text-center transition ${
                          isSelected
                            ? "border-[#1D00EB] bg-indigo-50/80 text-[#1D00EB] font-bold shadow-xs ring-1 ring-[#1D00EB]"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 font-medium"
                        }`}
                      >
                        <span className="text-xs">{opt.label}</span>
                        <span className="text-[10px] text-slate-400 font-normal">
                          {opt.sub}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {feedbackLembrarEmDias > 0 ? (
                  <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-900">
                    <Clock className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <span>
                      O Agente IA <strong>não disparará novos alertas</strong> sobre este grupo até{" "}
                      <strong>
                        {new Date(Date.now() + feedbackLembrarEmDias * 86400000).toLocaleDateString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                      </strong>.
                    </span>
                  </div>
                ) : (
                  <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-xs text-slate-600">
                    <Bell className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <span>
                      O grupo continuará ativo normalmente para análise e alertas do Agente IA.
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Rodapé do Modal */}
            <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 bg-slate-50/70 px-6 py-4">
              <button
                type="button"
                onClick={() => setFeedbackModalOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={savingFeedback}
                onClick={handleSaveFeedback}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#1D00EB] px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition disabled:opacity-60 shadow-xs"
              >
                {savingFeedback ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="h-3.5 w-3.5" />
                    Salvar Observação
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast de Notificação de Persistência */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 shadow-xl transition-all">
          {toastMessage.type === "success" ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
          ) : toastMessage.type === "warning" ? (
            <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 text-rose-600 flex-shrink-0" />
          )}
          <span className="text-xs font-semibold text-slate-800">
            {toastMessage.text}
          </span>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 text-slate-400 hover:text-slate-600 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
