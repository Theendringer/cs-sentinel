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
  ArrowLeft,
  Bell,
  Sliders,
  Mail,
  User,
  Clock,
  ShieldCheck,
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
} from "lucide-react";
import { TIPOS_ERROS_INTEGRACOES } from "@/lib/constants";

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
    maxErros2h: number;
    tiposMonitorados?: string[];
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

interface AnalyticsConta {
  totalUsuarios: number;
  ativos7d: number;
  ativos15d: number;
  ativos30d: number;
  taxaAdesao7d: number;
  taxaAdesao30d: number;
  erros2h: number;
  erros24h: number;
  amostraErros: Array<{
    mensagem: string;
    data: string;
    tipo: string;
    layoutIntegracao?: string;
    tipoIntegracao?: string;
    codigoRegistro?: string | null;
  }>;
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
      maxErros2h: number;
      tiposMonitorados?: string[];
    };
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
  const [tipoErrorSearch, setTipoErrorSearch] = useState("");
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    type: "success" | "error" | "warning";
  } | null>(null);

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
        setTenantAnalytics(data.analytics);
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

  // Toggle de um tipo específico no multi-select
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
            ...tenantAnalytics.monitoring.thresholds,
            tiposMonitorados: tenantAnalytics.monitoring.thresholds.tiposMonitorados || [],
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
                    {/* Card 1: Total Usuários */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card-sm">
                      <div className="flex items-center justify-between text-slate-400">
                        <span className="text-xs font-semibold uppercase tracking-wider">
                          Total de Usuários
                        </span>
                        <Users className="h-4 w-4 text-slate-500" />
                      </div>
                      <div className="mt-2 text-2xl font-bold text-slate-900">
                        {tenantAnalytics.totalUsuarios}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {tenantAnalytics.ativos30d} ativos nos últimos 30 dias
                      </p>
                    </div>

                    {/* Card 2: Usuários Ativos (7d) */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card-sm">
                      <div className="flex items-center justify-between text-slate-400">
                        <span className="text-xs font-semibold uppercase tracking-wider">
                          Ativos em 7 dias
                        </span>
                        <Activity className="h-4 w-4 text-[#1D00EB]" />
                      </div>
                      <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-[#1D00EB]">
                          {tenantAnalytics.ativos7d}
                        </span>
                        <span className="rounded-full bg-[#EEF0FF] px-2 py-0.5 text-xs font-bold text-[#1D00EB]">
                          {tenantAnalytics.taxaAdesao7d}% adesão
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Logins na última semana
                      </p>
                    </div>

                    {/* Card 3: Erros 2h / 24h */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card-sm">
                      <div className="flex items-center justify-between text-slate-400">
                        <span className="text-xs font-semibold uppercase tracking-wider">
                          Erros Recentes
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
                      <p className="mt-1 text-[11px] text-slate-500">
                        {tenantAnalytics.erros2h >=
                        tenantAnalytics.monitoring.thresholds.maxErros2h
                          ? "⚠️ Acima do limite tolerado"
                          : "Dentro da margem segura"}
                      </p>
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

                  {/* 3. Grid de Conteúdo: Tabela de Usuários & Configurações de Thresholds */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Coluna 1 & 2: Tabela de Usuários (2/3 da largura) */}
                    <div className="lg:col-span-2 space-y-6">
                      <div className="rounded-2xl border border-slate-200 bg-white shadow-card-sm overflow-hidden">
                        <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                          <div>
                            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                              <Users className="h-4 w-4 text-[#1D00EB]" />
                              Usuários Vinculados ({tenantAnalytics.usuarios.length})
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                              Dados da collection MongoDB `usuarios` com status de atividade
                            </p>
                          </div>
                        </div>

                        {tenantAnalytics.usuarios.length === 0 ? (
                          <div className="py-12 text-center text-slate-400 text-xs">
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
                                    <td className="px-4 py-3.5 text-slate-600">
                                      {u.cargo}
                                    </td>
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

                      {/* Amostra de Erros Operacionais (se houver) */}
                      {tenantAnalytics.amostraErros.length > 0 && (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50/30 p-5 shadow-card-sm">
                          <h4 className="text-xs font-bold text-rose-900 flex items-center gap-2 mb-3">
                            <Flame className="h-4 w-4 text-rose-600" />
                            Falhas de Integração Recentes (errosintegracoes)
                          </h4>
                          <div className="space-y-2">
                            {tenantAnalytics.amostraErros.map((err, idx) => (
                              <div
                                key={idx}
                                className="rounded-xl border border-rose-200 bg-white p-3 text-xs"
                              >
                                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                                  {err.layoutIntegracao && (
                                    <span className="rounded-md bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-bold text-[#1D00EB]">
                                      Canal: {err.layoutIntegracao}
                                    </span>
                                  )}
                                  {err.tipoIntegracao && (
                                    <span className="rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                                      Tipo: {err.tipoIntegracao}
                                    </span>
                                  )}
                                  {err.codigoRegistro && (
                                    <span className="font-mono text-[10px] text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">
                                      Item: #{err.codigoRegistro}
                                    </span>
                                  )}
                                </div>
                                <div className="font-mono text-slate-800 break-words">
                                  {err.mensagem}
                                </div>
                                <div className="mt-1 text-[10px] text-slate-400">
                                  Ocorrido em: {new Date(err.data).toLocaleString("pt-BR")}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
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

                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              Máximo de Erros em 2h (Alerta Crítico)
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={tenantAnalytics.monitoring.thresholds.maxErros2h}
                                onChange={(e) =>
                                  handleUpdateAnalyticsThreshold("maxErros2h", e.target.value)
                                }
                                className="w-24 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-semibold text-rose-600 focus:border-[#1D00EB] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1D00EB]"
                              />
                              <span className="text-xs text-slate-500">erros tolerados</span>
                            </div>
                          </div>

                          {/* Seletor Multi-Select de Tipos de Erro a Monitorar */}
                          <div className="border-t border-slate-100 pt-3">
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                                <Tag className="h-3.5 w-3.5 text-[#1D00EB]" />
                                <span>Tipos de Erro Monitorados</span>
                              </label>
                              <div className="flex items-center gap-2 text-[10px]">
                                <button
                                  type="button"
                                  onClick={handleSelectAllTipos}
                                  className="text-[#1D00EB] hover:underline font-semibold"
                                >
                                  Todos
                                </button>
                                <span className="text-slate-300">|</span>
                                <button
                                  type="button"
                                  onClick={handleClearAllTipos}
                                  className="text-slate-500 hover:text-rose-600 font-semibold"
                                >
                                  Limpar
                                </button>
                              </div>
                            </div>
                            <p className="text-[11px] text-slate-400 mb-2">
                              Filtra ocorrências na collection <code className="font-mono text-slate-600">errosintegracoes</code>. Se nenhum for marcado, monitora <strong className="text-slate-600">Todos</strong> por padrão.
                            </p>

                            {/* Badges / Chips dos Tipos Selecionados */}
                            <div className="mb-2 min-h-[38px] rounded-xl border border-slate-200 bg-slate-50/70 p-2">
                              {(!tenantAnalytics.monitoring.thresholds.tiposMonitorados ||
                                tenantAnalytics.monitoring.thresholds.tiposMonitorados.length === 0) ? (
                                <div className="flex items-center gap-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                                  <span>Todos os tipos monitorados (Padrão)</span>
                                </div>
                              ) : (
                                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                                  {tenantAnalytics.monitoring.thresholds.tiposMonitorados.map((tipo) => (
                                    <span
                                      key={tipo}
                                      className="inline-flex items-center gap-1 rounded-lg bg-[#1D00EB]/10 border border-[#1D00EB]/20 px-2 py-0.5 text-[11px] font-semibold text-[#1D00EB]"
                                    >
                                      <span>{tipo}</span>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleTipoMonitorado(tipo)}
                                        className="text-[#1D00EB]/70 hover:text-rose-600 transition"
                                        title={`Remover ${tipo}`}
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Campo de Busca Rápida */}
                            <div className="relative mb-2">
                              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                              <input
                                type="text"
                                placeholder="Buscar tipo (ex: Anúncio, Pedido)..."
                                value={tipoErrorSearch}
                                onChange={(e) => setTipoErrorSearch(e.target.value)}
                                className="w-full rounded-xl border border-slate-200 bg-white pl-8 pr-7 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#1D00EB] focus:outline-none focus:ring-1 focus:ring-[#1D00EB]"
                              />
                              {tipoErrorSearch && (
                                <button
                                  type="button"
                                  onClick={() => setTipoErrorSearch("")}
                                  className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>

                            {/* Seletor Visual com Chips Clicáveis */}
                            <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                              <div className="flex flex-wrap gap-1">
                                {filteredTipos.map((tipo) => {
                                  const isSelected = Boolean(
                                    tenantAnalytics.monitoring.thresholds.tiposMonitorados?.includes(tipo)
                                  );
                                  return (
                                    <button
                                      key={tipo}
                                      type="button"
                                      onClick={() => handleToggleTipoMonitorado(tipo)}
                                      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                                        isSelected
                                          ? "bg-[#1D00EB] text-white shadow-sm font-semibold"
                                          : "bg-slate-50 border border-slate-200 text-slate-700 hover:border-[#1D00EB]/40 hover:bg-[#1D00EB]/5 hover:text-[#1D00EB]"
                                      }`}
                                    >
                                      {isSelected && <Check className="h-3 w-3 flex-shrink-0" />}
                                      <span>{tipo}</span>
                                    </button>
                                  );
                                })}
                              </div>
                              {filteredTipos.length === 0 && (
                                <p className="text-center py-2 text-[11px] text-slate-400">
                                  Nenhum tipo encontrado para "{tipoErrorSearch}".
                                </p>
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
                            <span>Salvar Regras no Firestore</span>
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
