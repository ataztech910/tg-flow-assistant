// AI-assisted flow.yaml editing via @kitana-sdk/core — routes through the local `claude` CLI's
// subscription auth by default (no API key needed), falling back to codex/ollama/a real API key
// if configured. The model can't touch files itself (Kitana disables all its tools) — it only
// ever returns text, which we validate against our own schema before it's allowed to save.
import { createRouter } from "npm:@kitana-sdk/core";
import * as jsYaml from "npm:js-yaml@5.4.2";
import { FlowDefinitionSchema } from "./schema.ts";
import { checkFlow } from "./flow-check.ts";

const dslRules = await Deno.readTextFile("./dsl-rules.md");

const router = createRouter({
  chain: ["claude", "codex", "ollama", "api-key"],
  models: { claude: "sonnet" },
  apiKeys: {
    anthropic: Deno.env.get("ANTHROPIC_API_KEY") || undefined,
    openai: Deno.env.get("OPENAI_API_KEY") || undefined,
  },
});

const SYSTEM_PROMPT = `${dslRules}

You are editing an existing flow.yaml for a Telegram bot builder. Follow the DSL rules above
exactly — do not invent node types or fields that aren't in the rules.
Respond with ONLY the complete, updated flow.yaml file content. No explanation, no markdown code
fences, no commentary — just the raw YAML, starting with "start_node:".`;

/** The model sometimes wraps its answer in a ```yaml fence despite being told not to — strip it
 *  defensively rather than trusting the instruction was followed. */
function stripCodeFences(text: string): string {
  const m = text.match(/```(?:ya?ml)?\r?\n([\s\S]*?)```/);
  return (m ? m[1] : text).trim();
}

/** Returns a list of problems (empty = valid) — same checks as validate.ts/bot-manager.ts. */
function validate(yamlText: string): string[] {
  let parsed: unknown;
  try {
    parsed = jsYaml.load(yamlText);
  } catch (e) {
    return [`Invalid YAML: ${(e as Error).message}`];
  }
  const result = FlowDefinitionSchema.safeParse(parsed);
  if (!result.success) {
    return result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  }
  return checkFlow(result.data).errors;
}

async function complete(messages: { role: string; content: string }[]): Promise<string> {
  const res = await router.complete({ messages, systemPrompt: SYSTEM_PROMPT });
  return stripCodeFences(res.content);
}

/** Sends userMessage, validates the response, and retries once (error fed back) if it doesn't
 *  pass schema/reference checks. Throws (doesn't save anything itself — that's the caller's job
 *  via BotManager.saveFlow/createBot) if it still fails after the retry. */
async function completeAndValidate(userMessage: string): Promise<string> {
  let candidate = await complete([{ role: "user", content: userMessage }]);
  let errors = validate(candidate);

  if (errors.length) {
    const retryMessage = `Your previous answer had validation errors:\n${
      errors.join("\n")
    }\n\nHere is what you returned:\n\`\`\`yaml\n${candidate}\n\`\`\`\n\nFix ONLY these errors and return the complete corrected flow.yaml — same rules as before (no explanation, no fences).`;
    candidate = await complete([
      { role: "user", content: userMessage },
      { role: "assistant", content: candidate },
      { role: "user", content: retryMessage },
    ]);
    errors = validate(candidate);
    if (errors.length) {
      throw new Error(`AI generation failed validation twice:\n${errors.join("\n")}`);
    }
  }

  return candidate;
}

/** Edits currentYaml per instruction — see completeAndValidate for the retry/validation contract. */
export function aiEditFlow(
  currentYaml: string,
  instruction: string,
  focusNodeId?: string,
): Promise<string> {
  const focusLine = focusNodeId
    ? `\nThe user currently has node "${focusNodeId}" selected — prefer editing that node unless the instruction clearly means something else.`
    : "";
  const userMessage =
    `Current flow.yaml:\n\`\`\`yaml\n${currentYaml}\n\`\`\`\n${focusLine}\nInstruction: ${instruction}`;
  return completeAndValidate(userMessage);
}

/** Builds a brand-new flow.yaml from a plain-language description — the "Create a bot" form uses
 *  this instead of asking the user to hand-write or paste YAML at all. */
export function aiGenerateFlow(description: string): Promise<string> {
  const userMessage =
    `Build a complete new flow.yaml from scratch for this bot:\n\n${description}\n\nFollow the DSL rules exactly. Pick a sensible start_node.`;
  return completeAndValidate(userMessage);
}
