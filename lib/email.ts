import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";

/**
 * Interface para os resumos de falhas de integração violadas
 */
export interface IncidentErrorSummary {
  canal: string;
  tipo: string;
  totalErros: number;
  amostraMensagens?: string[];
  codigosAfetados?: string[];
  statusSnooze?: "ativo" | "silenciado" | "expirado";
}

/**
 * Dados de um alerta de incidente por cliente/entidade
 */
export interface ClientAlertItem {
  entidadeId?: string;
  entidadeNome: string;
  nivelCriticidade: "Alerta Crítico" | "Atenção" | "Moderado";
  tipoRisco: string;
  canalImpactado?: string;
  erros2h?: number;
  diasSemAcesso?: number;
  falhasVioladas: IncidentErrorSummary[];
  diagnosticoIA: string;
  roteiroAbordagem: string;
  cockpitUrl?: string;
}

/**
 * Parâmetros para envio do e-mail consolidado de monitoramento para o CS
 */
export interface SendMonitoringAlertEmailParams {
  to: string;
  csName?: string;
  incidentes: ClientAlertItem[];
  isManualTest?: boolean;
  contasAuditadasCount?: number;
  timestamp?: string;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  provider: "gmail" | "simulated";
  simulated?: boolean;
  error?: string;
  html?: string;
}

/**
 * Retorna as credenciais configuradas para o Gmail SMTP
 */
export function getGmailCredentials(): { user?: string; pass?: string; isConfigured: boolean } {
  const user = process.env.GMAIL_USER?.trim();
  const pass = process.env.GMAIL_APP_PASSWORD?.trim().replace(/\s+/g, "");
  return {
    user,
    pass,
    isConfigured: Boolean(user && pass),
  };
}

/**
 * Transporter do Nodemailer para o Gmail
 */
export function createEmailTransporter() {
  const { user, pass, isConfigured } = getGmailCredentials();

  if (!isConfigured) {
    return null;
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user,
      pass,
    },
    connectionTimeout: 5000, // 5s
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });
}

/**
 * Carrega o logo Kenit em base64 se disponível localmente
 */
function getKenitLogoBase64(): string {
  try {
    const logoPath = path.join(process.cwd(), "public", "logo-kenit-full.png");
    if (fs.existsSync(logoPath)) {
      const buffer = fs.readFileSync(logoPath);
      return `data:image/png;base64,${buffer.toString("base64")}`;
    }
  } catch (err: any) {
    // Silencia erro se rodando em ambiente restrito
  }
  return "";
}

/**
 * Gera o template HTML profissional e limpo da Kenit CS Sentinel
 */
