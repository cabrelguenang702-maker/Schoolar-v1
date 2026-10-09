// Remplace Utils\AnthropicClient / Utils\OpenAiClient. Erreurs volontairement
// préfixées "ai_" pour rester compatibles avec translateAiError() du PHP
// d'origine (repris tel quel côté frontend/i18n).

export class AiError extends Error {}

export async function anthropicCompleteJson(systemPrompt: string, userPrompt: string): Promise<any> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const model = Deno.env.get("ANTHROPIC_MODEL");
  if (!apiKey || !model) throw new AiError("ai_not_configured");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: systemPrompt + "\n\nRéponds UNIQUEMENT avec l'objet JSON demandé, sans texte avant/après, sans balises markdown.",
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) throw new AiError(`ai_provider_error:${res.status}`);
  const data = await res.json();
  const text = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  return parseJsonLoose(text);
}

export async function openAiCompleteJson(
  messages: { role: string; content: string }[],
  imageBase64?: string | null,
  imageMime?: string | null,
): Promise<any> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  const model = Deno.env.get("OPENAI_MODEL");
  if (!apiKey || !model) throw new AiError("ai_not_configured");

  const finalMessages = [...messages];
  if (imageBase64 && imageMime) {
    const lastUserIndex = finalMessages.map((m) => m.role).lastIndexOf("user");
    const textContent = finalMessages[lastUserIndex]?.content ?? "";
    (finalMessages[lastUserIndex] as any).content = [
      { type: "text", text: textContent },
      { type: "image_url", image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
    ];
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: finalMessages,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new AiError(`ai_provider_error:${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  return parseJsonLoose(text);
}

function parseJsonLoose(text: string): any {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new AiError("ai_invalid_json");
  }
}
