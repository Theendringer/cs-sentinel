import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";

/**
 * Transporter do Nodemailer configurado exclusivamente para o Gmail
 */
export const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER?.trim(),
    pass: process.env.GMAIL_APP_PASSWORD?.trim().replace(/\s+/g, ""),
  },
});

export interface SendCSAlertEmailParams {
  to: string;
  subject: string;
  htmlContent: string;
  from?: string;
}

/**
 * Função utilitária que dispara e-mails via Nodemailer utilizando o Gmail
 */
export async function sendCSAlertEmail({
  to,
  subject,
  htmlContent,
  from,
}: SendCSAlertEmailParams): Promise<{ success: boolean; messageId: string }> {
  const gmailUser = process.env.GMAIL_USER?.trim();
  const gmailPass = process.env.GMAIL_APP_PASSWORD?.trim();

  if (!gmailUser || !gmailPass) {
    throw new Error(
      "GMAIL_USER ou GMAIL_APP_PASSWORD não configurados no arquivo .env."
    );
  }

  const sender = from || `"Kenit CS Sentinel" <${gmailUser}>`;

  const info = await mailer.sendMail({
    from: sender,
    to,
    subject,
    html: htmlContent,
  });

  return {
    success: true,
    messageId: info.messageId,
  };
}

export interface PrescriptiveAlertEmailOptions {
  to: string;
  csName?: string;
  entidadeNome: string;
  canalImpactado?: string;
  tipoRisco: string;
  erros2h?: number;
  diasSemAcesso?: number;
  motivo: string;
  acaoRecomendada: string;
  executiveReport?: string;
  timestamp?: string;
  isTest?: boolean;
}

export interface MailerResult {
  success: boolean;
  messageId?: string;
  provider: "gmail" | "simulated";
  error?: string;
  simulated?: boolean;
  html?: string;
}

/**
 * Obtém o logo da Kenit em formato base64 para incorporação direta no e-mail
 */
function getKenitLogoBase64(): string {
  try {
    const logoPath = path.join(process.cwd(), "public", "logo-kenit-full.png");
    if (fs.existsSync(logoPath)) {
      const buffer = fs.readFileSync(logoPath);
      return `data:image/png;base64,${buffer.toString("base64")}`;
    }
  } catch (err: any) {
    console.warn("⚠️ Não foi possível carregar imagem do logo local:", err.message);
  }
  return "";
}

/**
 * Detecta o canal impactado a partir do texto do motivo/diagnóstico se não fornecido explicitamente
 */
function resolveCanalImpactado(canal?: string, motivoText?: string): string {
  if (canal && canal.trim()) return canal.trim();
  const text = (motivoText || "").toLowerCase();
  if (text.includes("vtex")) return "VTEX Enterprise";
  if (text.includes("mercado livre") || text.includes("mercadolivre")) return "Mercado Livre";
  if (text.includes("shopee")) return "Shopee Marketplace";
  if (text.includes("magalu") || text.includes("magazine luiza")) return "Magazine Luiza";
  if (text.includes("amazon")) return "Amazon Marketplace";
  if (text.includes("shopify")) return "Shopify Plus";
  return "Integrações E-commerce (Hub Kenit)";
}

/**
 * Gera o template HTML moderno, elegante e responsivo no padrão Kenit Enterprise (Azul #1D00EB)
 */
export function generateKenitAlertEmailHtml(options: PrescriptiveAlertEmailOptions): string {
  const {
    to,
    csName = "Analista de CS",
    entidadeNome,
    tipoRisco,
    motivo,
    acaoRecomendada,
    executiveReport,
    erros2h,
    diasSemAcesso,
    timestamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    isTest = false,
  } = options;

  const canal = resolveCanalImpactado(options.canalImpactado, motivo);

  const isCritico =
    tipoRisco.includes("CRITICO") ||
    tipoRisco.includes("TECNICO") ||
    tipoRisco.includes("OPERACIONAL");

  const badgeColor = isCritico ? "#b91c1c" : "#b45309";
  const badgeBg = isCritico ? "#fef2f2" : "#fffbeb";
  const badgeBorder = isCritico ? "#fca5a5" : "#fcd34d";
  const badgeIcon = isCritico ? "🚨" : "⚠️";

  const logoBase64 = getKenitLogoBase64();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[Alerta CS Sentinela] ${tipoRisco} - ${entidadeNome}</title>
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
      .email-wrapper { width: 100% !important; padding: 12px !important; }
      .metrics-grid td { display: block !important; width: 100% !important; box-sizing: border-box; margin-bottom: 8px !important; }
    }
  </style>
