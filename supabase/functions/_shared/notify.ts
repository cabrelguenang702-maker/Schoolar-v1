// Remplace Utils\Mailer.php / Utils\SmsGateway.php.
// Même principe que l'original : si aucune clé fournisseur n'est configurée
// dans les secrets de la fonction, le message est journalisé (visible dans
// les logs Supabase de la fonction) plutôt que de faire échouer le flux.

export async function sendEmail(to: string, subject: string, body: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM") ?? "SCHOOLAR <no-reply@schoolar.cm>";

  if (!apiKey) {
    console.log(`[email:not_configured] to=${to} subject="${subject}"\n${body}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text: body }),
  });

  if (!res.ok) {
    console.error(`[email:send_failed] to=${to} status=${res.status} body=${await res.text()}`);
  }
}

export async function sendSms(to: string, body: string) {
  const apiKey = Deno.env.get("SMS_GATEWAY_API_KEY");

  if (!apiKey) {
    console.log(`[sms:not_configured] to=${to}\n${body}`);
    return;
  }

  // Brancher ici le vrai fournisseur SMS camerounais choisi par
  // l'établissement (ex: Orange SMS API, Twilio...) — un seul endroit à
  // modifier, comme pour SmsGateway.php à l'origine.
  console.log(`[sms:provider_not_wired] to=${to}\n${body}`);
}
