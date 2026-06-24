const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash-lite";

let apiKey = null;

export function initGemini(key) {
  if (!key) {
    throw new Error("GEMINI_API_KEY is required.");
  }

  apiKey = key.trim();
}

export async function safeCallGemini({
  systemPrompt,
  userPrompt,
  agentName,
  model = null,
  maxTokens = null,
}) {
  try {
    const result = await callGemini({
      systemPrompt,
      userPrompt,
      agentName,
      model,
      maxTokens,
    });
    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      parsed: null,
      raw: "",
    };
  }
}

export async function safeCallGeminiWithRetry(options, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await safeCallGemini(options);

    if (result.ok || !isTransientGeminiError(result.error) || attempt === maxAttempts) {
      return result;
    }

    const waitMs = 1000 * attempt;
    console.warn(
      `[${options.agentName}] transient Gemini error: ${result.error}. Retrying in ${waitMs}ms...`
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

function isTransientGeminiError(error = "") {
  return /503|high demand|fetch failed|timed out|timeout|temporarily/i.test(error);
}

export async function callGemini({
  systemPrompt,
  userPrompt,
  agentName = "unknown",
  model = null,
  maxTokens = null,
}) {
  if (!apiKey) throw new Error("Gemini client is not initialized.");

  const modelName = model || process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const fullPrompt = `${userPrompt}

---

Return only valid JSON. No markdown.`;

  const timeoutMs = Number.parseInt(process.env.GEMINI_TIMEOUT_MS || "120000", 10);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${process.env.GEMINI_BASE_URL || GEMINI_BASE_URL}/models/${modelName}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [{
            role: "user",
            parts: [{ text: fullPrompt }],
          }],
          generationConfig: {
            temperature: Number.parseFloat(process.env.GEMINI_TEMPERATURE || "0.7"),
            topP: Number.parseFloat(process.env.GEMINI_TOP_P || "0.95"),
            maxOutputTokens: maxTokens || Number.parseInt(process.env.GEMINI_MAX_TOKENS || "8192", 10),
            responseMimeType: "application/json",
          },
        }),
      }
    );

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = data?.error?.message || response.statusText;
      throw new Error(`Gemini API error ${response.status}: ${detail}`);
    }

    const raw = extractGeminiText(data);

    return {
      parsed: parseJson(raw, agentName),
      raw,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Gemini API request timed out after ${timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractGeminiText(data) {
  return data?.candidates
    ?.flatMap((candidate) => candidate.content?.parts || [])
    ?.map((part) => part.text || "")
    ?.join("") || "";
}

function parseJson(raw, agentName) {
  let text = raw.trim();

  if (text.startsWith("```")) {
    text = text
      .replace(/^```(?:json|JSON)?\s*/, "")
      .replace(/\s*```$/, "");
  }

  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const start = objectStart === -1
    ? arrayStart
    : arrayStart === -1
      ? objectStart
      : Math.min(objectStart, arrayStart);

  if (start > 0) text = text.slice(start);

  const objectEnd = text.lastIndexOf("}");
  const arrayEnd = text.lastIndexOf("]");
  const end = Math.max(objectEnd, arrayEnd);

  if (end >= 0) text = text.slice(0, end + 1);

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${agentName} returned invalid JSON: ${error.message}`);
  }
}