</head>
<body style="background-color: #f1f5f9; margin: 0; padding: 24px 12px;">

  <center>
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 620px;" class="email-wrapper">
      
      <!-- Linha de Destaque Superior Azul Royal #1D00EB -->
      <tr>
        <td height="4" style="background-color: #1d00eb; border-radius: 16px 16px 0 0;"></td>
      </tr>

      <!-- Container Principal -->
      <tr>
        <td style="background-color: #ffffff; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05); overflow: hidden;">
          
          <!-- Cabeçalho (Fundo Branco/Gelo com Logo Kenit e Título em Azul Royal #1D00EB) -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 24px 28px;">
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="left" style="vertical-align: middle;">
                      ${
                        logoBase64
                          ? `<img src="${logoBase64}" alt="Kenit" height="32" style="height: 32px; max-width: 130px; display: block; border: 0;" />`
                          : `<span style="font-size: 22px; font-weight: 800; color: #1d00eb; letter-spacing: -0.03em;">KENIT</span>`
                      }
                      <p style="margin: 4px 0 0 0; font-size: 11px; font-weight: 600; color: #64748b; letter-spacing: 0.05em; text-transform: uppercase;">
                        Customer Success Sentinel • Observability
                      </p>
                    </td>
                    <td align="right" style="vertical-align: middle;">
                      ${
                        isTest
                          ? `<span style="display: inline-block; background-color: #eef2ff; color: #1d00eb; border: 1px solid #c7d2fe; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 700; text-transform: uppercase;">Modo Demonstração</span>`
                          : `<span style="display: inline-block; background-color: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 700; text-transform: uppercase;">Auditoria Ativa</span>`
                      }
                    </td>
                  </tr>
                </table>

                <div style="margin-top: 18px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
                  <h1 style="margin: 0; color: #1d00eb; font-size: 19px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.3;">
                    Alerta Preventivo de Observabilidade & Retenção
                  </h1>
                  <p style="margin: 4px 0 0 0; color: #475569; font-size: 13px;">
                    Diagnóstico automatizado pelo Agente Autônomo com inteligência preditiva.
                  </p>
                </div>
              </td>
            </tr>
          </table>

          <!-- Corpo Principal do E-mail -->
          <div style="padding: 28px;">

            <!-- Badge de Risco em Destaque Visual -->
            <div style="margin-bottom: 22px;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="background-color: ${badgeBg}; border: 1px solid ${badgeBorder}; border-radius: 10px; padding: 10px 14px;">
                <tr>
                  <td style="font-size: 16px; vertical-align: middle; padding-right: 8px;">
                    ${badgeIcon}
                  </td>
                  <td style="font-size: 12px; font-weight: 800; color: ${badgeColor}; text-transform: uppercase; letter-spacing: 0.04em;">
                    [ALERTA PREVENTIVO DE CS] ${tipoRisco}
                  </td>
                </tr>
              </table>
            </div>

            <!-- Saudação ao Analista de CS -->
            <p style="margin: 0 0 14px 0; font-size: 14px; color: #1e293b; line-height: 1.5;">
              Olá, <strong>${csName}</strong>,
            </p>
            <p style="margin: 0 0 22px 0; font-size: 13px; color: #475569; line-height: 1.6;">
              O Sentinel CS identificou um padrão de anomalia na operação de <strong>${entidadeNome}</strong>. 
              Este alerta foi gerado com antecedência para permitir uma abordagem prescritiva proativa <em>antes</em> que o cliente abra um chamado no suporte ou considere cancelamento.
            </p>

            <!-- 1. DADOS DO CLIENTE E MÉTRICAS CONSOLIDADAS -->
            <div style="margin-bottom: 24px;">
              <p style="margin: 0 0 8px 0; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b;">
                📋 Dados da Conta & Métricas Consolidadas
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="metrics-grid" style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
                <tr>
                  <td width="50%" style="padding: 14px 16px; border-bottom: 1px solid #f1f5f9; border-right: 1px solid #f1f5f9;">
                    <span style="display: block; font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Empresa / Entidade</span>
                    <strong style="font-size: 14px; color: #0f172a;">${entidadeNome}</strong>
                  </td>
                  <td width="50%" style="padding: 14px 16px; border-bottom: 1px solid #f1f5f9;">
                    <span style="display: block; font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Canal Impactado</span>
                    <strong style="font-size: 14px; color: #1d00eb;">${canal}</strong>
                  </td>
                </tr>
                <tr>
                  <td width="50%" style="padding: 14px 16px; border-right: 1px solid #f1f5f9;">
                    <span style="display: block; font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Falhas Recentes (2h)</span>
                    <span style="font-size: 13px; font-weight: 700; color: ${isCritico ? "#dc2626" : "#475569"};">
                      ${erros2h !== undefined ? `${erros2h} erros detectados` : "Oscilação acima do threshold"}
                    </span>
                  </td>
                  <td width="50%" style="padding: 14px 16px;">
                    <span style="display: block; font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Janela de Inatividade</span>
                    <span style="font-size: 13px; font-weight: 700; color: #475569;">
                      ${diasSemAcesso !== undefined ? `${diasSemAcesso} dias sem acesso` : "Monitoramento contínuo"}
                    </span>
                  </td>
                </tr>
              </table>
            </div>

            <!-- 2. DIAGNÓSTICO DA IA (INTERPRETAÇÃO EM LINGUAGEM DE NEGÓCIOS) -->
            <div style="margin-bottom: 24px;">
              <p style="margin: 0 0 8px 0; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b;">
                🤖 Diagnóstico da IA (Impacto Comercial)
              </p>
              
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; font-size: 13px; line-height: 1.6; color: #334155;">
                ${motivo.replace(/\n/g, "<br>")}
              </div>
            </div>

            <!-- 3. PLANO DE AÇÃO PRESCRITIVO (ROTEIRO SUGERIDO PONTO A PONTO) -->
            <div style="margin-bottom: 24px;">
              <p style="margin: 0 0 8px 0; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #1d00eb;">
                🎯 Plano de Ação Prescritivo & Roteiro de Contato
              </p>

              <div style="background-color: #eef0ff; border: 1px solid #c7d2fe; border-left: 5px solid #1d00eb; border-radius: 12px; padding: 18px; font-size: 13px; line-height: 1.6; color: #1e1b4b;">
                <div style="font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: #1d00eb; margin-bottom: 10px;">
                  Roteiro pronto para uso pelo analista de CS:
                </div>
                <div>
                  ${acaoRecomendada.replace(/\n/g, "<br>")}
                </div>
              </div>
            </div>

            ${
              executiveReport
                ? `
            <!-- Contexto Adicional do Agente -->
            <div style="margin-bottom: 24px;">
              <p style="margin: 0 0 8px 0; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b;">
                📊 Parecer Sintético do Agente
              </p>
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; font-size: 12px; color: #64748b; line-height: 1.5;">
                ${executiveReport.replace(/\n/g, "<br>")}
              </div>
            </div>
            `
                : ""
            }

            <!-- Botão de Ação Direta para o Cockpit -->
            <div style="text-align: center; margin: 32px 0 16px 0;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center">
                <tr>
                  <td align="center" style="border-radius: 12px; background-color: #1d00eb;">
                    <a href="${appUrl}/dashboard" target="_blank" style="display: inline-block; padding: 14px 28px; font-size: 13px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 12px; letter-spacing: -0.01em;">
                      Acessar Cockpit do Sentinela Kenit →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 8px 0 0 0; font-size: 11px; color: #94a3b8;">
                Visualização de telemetria, logs e histórico de auditorias.
              </p>
            </div>

          </div>

          <!-- Rodapé Oficial com Assinatura Kenit -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 22px 28px; text-align: center;">
            <tr>
              <td>
                <p style="margin: 0; font-size: 12px; font-weight: 700; color: #334155;">
                  Sentinel CS Kenit • Plataforma de Observabilidade e Retenção
                </p>
                <p style="margin: 4px 0 0 0; font-size: 11px; color: #64748b; line-height: 1.4;">
                  E-mail gerado automaticamente pelo Agente Autônomo com IA Google Gemini.<br>
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
 * Gera o corpo em texto plano (fallback para leitores sem suporte a HTML)
 */
export function generateKenitAlertEmailText(options: PrescriptiveAlertEmailOptions): string {
  const {
    to,
    csName = "Analista de CS",
    entidadeNome,
    tipoRisco,
    motivo,
    acaoRecomendada,
    executiveReport,
    erros2h,
    diasSemAcesso,
    timestamp = new Date().toLocaleString("pt-BR"),
  } = options;

  const canal = resolveCanalImpactado(options.canalImpactado, motivo);

  return `
======================================================================
🛡️ KENIT CS SENTINEL • ALERTA PREVENTIVO DE OBSERVABILIDADE
======================================================================
[ALERTA PREVENTIVO DE CS] ${tipoRisco}
Conta: ${entidadeNome}
Canal: ${canal}
CS Responsável: ${csName} (${to})
Data/Hora: ${timestamp}
${erros2h !== undefined ? `Erros nas últimas 2h: ${erros2h}` : ""}
${diasSemAcesso !== undefined ? `Dias sem acesso: ${diasSemAcesso}` : ""}

----------------------------------------------------------------------
🤖 DIAGNÓSTICO DA IA (IMPACTO COMERCIAL):
----------------------------------------------------------------------
${motivo}

----------------------------------------------------------------------
🎯 PLANO DE AÇÃO PRESCRITIVO & ROTEIRO DE CONTATO:
----------------------------------------------------------------------
${acaoRecomendada}

${executiveReport ? `\n----------------------------------------------------------------------\n📊 CONTEXTO GERAL:\n${executiveReport}\n` : ""}
Painel de Acesso: ${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/dashboard
Assinatura: Sentinel CS Kenit • IA Google Gemini
======================================================================
  `.trim();
}

/**
 * Envia e-mail prescritivo ao analista de CS responsável pela conta usando Nodemailer e Gmail.
 */
export async function sendPrescriptiveAlertEmail(
  options: PrescriptiveAlertEmailOptions
): Promise<MailerResult> {
  const {
    to,
    csName = "Analista de CS",
    entidadeNome,
    tipoRisco,
    motivo,
    timestamp = new Date().toLocaleString("pt-BR"),
    isTest = false,
  } = options;

  const htmlContent = generateKenitAlertEmailHtml(options);
  const subjectPrefix = isTest ? "🧪 [TESTE KENIT CS]" : "🚨 [Alerta CS Sentinela]";
  const subject = `${subjectPrefix} ${tipoRisco}: ${entidadeNome}`;

  const gmailUser = process.env.GMAIL_USER?.trim();
  const gmailPass = process.env.GMAIL_APP_PASSWORD?.trim();

  // Se as credenciais do Gmail estiverem presentes, dispara pelo Nodemailer Gmail
  if (gmailUser && gmailPass) {
    try {
      const result = await sendCSAlertEmail({
        to,
        subject,
        htmlContent,
      });

      console.log(`✉️ [Gmail Nodemailer] E-mail enviado com sucesso para ${to} (MessageId: ${result.messageId})`);
      return {
        success: true,
        messageId: result.messageId,
        provider: "gmail",
        html: htmlContent,
      };
    } catch (err: any) {
      console.error(`❌ [Gmail Error] Falha no envio para ${to}:`, err.message);
      throw err;
    }
  }

  // Fallback Simulado se não houver credenciais configuradas
  console.log(`\n======================================================================`);
  console.log(`📬 [DISPARO DE E-MAIL KENIT CS SENTINEL - SIMULAÇÃO DETALHADA]`);
  console.log(`======================================================================`);
  console.log(`Para:       ${to} (${csName})`);
  console.log(`Assunto:    ${subject}`);
  console.log(`Empresa:    ${entidadeNome}`);
  console.log(`Risco:      ${tipoRisco}`);
  console.log(`Data/Hora:  ${timestamp}`);
  console.log(`----------------------------------------------------------------------`);
  console.log(`Diagnóstico IA:`);
  console.log(`   ${motivo}`);
  console.log(`----------------------------------------------------------------------`);
  console.log(`Plano Prescritivo:`);
  console.log(`   ${options.acaoRecomendada.slice(0, 300)}...`);
  console.log(`======================================================================`);
  console.log(`ℹ️ [Aviso] GMAIL_USER ou GMAIL_APP_PASSWORD não configurados no .env.`);
  console.log(`   Simulação registrada no console.\n`);

  return {
    success: true,
    provider: "simulated",
    simulated: true,
    messageId: `simulated-${Date.now()}`,
    html: htmlContent,
  };
}
