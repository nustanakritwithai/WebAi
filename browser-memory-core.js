// Pure local-memory helpers.  This module deliberately has no network or DOM access.
export const MEMORY_VERSION = 1;
export const MAX_MESSAGES = 48;
export const MAX_MESSAGE_CHARS = 4_000;
export const MAX_CONTEXT_CHARS = 5_500;
export const MAX_CACHE_ITEMS = 80;

const SECRET_PATTERNS = [
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b|\b(?:bp\d+|ghp|gho|github_pat)_[A-Za-z0-9_-]{8,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /(Bearer\s+)[A-Za-z0-9._~+\/=:-]{8,}/gi,
  /\b((?:TYPHOON_)?API(?:_|\s)?KEY|AUTHORIZATION|ACCESS(?:_|\s)?TOKEN|SESSION(?:_|\s)?TOKEN|PASSWORD|SECRET)\s*([:=])\s*[^\s'"`]+/gi,
  /\b(authorization)\s*:\s*[^\s,;]+/gi
];

export function redactSecrets(value) {
  let text = String(value ?? "");
  text = text.replace(SECRET_PATTERNS[0], "[REDACTED]");
  text = text.replace(SECRET_PATTERNS[1], "$1[REDACTED]");
  text = text.replace(SECRET_PATTERNS[2], "$1$2[REDACTED]");
  return text.replace(SECRET_PATTERNS[3], "$1: [REDACTED]");
}

export function wasRedacted(value) {
  return redactSecrets(value) !== String(value ?? "");
}

export function boundedText(value, limit = MAX_MESSAGE_CHARS) {
  const text = redactSecrets(value).trim();
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

export function tokenize(value) {
  const text = boundedText(value, 8_000).toLocaleLowerCase();
  const words = text.match(/[\p{L}\p{N}_-]{2,}/gu) || [];
  const thaiRuns = text.match(/[\u0E00-\u0E7F]{3,}/g) || [];
  for (const run of thaiRuns) {
    for (let index = 0; index < run.length - 1 && index < 120; index += 1) words.push(run.slice(index, index + 2));
  }
  return [...new Set(words)].slice(0, 160);
}

export function scoreRelated(query, candidate) {
  const left = new Set(Array.isArray(query) ? query : tokenize(query));
  const right = new Set(Array.isArray(candidate) ? candidate : tokenize(candidate));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.sqrt(left.size * right.size);
}

export function isFreshRequest(value) {
  return /\b(latest|current|now|today|status|health|deploy|price|time)\b|ล่าสุด|ตอนนี้|สถานะ|ตรวจสุขภาพ|ดีพลอย|ราคา|เวลา/u.test(String(value ?? "").toLocaleLowerCase());
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function exactCacheKey({ prompt, mode = "ask", model = "OpenTyphoon", memoryRevision = 0 }) {
  const canonical = JSON.stringify({ prompt: boundedText(prompt, 8_000), mode, model, memoryRevision });
  return `v${MEMORY_VERSION}-${fnv1a(canonical)}`;
}

export function defaultSnapshot() {
  return {
    version: MEMORY_VERSION,
    memoryRevision: 0,
    updatedAt: new Date(0).toISOString(),
    messages: [{ role: "system", content: "You are WebAi, an AI software engineering assistant. Respond in the user's language." }],
    task: null
  };
}

export function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return defaultSnapshot().messages;
  const safe = messages
    .filter((message) => ["system", "user", "assistant"].includes(message?.role))
    .slice(-MAX_MESSAGES)
    .map((message) => ({ role: message.role, content: boundedText(message.content) }))
    .filter((message) => message.content);
  return safe.length ? safe : defaultSnapshot().messages;
}

export function sanitizeTask(task) {
  if (!task || typeof task !== "object") return null;
  return {
    id: boundedText(task.id || "", 160),
    goal: boundedText(task.goal || "", 2_000),
    mode: boundedText(task.mode || "agent", 40),
    status: boundedText(task.status || "working", 80),
    detail: boundedText(task.detail || "", 2_000),
    nextAction: boundedText(task.nextAction || "", 1_000),
    updatedAt: task.updatedAt || new Date().toISOString()
  };
}

export function sanitizeSnapshot(candidate) {
  if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.messages)) return null;
  return {
    version: MEMORY_VERSION,
    memoryRevision: Number.isSafeInteger(candidate.memoryRevision) && candidate.memoryRevision >= 0 ? candidate.memoryRevision : 0,
    updatedAt: candidate.updatedAt || new Date().toISOString(),
    messages: sanitizeMessages(candidate.messages),
    task: sanitizeTask(candidate.task)
  };
}

export function recoverSnapshot(primary, previous) {
  return sanitizeSnapshot(primary) || sanitizeSnapshot(previous) || defaultSnapshot();
}

export function buildRelatedContext(prompt, cacheEntries, maxChars = MAX_CONTEXT_CHARS) {
  if (isFreshRequest(prompt)) return "";
  const tokens = tokenize(prompt);
  const ranked = (Array.isArray(cacheEntries) ? cacheEntries : [])
    .filter((entry) => entry?.prompt && entry?.answer && !isFreshRequest(entry.prompt))
    .map((entry) => ({ entry, score: scoreRelated(tokens, entry.tokens || tokenize(entry.prompt)) }))
    .filter(({ score }) => score >= 0.18)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
  let remaining = maxChars;
  const blocks = [];
  for (const { entry } of ranked) {
    const block = `Prior local result for related task:\nTask: ${boundedText(entry.prompt, 700)}\nResult: ${boundedText(entry.answer, 1_600)}`;
    if (block.length > remaining) break;
    blocks.push(block);
    remaining -= block.length;
  }
  return blocks.join("\n\n");
}