export function generateMonitoringEmailHtml(params: SendMonitoringAlertEmailParams): string {
  const {
    to,
    csName = "Analista de CS",
    incidentes,
    isManualTest = false,
    contasAuditadasCount = incidentes.length,
    timestamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  } = params;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const logoBase64 = getKenitLogoBase64();

  const temCritico = incidentes.some((inc) => inc.nivelCriticidade === "Alerta Crítico");
  const badgeHeaderColor = temCritico ? "#b91c1c" : "#1d00eb";
  const badgeHeaderBg = temCritico ? "#fef2f2" : "#eef0ff";
  const badgeHeaderText = temCritico ? "🚨 INCIDENTE CRÍTICO DETECTADO" : "🛡️ MONITORAMENTO ATIVO DE CS";

  // Renderiza cada card de cliente incidente
  const incidentCardsHtml = incidentes
    .map((inc, idx) => {
      const isCritico = inc.nivelCriticidade === "Alerta Crítico";
      const cardBorderColor = isCritico ? "#fca5a5" : "#fed7aa";
      const cardHeaderBg = isCritico ? "#fef2f2" : "#fffbeb";
      const cardBadgeBg = isCritico ? "#dc2626" : "#d97706";
      const cardBadgeText = isCritico ? "Alerta Crítico" : "Atenção";
      const clientUrl = inc.entidadeId
        ? `${appUrl}/dashboard?tenant=${inc.entidadeId}`
        : `${appUrl}/dashboard`;

      // Renderiza a lista de falhas violadas
      const falhasRowsHtml =
        inc.falhasVioladas.length > 0
          ? inc.falhasVioladas
              .map(
                (falha) => `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px 12px; font-size: 13px; font-weight: 700; color: #1e293b;">
                  <span style="display: inline-block; background-color: #f1f5f9; padding: 2px 8px; border-radius: 6px; font-size: 11px; color: #475569; margin-right: 6px;">
                    ${falha.canal}
                  </span>
                  ${falha.tipo}
                </td>
                <td style="padding: 10px 12px; font-size: 13px; font-weight: 700; color: ${
                  falha.totalErros > 10 ? "#dc2626" : "#d97706"
                }; text-align: center;">
                  ${falha.totalErros} erro(s)
                </td>
                <td style="padding: 10px 12px; font-size: 11px; color: #64748b; line-height: 1.4;">
                  ${
                    falha.amostraMensagens && falha.amostraMensagens.length > 0
                      ? falha.amostraMensagens.slice(0, 2).map((m) => `• ${m}`).join("<br>")
                      : "Falhas consecutivas violando limite de tolerância."
                  }
                </td>
              </tr>
            `
              )
              .join("")
          : `
            <tr>
              <td colspan="3" style="padding: 12px; font-size: 12px; color: #64748b; text-align: center;">
                Anomalia de engajamento: Nenhum usuário ativo no período tolerado.
              </td>
            </tr>
          `;

      return `
        <!-- Card de Cliente #${idx + 1}: ${inc.entidadeNome} -->
        <div style="background-color: #ffffff; border: 1px solid ${cardBorderColor}; border-radius: 14px; margin-bottom: 24px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);">
          
          <!-- Topo do Card com Nome e Nível de Criticidade -->
          <div style="background-color: ${cardHeaderBg}; padding: 16px 20px; border-bottom: 1px solid ${cardBorderColor}; display: flex; align-items: center; justify-content: space-between;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="left" style="vertical-align: middle;">
                  <h2 style="margin: 0; font-size: 17px; font-weight: 800; color: #0f172a; letter-spacing: -0.02em;">
                    ${inc.entidadeNome}
                  </h2>
                  <span style="font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;">
                    ${inc.tipoRisco}
                  </span>
                </td>
                <td align="right" style="vertical-align: middle;">
                  <span style="display: inline-block; background-color: ${cardBadgeBg}; color: #ffffff; padding: 5px 12px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em;">
                    ${cardBadgeText}
                  </span>
                </td>
              </tr>
            </table>
          </div>

          <div style="padding: 20px;">

            <!-- Métricas Rápidas -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 18px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;">
              <tr>
                <td width="33%" style="padding: 10px 14px; border-right: 1px solid #e2e8f0; text-align: center;">
                  <span style="display: block; font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Falhas Recentes</span>
                  <strong style="font-size: 15px; color: ${inc.erros2h ? "#dc2626" : "#0f172a"};">
                    ${inc.erros2h !== undefined ? `${inc.erros2h} erros` : "Acima do limite"}
                  </strong>
                </td>
                <td width="33%" style="padding: 10px 14px; border-right: 1px solid #e2e8f0; text-align: center;">
                  <span style="display: block; font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Canal Principal</span>
                  <strong style="font-size: 13px; color: #1d00eb;">
                    ${inc.canalImpactado || "Integrações"}
                  </strong>
                </td>
                <td width="34%" style="padding: 10px 14px; text-align: center;">
                  <span style="display: block; font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Inatividade</span>
                  <strong style="font-size: 13px; color: #475569;">
                    ${inc.diasSemAcesso !== undefined ? `${inc.diasSemAcesso} dias sem login` : "Normal"}
                  </strong>
                </td>
              </tr>
            </table>

            <!-- Resumo das Falhas de Integração Violadas -->
            <div style="margin-bottom: 20px;">
              <p style="margin: 0 0 8px 0; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #475569;">
                ⚠️ Falhas de Integração Violadas (Canal e Tipo)
              </p>
              
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; background-color: #ffffff;">
                <thead>
                  <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; text-align: left;">
                    <th style="padding: 8px 12px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Canal / Tipo</th>
                    <th style="padding: 8px 12px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; text-align: center;">Volume</th>
                    <th style="padding: 8px 12px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Amostra do Erro</th>
                  </tr>
                </thead>
                <tbody>
                  ${falhasRowsHtml}
                </tbody>
              </table>
            </div>

            <!-- Diagnóstico Estratégico da IA -->
            <div style="margin-bottom: 20px;">
              <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #1d00eb;">
                🤖 Diagnóstico Estratégico da IA (Impacto no Negócio)
              </p>
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; font-size: 13px; line-height: 1.6; color: #334155;">
                ${inc.diagnosticoIA.replace(/\n/g, "<br>")}
              </div>
            </div>

            <!-- Sugestão de Abordagem para o Cliente (Roteiro CS) -->
            <div style="margin-bottom: 24px;">
              <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #047857;">
                🎯 Sugestão de Abordagem para o Cliente (Roteiro Preventivo)
              </p>
              <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-left: 4px solid #10b981; border-radius: 10px; padding: 14px 16px; font-size: 13px; line-height: 1.6; color: #064e3b;">
                <div style="font-weight: 700; font-size: 11px; text-transform: uppercase; color: #047857; margin-bottom: 6px;">
                  Script recomendado para uso imediato pelo analista:
                </div>
                ${inc.roteiroAbordagem.replace(/\n/g, "<br>")}
              </div>
            </div>

            <!-- Botão de Acesso Direto: [Abrir Cockpit do Cliente] -->
            <div style="text-align: center; margin-top: 10px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center">
                <tr>
                  <td align="center" style="border-radius: 10px; background-color: #1d00eb;">
                    <a href="${clientUrl}" target="_blank" style="display: inline-block; padding: 12px 24px; font-size: 13px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 10px; letter-spacing: -0.01em;">
                      Abrir Cockpit do Cliente (${inc.entidadeNome}) →
                    </a>
                  </td>
                </tr>
              </table>
            </div>

          </div>

        </div>
      `;
    })
    .join("");

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kenit CS Sentinel - Alerta de Monitoramento Ativo</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      color: #0f172a;
    }
    table { border-collapse: separate; }
    a { color: #1d00eb; text-decoration: none; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; padding: 12px !important; }
    }
  </style>
