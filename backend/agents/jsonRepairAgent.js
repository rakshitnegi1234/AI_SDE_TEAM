import { callGemini } from "../utils/gemini.js";

const JSON_REPAIR_PROMPT = `You are the JSON Repair Agent.

GOAL:
Fix malformed JSON returned by another agent.

RULES:
- Preserve the original data and meaning.
- Fix only JSON syntax problems: missing commas, trailing commas, bad quotes, unclosed braces, markdown wrappers, or extra text.
- Do not invent new fields.
- Do not remove important fields unless they are impossible to repair.
- Return ONLY valid JSON. No markdown. No explanation.`;

export async function repairJsonAgentNode({
  agentName,
  rawJson,
  parseError,
  originalSystemPrompt = "",
  originalUserPrompt = "",
  model = null,
  maxTokens = null,
}) {
  console.warn(`[jsonRepairAgent] Repairing invalid JSON from ${agentName}: ${parseError}`);

  try {
    const result = await callGemini({
      systemPrompt: JSON_REPAIR_PROMPT,
      userPrompt: buildRepairPrompt({
        agentName,
        rawJson,
        parseError,
        originalSystemPrompt,
        originalUserPrompt,
      }),
      agentName: "jsonRepairAgent",
      model,
      maxTokens,
      skipJsonRepair: true,
    });

    return {
      ok: true,
      parsed: result.parsed,
      raw: result.raw,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      parsed: null,
      raw: "",
    };
  }
}

function buildRepairPrompt({
  agentName,
  rawJson,
  parseError,
  originalSystemPrompt,
  originalUserPrompt,
}) {
  return [
    `BROKEN AGENT: ${agentName}`,
    `PARSE ERROR: ${parseError}`,
    `ORIGINAL SYSTEM PROMPT:\n${truncate(originalSystemPrompt, 2000)}`,
    `ORIGINAL USER PROMPT:\n${truncate(originalUserPrompt, 2000)}`,
    `BROKEN JSON TO REPAIR:\n${rawJson}`,
    "Return the corrected JSON only.",
  ].join("\n\n");
}

function truncate(text = "", limit) {
  const value = String(text);

  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}...`;
}
