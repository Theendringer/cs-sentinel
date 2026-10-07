import { NextRequest, NextResponse } from "next/server";
import { extractCSUser } from "@/lib/firebase-admin";
import {
  sendCSAlertEmail,
  generateKenitAlertEmailHtml,
} from "@/lib/mailer";

export const dynamic = "force-dynamic";

/**
 * POST /api/test-email
 * Dispara e-mail de teste com a identidade visual da Kenit utilizando Gmail via Nodemailer.
 * Destinatário: e-mail do usuário autenticado no Firebase Auth (auth.currentUser.email)
 * Remetente: process.env.GMAIL_USER
 */
export async function POST(request: NextRequest) {
  try {
    const gmailUser = process.env.GMAIL_USER?.trim();
    const gmailPass = process.env.GMAIL_APP_PASSWORD?.trim();

    // Tratamento de Erro: Variáveis de ambiente obrigatórias
    if (!gmailUser || !gmailPass) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Configuração do Gmail ausente: As variáveis GMAIL_USER e GMAIL_APP_PASSWORD devem estar preenchidas no arquivo .env para permitir o envio real de e-mails via Nodemailer.",
          instructions:
            "Gere uma Senha de App de 16 dígitos na sua Conta Google (Segurança -> Senhas de app) e preencha GMAIL_USER e GMAIL_APP_PASSWORD no .env.",
        },
        { status: 400 }
      );
    }

    let bodyData: any = {};
    try {
      bodyData = await request.json();
    } catch {
      // Body vazio ou não JSON
    }

    // Extrai o analista autenticado a partir do token Firebase ou headers
    const csUser = await extractCSUser(request, bodyData);

    const targetEmail =
      bodyData.to ||
      bodyData.email ||
      csUser?.email ||
      request.nextUrl.searchParams.get("csEmail");

    if (!targetEmail) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Destinatário não identificado: Não foi possível obter o e-mail do usuário autenticado no Firebase Auth.",
        },
        { status: 400 }
      );
    }

    const targetName =
      bodyData.csName ||
      bodyData.name ||
      csUser?.name ||
      request.nextUrl.searchParams.get("csName") ||
      targetEmail.split("@")[0] ||
      "Analista de CS";

    const entidadeNome = bodyData.entidadeNome || "NovaTech Solutions";
    const canalImpactado = bodyData.canalImpactado || "VTEX Enterprise";
    const tipoRisco =
      bodyData.tipoRisco || "RISCO OPERACIONAL DE INTEGRAÇÃO & CHURN";

    const motivo =
      bodyData.motivo ||
      "Detectado pico anômalo de 18 falhas consecutivas de integração na última janela de 2h no canal VTEX no tipo 'Anúncio'. O erro 'Dados cadastrais divergentes no atributo EAN' está bloqueando a sincronização de 34 SKUs críticos. Concomitantemente, o administrador principal da conta não realiza login há 9 dias, elevando o risco de insatisfação e cancelamento antes da abertura de chamados formais.";

    const acaoRecomendada =
      bodyData.acaoRecomendada ||
      "1. Abordagem Imediata: Contatar o gestor da conta via WhatsApp/telefone antes que o lojista perceba o travamento nas vendas.\n" +
      "2. Diagnóstico Transparente: Explicar que a Kenit monitorou preventivamente a trava de sincronização na VTEX e já isolou os 34 SKUs afetados.\n" +
      "3. Roteiro Pronto para Abordagem:\n" +
      `'Olá, time da ${entidadeNome}! Aqui é o ${targetName}, gerente de sucesso da sua conta na Kenit.\n` +
      "Identificamos preventivamente através da nossa observabilidade que alguns anúncios na VTEX apresentaram validação pendente de EAN. Já separamos a lista exata dos itens para garantir que suas vendas continuem ativas. Posso te apoiar agora em 5 minutos para destravá-los juntos?'";

    const emailOptions = {
      to: targetEmail,
      csName: targetName,
      entidadeNome,
      canalImpactado,
      tipoRisco,
      erros2h: 18,
      diasSemAcesso: 9,
      motivo,
      acaoRecomendada,
      isTest: true,
      timestamp: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    };

    // Gera o HTML estilizado no padrão visual Kenit (Azul #1D00EB)
    const htmlContent = generateKenitAlertEmailHtml(emailOptions);
    const subject = `🧪 [TESTE KENIT CS] ${tipoRisco}: ${entidadeNome}`;

    console.log(
      `✉️ [/api/test-email] Disparando e-mail via Gmail (${gmailUser}) para ${targetEmail}...`
    );

    // Disparo através da função utilitária sendCSAlertEmail usando Nodemailer Gmail
    const mailResult = await sendCSAlertEmail({
      to: targetEmail,
      from: `"Kenit CS Sentinel" <${gmailUser}>`,
      subject,
      htmlContent,
    });

    console.log(
      `✅ [/api/test-email] E-mail entregue ao Gmail com MessageId: ${mailResult.messageId}`
    );

    return NextResponse.json({
      success: true,
      message: `E-mail de demonstração enviado para ${targetEmail}!`,
      recipient: targetEmail,
      sender: gmailUser,
      messageId: mailResult.messageId,
      html: htmlContent,
    });
  } catch (error: any) {
    console.error("❌ [/api/test-email] Erro ao enviar e-mail via Gmail:", error.message);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Erro desconhecido ao enviar e-mail pelo Gmail.",
      },
      { status: 500 }
    );
  }
}