</head>
<body style="background-color: #f1f5f9; margin: 0; padding: 24px 12px;">

  <center>
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 640px;" class="email-container">
      
      <!-- Linha Superior Azul Royal Kenit #1D00EB -->
      <tr>
        <td height="4" style="background-color: #1d00eb; border-radius: 16px 16px 0 0;"></td>
      </tr>

      <!-- Container Principal -->
      <tr>
        <td style="background-color: #ffffff; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05); overflow: hidden;">
          
          <!-- Cabeçalho Oficial Kenit CS Sentinel -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 24px 28px;">
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="left" style="vertical-align: middle;">
                      ${
                        logoBase64
                          ? `<img src="${logoBase64}" alt="Kenit" height="32" style="height: 32px; max-width: 140px; display: block; border: 0;" />`
                          : `<span style="font-size: 24px; font-weight: 800; color: #1d00eb; letter-spacing: -0.03em;">KENIT</span>`
                      }
                      <p style="margin: 4px 0 0 0; font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.06em; text-transform: uppercase;">
                        CS Sentinel • Observabilidade Preventiva
                      </p>
                    </td>
                    <td align="right" style="vertical-align: middle;">
                      <span style="display: inline-block; background-color: ${badgeHeaderBg}; color: ${badgeHeaderColor}; border: 1px solid ${
                        temCritico ? "#fca5a5" : "#c7d2fe"
                      }; padding: 5px 12px; border-radius: 20px; font-size: 10px; font-weight: 800; text-transform: uppercase;">
                        ${isManualTest ? "🧪 Verificação Sob Demanda" : badgeHeaderText}
                      </span>
                    </td>
                  </tr>
                </table>

                <div style="margin-top: 18px; border-top: 1px solid #e2e8f0; padding-top: 14px;">
                  <h1 style="margin: 0; color: #1d00eb; font-size: 19px; font-weight: 800; letter-spacing: -0.02em;">
                    Relatório de Monitoramento Ativo de CS
                  </h1>
                  <p style="margin: 4px 0 0 0; color: #475569; font-size: 13px;">
                    Ciclo de auditoria autônomo executado para a sua carteira de contas.
                  </p>
                </div>
              </td>
            </tr>
          </table>

          <!-- Corpo do E-mail -->
          <div style="padding: 28px;">
            
            <!-- Mensagem de Contexto ao CS -->
            <p style="margin: 0 0 12px 0; font-size: 14px; color: #0f172a; line-height: 1.5;">
              Olá, <strong>${csName}</strong>,
            </p>
            <p style="margin: 0 0 20px 0; font-size: 13px; color: #475569; line-height: 1.6;">
              O Sentinel CS concluiu a varredura das <strong>${contasAuditadasCount}</strong> entidades ativas sob sua gestão. 
              ${
                incidentes.length > 0
                  ? `Foram identificados incidentes em <strong>${incidentes.length} conta(s)</strong> que ultrapassaram as métricas de tolerância ou apresentaram risco iminente de churn:`
                  : "Todas as contas auditadas encontram-se com operações saudáveis e sem incidentes pendentes."
              }
            </p>

            <!-- Cards de Incidentes por Cliente -->
            ${incidentCardsHtml}

            <!-- Botão Global de Acesso ao Painel Geral -->
            <div style="margin: 32px 0 16px 0; padding: 20px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; text-align: center;">
              <p style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; color: #334155;">
                Central de Observabilidade Kenit
              </p>
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center">
                <tr>
                  <td align="center" style="border-radius: 10px; background-color: #0f172a;">
                    <a href="${appUrl}/dashboard" target="_blank" style="display: inline-block; padding: 12px 28px; font-size: 13px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 10px;">
                      Acessar Cockpit Geral de CS →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 10px 0 0 0; font-size: 11px; color: #94a3b8;">
                Monitore telemetria em tempo real, ajuste limites e registre feedbacks com snooze.
              </p>
            </div>

          </div>

          <!-- Rodapé Oficial com Identidade Kenit -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 28px; text-align: center;">
            <tr>
              <td>
                <p style="margin: 0; font-size: 12px; font-weight: 700; color: #334155;">
                  Kenit CS Sentinel • Inteligência Prescritiva & Retenção
                </p>
                <p style="margin: 4px 0 0 0; font-size: 11px; color: #64748b; line-height: 1.4;">
                  E-mail gerado pelo ciclo de monitoramento agendado.<br>
                  Destinado a: <strong style="color: #0f172a;">${to}</strong> • Emitido em: ${timestamp}
                </p>
                <p style="margin: 10px 0 0 0; font-size: 10px; color: #94a3b8;">
                  © ${new Date().getFullYear()} Kenit Soluções em Tecnologia. Todos os direitos reservados.
                </p>
              </td>
            </tr>
          </table>

        </td>
      </tr>

    </table>
  </center>

