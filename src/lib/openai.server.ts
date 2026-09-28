/**
 * Minimal OpenAI chat wrapper used by the PulseAssist server functions.
 * Server-only — import lazily from inside a handler.
 */

const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const FALLBACK_MODEL = "gpt-4o-mini";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/**
 * Throws "AI_NOT_CONFIGURED" when no key is set and "AI_REQUEST_FAILED" when
 * OpenAI rejects the call. Both are matched by name in the Pulse UI.
 */
export async function chatCompletion(options: {
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI_NOT_CONFIGURED");

  const response = await fetch(CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? FALLBACK_MODEL,
      messages: options.messages,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
    }),
  });

  if (!response.ok) {
    console.error(`[openai] ${response.status}: ${await response.text()}`);
    throw new Error("AI_REQUEST_FAILED");
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}
