const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_REQUESTS_BEFORE_SLEEP = 14;
const DEFAULT_REQUEST_SLEEP_MS = 58_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRY_ATTEMPTS = 4;
const DEFAULT_MAX_OUTPUT_TOKENS = 65_536;

let apiKey = null;
let geminiRequestCount = 0;
let geminiCooldownUntil = 0;

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

export async function safeCallGeminiWithRetry(
  options,
  maxAttempts = Number.parseInt(
    process.env.GEMINI_MAX_RETRY_ATTEMPTS || String(DEFAULT_MAX_RETRY_ATTEMPTS),
    10
  )
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await safeCallGemini(options);

    if (result.ok || !isTransientGeminiError(result.error) || attempt === maxAttempts) {
      return result;
    }

    const waitMs = readRetryDelayMs(result.error) || 1000 * attempt;
    if (isQuotaGeminiError(result.error)) {
      geminiCooldownUntil = Math.max(geminiCooldownUntil, Date.now() + waitMs);
    }
    console.warn(
      `[${options.agentName}] transient Gemini error: ${result.error}. Retrying in ${waitMs}ms...`
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

function isTransientGeminiError(error = "") {
  return /429|500|502|503|504|resource_exhausted|rate limit|quota|fetch failed|timed out|timeout|temporarily/i.test(error);
}

function isQuotaGeminiError(error = "") {
  return /429|resource_exhausted|rate limit|quota/i.test(error);
}

function readRetryDelayMs(error = "") {
  const retryAfterMatch = String(error).match(/retry after ([\d.]+)s/i);
  const tryAgainMatch = String(error).match(/try again in ([\d.]+)s/i);
  const retryInMatch = String(error).match(/retry in ([\d.]+)s/i);
  const pleaseRetryMatch = String(error).match(/please retry in ([\d.]+)s/i);
  const seconds = Number.parseFloat(
    retryAfterMatch?.[1] ||
      tryAgainMatch?.[1] ||
      retryInMatch?.[1] ||
      pleaseRetryMatch?.[1] ||
      ""
  );

  if (!Number.isFinite(seconds)) {
    return 0;
  }

  return Math.ceil(seconds * 1000) + 1000;
}

export async function callGemini({
  systemPrompt,
  userPrompt,
  agentName = "unknown",
  model = null,
  maxTokens = null,
  skipJsonRepair = false,
}) {
  if (!apiKey) throw new Error("Gemini client is not initialized.");

  await waitForGeminiRateLimitWindow(agentName);

  const modelName = model || process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const fullPrompt = `${userPrompt}

---

Return only valid JSON. No markdown.`;

  const timeoutMs = Number.parseInt(
    process.env.GEMINI_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS),
    10
  );
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
            maxOutputTokens: maxTokens || Number.parseInt(
              process.env.GEMINI_MAX_OUTPUT_TOKENS || String(DEFAULT_MAX_OUTPUT_TOKENS),
              10
            ),
            responseMimeType: "application/json",
          },
        }),
      }
    );

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const detail = data?.error?.message || response.statusText;
      const retryMessage = retryAfter ? ` Retry after ${retryAfter}s.` : "";
      throw new Error(`Gemini API error ${response.status}: ${detail}${retryMessage}`);
    }

    const raw = extractGeminiText(data);
    const parsed = skipJsonRepair
      ? parseJson(raw, agentName)
      : await parseJsonWithRepair({
        raw,
        agentName,
        systemPrompt,
        userPrompt,
        model,
        maxTokens,
      });

    return {
      parsed,
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

async function waitForGeminiRateLimitWindow(agentName) {
  await waitForGeminiCooldown(agentName);

  geminiRequestCount += 1;

  const requestsBeforeSleep = Number.parseInt(
    process.env.GEMINI_REQUESTS_BEFORE_SLEEP || String(DEFAULT_REQUESTS_BEFORE_SLEEP),
    10
  );
  const sleepMs = Number.parseInt(
    process.env.GEMINI_REQUEST_SLEEP_MS || String(DEFAULT_REQUEST_SLEEP_MS),
    10
  );
  const shouldSleep =
    geminiRequestCount > 1 &&
    (geminiRequestCount - 1) % requestsBeforeSleep === 0;

  if (!shouldSleep) {
    return;
  }

  console.log(
    `[${agentName}] Gemini request ${geminiRequestCount}: waiting ${sleepMs / 1000}s after ${requestsBeforeSleep} requests to avoid the RPM limit.`
  );

  await new Promise((resolve) => setTimeout(resolve, sleepMs));
}

async function waitForGeminiCooldown(agentName) {
  const waitMs = geminiCooldownUntil - Date.now();

  if (waitMs <= 0) {
    return;
  }

  console.log(
    `[${agentName}] Gemini quota cooldown: waiting ${Math.ceil(waitMs / 1000)}s before the next request.`
  );
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

function extractGeminiText(data) {
  return data?.candidates
    ?.flatMap((candidate) => candidate.content?.parts || [])
    ?.map((part) => part.text || "")
    ?.join("") || "";
}

async function parseJsonWithRepair({
  raw,
  agentName,
  systemPrompt,
  userPrompt,
  model,
  maxTokens,
}) {
  try {
    return parseJson(raw, agentName);
  } catch (error) {
    const { repairJsonAgentNode } = await import("../agents/jsonRepairAgent.js");
    const repaired = await repairJsonAgentNode({
      agentName,
      rawJson: raw,
      parseError: error.message,
      originalSystemPrompt: systemPrompt,
      originalUserPrompt: userPrompt,
      model,
      maxTokens,
    });

    if (!repaired.ok) {
      throw error;
    }

    return repaired.parsed;
  }
}

export function parseJson(raw, agentName) {
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
    const balancedJson = extractFirstBalancedJson(text);
    if (balancedJson) {
      try {
        return JSON.parse(balancedJson);
      } catch {}
    }

    throw new Error(`${agentName} returned invalid JSON: ${error.message}`);
  }
}

function extractFirstBalancedJson(text) {
  const start = findFirstJsonStart(text);
  if (start === -1) {
    return "";
  }

  const opening = text[start];
  const closing = opening === "{" ? "}" : "]";
  const stack = [closing];
  let inString = false;
  let escaped = false;

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
      continue;
    }

    if (char === "}" || char === "]") {
      if (stack.pop() !== char) {
        return "";
      }

      if (stack.length === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return "";
}

function findFirstJsonStart(text) {
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");

  if (objectStart === -1) return arrayStart;
  if (arrayStart === -1) return objectStart;
  return Math.min(objectStart, arrayStart);
}
