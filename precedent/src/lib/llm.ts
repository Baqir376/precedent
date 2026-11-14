import { chat } from '@forge/llm';

/** A completion function: system + user prompt in, text out (undefined if no model is reachable). */
export type LlmFn = (system: string, user: string, maxTokens?: number) => Promise<string | undefined>;

/**
 * Models in preference order. Forge LLMs bill per token to the app, so we use a Sonnet-tier
 * model: strong enough for nuanced conflict judgement, cheaper than Opus.
 * The newest models reject temperature/top_p, so neither is sent.
 */
const MODELS = ['claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250929'];

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : '')).join('');
  }
  return '';
}

export const forgeLlm: LlmFn = async (system, user, maxTokens = 1500) => {
  for (const model of MODELS) {
    try {
      const res = await chat({
        model,
        max_completion_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      const text = contentToText(res.choices?.[0]?.message?.content);
      if (text) return text;
    } catch (err) {
      const e = err as { message?: string; context?: { responseText?: string } };
      console.warn(`[precedent] LLM ${model} failed: ${e.message ?? err} ${e.context?.responseText ?? ''}`);
    }
  }
  return undefined;
};
