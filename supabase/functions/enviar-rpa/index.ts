// Supabase Edge Function — enviar-rpa
// Envia o PDF da RPA por e-mail usando a API do Brevo (ex-Sendinblue).
//
// Variáveis de ambiente necessárias (configurar no painel do Supabase):
//   BREVO_API_KEY  — chave de API do Brevo (https://brevo.com)
//
// Para deploy: supabase functions deploy enviar-rpa

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { to, cooperadoNome, periodoLabel, pdfBase64, pdfName } = await req.json() as {
      to: string;
      cooperadoNome: string;
      periodoLabel: string;
      pdfBase64: string;
      pdfName: string;
    };

    if (!to || !pdfBase64 || !pdfName) {
      return jsonResponse({ error: 'Campos obrigatórios ausentes: to, pdfBase64, pdfName' }, 400);
    }

    const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
    if (!BREVO_API_KEY) {
      return jsonResponse({ error: 'BREVO_API_KEY não configurada nas variáveis de ambiente.' }, 500);
    }

    const emailHtml = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f6fb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(180deg,#e8f2fc 0%,#d4e5f7 100%);padding:20px 32px;border-bottom:3px solid #1a2f5a;">
            <img
              src="https://plant-o-f-cil-main-main.vercel.app/cades-logo.png"
              alt="CADES"
              width="180"
              style="display:block;height:auto;max-height:60px;object-fit:contain;"
            />
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="font-size:16px;color:#1e293b;margin:0 0 16px;">Olá, <strong>${cooperadoNome}</strong>,</p>
            <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 12px;">
              Encaminhamos em anexo o seu <strong>Recibo de Pagamento Autônomo (RPA)</strong>
              referente à competência <strong>${periodoLabel}</strong>.
            </p>
            <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 24px;">
              Caso identifique qualquer divergência, entre em contato com a administração da CADES.
            </p>
            <div style="background:#f1f5f9;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
              <p style="font-size:12px;color:#64748b;margin:0 0 4px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;">Competência</p>
              <p style="font-size:16px;color:#1a2f5a;font-weight:bold;margin:0;">${periodoLabel}</p>
            </div>
            <p style="font-size:14px;color:#475569;margin:0 0 4px;">Atenciosamente,</p>
            <p style="font-size:14px;color:#1e293b;font-weight:bold;margin:0;">Administrativo CADES</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
            <p style="font-size:11px;color:#94a3b8;margin:0;text-align:center;">
              Este e-mail foi gerado automaticamente pelo sistema CADES Financeiro.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: {
          name: 'CADES',
          email: 'secretaria.cades.vix@gmail.com',
        },
        to: [{ email: to, name: cooperadoNome }],
        subject: `RPA - ${periodoLabel} - CADES`,
        htmlContent: emailHtml,
        attachment: [{ content: pdfBase64, name: pdfName }],
      }),
    });

    const brevoData = await brevoResponse.json();

    if (!brevoResponse.ok) {
      const msg = (brevoData as { message?: string }).message ?? 'Erro ao enviar e-mail pelo Brevo.';
      return jsonResponse({ error: msg }, brevoResponse.status);
    }

    return jsonResponse({ success: true, messageId: (brevoData as { messageId?: string }).messageId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno no servidor.';
    return jsonResponse({ error: message }, 500);
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