</body>
</html>
  `.trim();
}

/**
 * Dispara o e-mail de monitoramento ativo para o analista de CS
 */
export async function sendCSMonitoringEmail(
  params: SendMonitoringAlertEmailParams
): Promise<EmailSendResult> {
  const { to, csName = "Analista de CS", incidentes, isManualTest } = params;

  const { user: gmailUser, pass: gmailPass, isConfigured } = getGmailCredentials();
  const htmlContent = generateMonitoringEmailHtml(params);

  const temCritico = incidentes.some((i) => i.nivelCriticidade === "Alerta Crítico");
  const prefixo = isManualTest
    ? "🧪 [TESTE KENIT CS]"
    : temCritico
    ? "🚨 [CRÍTICO • KENIT CS]"
    : "⚠️ [ATENÇÃO • KENIT CS]";

  const nomesClientes = incidentes.map((i) => i.entidadeNome).slice(0, 2).join(", ");
  const sulfixoClientes = incidentes.length > 2 ? ` (+${incidentes.length - 2})` : "";
  const subject =
    incidentes.length === 0
      ? `${prefixo} Varredura de Contas Concluída: Carteira Saudável`
      : `${prefixo} ${incidentes.length} Conta(s) com Anomalia: ${nomesClientes}${sulfixoClientes}`;

  // Se as variáveis GMAIL_USER e GMAIL_APP_PASSWORD estão configuradas, envia via Nodemailer Gmail
  if (isConfigured && gmailUser && gmailPass) {
    try {
      const transporter = createEmailTransporter();
      if (!transporter) {
        throw new Error("Falha ao inicializar o transporter do Nodemailer.");
      }

      const info = await transporter.sendMail({
        from: `"Kenit CS Sentinel" <${gmailUser}>`,
        to,
        subject,
        html: htmlContent,
      });

      console.log(
        `✉️ [Gmail Nodemailer] E-mail de monitoramento enviado com sucesso para ${to} (MessageId: ${info.messageId})`
      );

      return {
        success: true,
        messageId: info.messageId,
        provider: "gmail",
        html: htmlContent,
      };
    } catch (err: any) {
      console.error(`❌ [Gmail Error] Falha no disparo de e-mail para ${to}:`, err.message);
      throw err;
    }
  }

  // Fallback simulado gracioso quando credenciais não estão no .env
  console.log(`\n======================================================================`);
  console.log(`📬 [DISPARO DE E-MAIL KENIT CS SENTINEL - SIMULAÇÃO LOCAL]`);
  console.log(`======================================================================`);
  console.log(`Para:       ${to} (${csName})`);
  console.log(`Assunto:    ${subject}`);
  console.log(`Contas:     ${incidentes.map((i) => `${i.entidadeNome} [${i.nivelCriticidade}]`).join(", ")}`);
  console.log(`----------------------------------------------------------------------`);
  console.log(`ℹ️ [Aviso] GMAIL_USER ou GMAIL_APP_PASSWORD não configurados. Simulação ok.`);
  console.log(`======================================================================\n`);

  return {
    success: true,
    provider: "simulated",
    simulated: true,
    messageId: `simulated-${Date.now()}`,
    html: htmlContent,
  };
}
