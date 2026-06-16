import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var ${key} (set it in .env.local)`);
  return v;
}

/** Chat model from the configured OpenAI-compatible endpoint. */
export function model(): LanguageModel {
  const provider = createOpenAICompatible({
    name: "autofill",
    baseURL: required("OPENAI_BASE_URL"),
    apiKey: process.env.OPENAI_API_KEY, // optional — some local endpoints need none
    // Use real json_schema guided decoding (vLLM/OpenAI support it) instead of
    // the weaker prompt-based JSON fallback — far more reliable schema adherence.
    supportsStructuredOutputs: true,
  });
  return provider(required("AUTOFILL_MODEL"));
}
