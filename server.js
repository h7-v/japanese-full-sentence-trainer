const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const CACHE_DIR = path.join(ROOT, "cache");
const SYNC_CACHE_FILE = path.join(CACHE_DIR, "bunpro-sync.json");
const BUNPRO_BASE_URL = "https://api.bunpro.jp/api/frontend";
const SRS_LEVELS = ["beginner", "adept", "seasoned", "expert", "master"];

loadEnv(path.join(ROOT, ".env"));

const config = {
  port: Number(process.env.PORT || 5174),
  host: process.env.HOST || "127.0.0.1",
  bunproToken: process.env.BUNPRO_API_TOKEN || "",
  openaiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-5.4-mini"
};

const state = {
  syncedAt: null,
  syncedAtDisplay: null,
  overview: null,
  grammarPoints: [],
  sentences: [],
  grammarById: new Map(),
  hydrateCache: new Map()
};

loadSyncCache();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/status") {
      return sendJson(res, 200, {
        hasBunproToken: Boolean(config.bunproToken),
        hasOpenAiKey: Boolean(config.openaiKey),
        model: config.openaiModel,
        syncedAt: state.syncedAt,
        syncedAtDisplay: state.syncedAtDisplay,
        grammarPointCount: state.grammarPoints.length,
        sentenceCount: state.sentences.length,
        jlptLevels: getAvailableJlptLevels(),
        overview: state.overview
      });
    }

    if (req.method === "POST" && url.pathname === "/api/sync") {
      const result = await syncBunpro();
      return sendJson(res, 200, result);
    }

    if (req.method === "GET" && url.pathname === "/api/sentences") {
      if (state.sentences.length === 0) {
        await syncBunpro();
      }
      return sendJson(res, 200, {
        sentences: state.sentences,
        jlptLevels: getAvailableJlptLevels()
      });
    }

    if (req.method === "GET" && url.pathname === "/api/random") {
      if (state.sentences.length === 0) {
        await syncBunpro();
      }
      const sentence = chooseRandom(state.sentences);
      return sendJson(res, 200, { sentence });
    }

    if (req.method === "POST" && url.pathname === "/api/grade") {
      const body = await readJson(req);
      const result = await gradeAnswer(body);
      return sendJson(res, 200, result);
    }

    return serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    return sendJson(res, error.statusCode || 500, {
      error: error.publicMessage || "Something went wrong.",
      detail: error.publicDetail || undefined
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Bunpro Full Sentence Trainer running at http://${config.host}:${config.port}`);
});

async function syncBunpro() {
  requireBunproToken();

  const overview = await bunproGet("/user_stats/srs_level_overview");
  const levelsToFetch = SRS_LEVELS.filter((level) => {
    const count = Number(overview?.grammar?.[level] || 0);
    return count > 0;
  });

  const summariesById = new Map();
  const reviewsByLevel = {};

  for (const level of levelsToFetch) {
    const firstPage = await fetchSrsLevel(level, 1);
    reviewsByLevel[level] = {
      count: firstPage.pagy?.count || 0,
      pages: firstPage.pagy?.pages || 1
    };
    collectGrammarSummaries(firstPage, summariesById);

    const totalPages = Number(firstPage.pagy?.pages || 1);
    for (let page = 2; page <= totalPages; page += 1) {
      const pageData = await fetchSrsLevel(level, page);
      collectGrammarSummaries(pageData, summariesById);
    }
  }

  const summaries = Array.from(summariesById.values()).sort((a, b) => a.id - b.id);
  const hydrated = [];
  const sentences = [];

  for (const summary of summaries) {
    const grammarPoint = await hydrateGrammarPoint(summary);
    hydrated.push(grammarPoint);
    for (const sentence of grammarPoint.sentences) {
      sentences.push(sentence);
    }
  }

  state.syncedAt = new Date().toISOString();
  state.syncedAtDisplay = formatLocalTimestamp(state.syncedAt);
  state.overview = overview;
  state.grammarPoints = hydrated;
  state.sentences = sentences;
  state.grammarById = new Map(hydrated.map((point) => [String(point.id), point]));

  const result = {
    syncedAt: state.syncedAt,
    syncedAtDisplay: state.syncedAtDisplay,
    overview,
    fetchedLevels: reviewsByLevel,
    grammarPointCount: hydrated.length,
    sentenceCount: sentences.length,
    jlptLevels: getAvailableJlptLevels()
  };
  saveSyncCache();
  return result;
}

async function fetchSrsLevel(level, page) {
  const query = new URLSearchParams({
    level,
    reviewable_type: "Grammar",
    page: String(page)
  });
  return bunproGet(`/user_stats/srs_level_details?${query}`);
}

function collectGrammarSummaries(payload, summariesById) {
  const included = payload?.reviews?.included || [];
  for (const item of included) {
    const attrs = item.attributes || {};
    if (attrs.type_snake !== "grammar_point") continue;
    summariesById.set(String(attrs.id), {
      id: attrs.id,
      slug: attrs.slug,
      title: attrs.title,
      meaning: attrs.meaning,
      level: attrs.level
    });
  }
}

async function hydrateGrammarPoint(summary) {
  const cacheKey = String(summary.id || summary.slug);
  if (state.hydrateCache.has(cacheKey)) {
    return state.hydrateCache.get(cacheKey);
  }

  const payload = await bunproGet(`/reviewables/grammar_point/${encodeURIComponent(cacheKey)}`, {
    auth: false
  });
  const attrs = payload.data?.attributes || {};
  const studyQuestions = (payload.included || []).filter((item) => item.type === "study_question");

  const grammarPoint = {
    id: attrs.id || summary.id,
    slug: attrs.slug || summary.slug,
    title: attrs.title || summary.title,
    meaning: stripHtml(attrs.meaning || summary.meaning || ""),
    level: attrs.level || summary.level || "",
    sentences: studyQuestions
      .map((item) => normalizeStudyQuestion(item, attrs, summary))
      .filter(Boolean)
  };

  state.hydrateCache.set(cacheKey, grammarPoint);
  return grammarPoint;
}

function normalizeStudyQuestion(item, grammarAttrs, summary) {
  const attrs = item.attributes || {};
  if (!attrs.content || !attrs.translation) return null;

  const japanese = reconstructJapanese(attrs.content, attrs.answer || attrs.kanji_answer || "");
  if (!japanese) return null;

  return {
    id: String(attrs.id || item.id),
    grammarPointId: String(grammarAttrs.id || summary.id),
    grammarTitle: grammarAttrs.title || summary.title,
    grammarSlug: grammarAttrs.slug || summary.slug,
    grammarMeaning: stripHtml(grammarAttrs.meaning || summary.meaning || ""),
    jlptLevel: grammarAttrs.level || summary.level || "",
    english: stripHtml(attrs.translation || ""),
    japanese,
    answer: attrs.answer || "",
    questionType: attrs.question_type || "",
    audio: {
      male: attrs.male_audio_url || "",
      female: attrs.female_audio_url || ""
    }
  };
}

function reconstructJapanese(content, answer) {
  const plain = stripHtml(content)
    .replace(/\s+/g, "")
    .trim();
  return plain.replace(/_{2,}/g, answer).trim();
}

async function gradeAnswer(body) {
  if (!config.openaiKey) {
    const err = new Error("OpenAI API key is not configured.");
    err.statusCode = 400;
    err.publicMessage = "Set OPENAI_API_KEY in .env before grading.";
    throw err;
  }

  const sentence = body?.sentence || {};
  const userAnswer = String(body?.answer || "").trim();
  if (!sentence.english || !sentence.japanese || !userAnswer) {
    const err = new Error("Missing grading input.");
    err.statusCode = 400;
    err.publicMessage = "A sentence and non-empty answer are required.";
    throw err;
  }

  const prompt = {
    task: "Grade a Japanese learner's translation attempt.",
    targetGrammar: {
      title: sentence.grammarTitle,
      meaning: sentence.grammarMeaning,
      jlptLevel: sentence.jlptLevel
    },
    englishPrompt: sentence.english,
    bunproReferenceJapanese: sentence.japanese,
    learnerJapanese: userAnswer,
    gradingRules: [
      "Accept natural Japanese that expresses the English prompt, even if it is not word-for-word identical to the reference.",
      "The learner answer should use the target grammar point or an equivalent form appropriate for the prompt.",
      "Do not require the exact same nouns, pronouns, or word order when the meaning remains correct.",
      "Use a coarse 0-10 score. Give 10 for fully correct, natural answers, even when they differ from the reference.",
      "Use 9 for correct answers with very small nuance, style, punctuation, or spelling issues.",
      "Use 7-8 for close answers that communicate the idea but have a noticeable grammar or naturalness issue.",
      "Use 0-6 for answers with wrong meaning, missing target grammar, or major grammar problems.",
      "Reject answers with major grammar errors, wrong meaning, or missing target grammar.",
      "Return concise feedback suitable for a learner.",
      "Also return acceptedJapaneseAnswers for a no-API drill step. Include the Bunpro reference, the corrected/natural answer, and reasonable kana/kanji/furigana-free variants of those answers.",
      "acceptedJapaneseAnswers should be complete Japanese sentences only, not explanations. Do not include incorrect learner answers unless they are genuinely acceptable."
    ],
    responseSchema: {
      verdict: "correct | close | incorrect",
      score: "integer from 0 to 10",
      feedback: "short learner-facing explanation",
      correctedJapanese: "natural corrected answer, if needed",
      acceptedJapaneseAnswers: "array of acceptable full-sentence Japanese answers for exact local drill checking, including kana/kanji variants",
      notes: "brief internal rationale"
    }
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.openaiModel,
      input: [
        {
          role: "system",
          content: "You are a careful Japanese grammar tutor. Reply only as valid JSON."
        },
        {
          role: "user",
          content: JSON.stringify(prompt)
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "grading_result",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["verdict", "score", "feedback", "correctedJapanese", "acceptedJapaneseAnswers", "notes"],
            properties: {
              verdict: { type: "string", enum: ["correct", "close", "incorrect"] },
              score: { type: "integer", minimum: 0, maximum: 10 },
              feedback: { type: "string" },
              correctedJapanese: { type: "string" },
              acceptedJapaneseAnswers: {
                type: "array",
                minItems: 1,
                maxItems: 12,
                items: { type: "string" }
              },
              notes: { type: "string" }
            }
          }
        }
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error("OpenAI grading failed.");
    err.statusCode = response.status;
    err.publicMessage = "OpenAI grading failed.";
    err.publicDetail = payload.error?.message || response.statusText;
    throw err;
  }

  const text = payload.output_text || payload.output?.[0]?.content?.[0]?.text || "{}";
  const result = JSON.parse(text);
  result.acceptedJapaneseAnswers = uniqueNonEmptyStrings([
    ...(Array.isArray(result.acceptedJapaneseAnswers) ? result.acceptedJapaneseAnswers : []),
    sentence.japanese,
    result.correctedJapanese
  ]);
  return result;
}

async function bunproGet(pathname, options = {}) {
  const useAuth = options.auth !== false;
  const headers = {
    Accept: "application/json",
    Origin: "https://bunpro.jp",
    Referer: "https://bunpro.jp/"
  };
  if (useAuth) {
    requireBunproToken();
    headers.Authorization = `Token token=${config.bunproToken}`;
  }

  const response = await fetch(`${BUNPRO_BASE_URL}${pathname}`, { headers });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const err = new Error(`Bunpro request failed: ${pathname}`);
    err.statusCode = response.status;
    err.publicMessage = "Bunpro request failed.";
    err.publicDetail = payload?.errors?.[0]?.code || payload?.errors?.[0]?.detail || text.slice(0, 200);
    throw err;
  }

  return payload;
}

function requireBunproToken() {
  if (config.bunproToken) return;
  const err = new Error("Bunpro token is not configured.");
  err.statusCode = 400;
  err.publicMessage = "Set BUNPRO_API_TOKEN in .env before syncing.";
  throw err;
}

function stripHtml(value) {
  return decodeEntities(String(value || ""))
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function chooseRandom(items) {
  return items[Math.floor(Math.random() * items.length)] || null;
}

function uniqueNonEmptyStrings(values) {
  const seen = new Set();
  const unique = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    unique.push(text);
  }
  return unique;
}

function getAvailableJlptLevels() {
  const levels = new Set();
  for (const sentence of state.sentences) {
    const level = normalizeJlptLevel(sentence.jlptLevel);
    if (level) levels.add(level);
  }
  return Array.from(levels).sort(compareJlptLevels);
}

function normalizeJlptLevel(level) {
  const value = String(level || "").trim().toUpperCase();
  const match = value.match(/N?([1-5])$/);
  return match ? `JLPT${match[1]}` : value;
}

function compareJlptLevels(a, b) {
  const order = ["JLPT5", "JLPT4", "JLPT3", "JLPT2", "JLPT1"];
  const aIndex = order.indexOf(a);
  const bIndex = order.indexOf(b);
  if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
  if (aIndex !== -1) return -1;
  if (bIndex !== -1) return 1;
  return a.localeCompare(b);
}

function loadSyncCache() {
  if (!fs.existsSync(SYNC_CACHE_FILE)) return;
  try {
    const payload = JSON.parse(fs.readFileSync(SYNC_CACHE_FILE, "utf8"));
    applySyncCache(payload);
    console.log("Loaded Bunpro sync cache.");
  } catch (error) {
    console.warn(`Could not load Bunpro sync cache: ${error.message}`);
  }
}

function saveSyncCache() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const payload = {
    savedAt: new Date().toISOString(),
    syncedAt: state.syncedAt,
    syncedAtDisplay: state.syncedAtDisplay,
    overview: state.overview,
    grammarPoints: state.grammarPoints,
    sentences: state.sentences
  };
  fs.writeFileSync(SYNC_CACHE_FILE, JSON.stringify(payload, null, 2));
}

function applySyncCache(payload) {
  state.syncedAt = payload.syncedAt || payload.savedAt || null;
  state.syncedAtDisplay = payload.syncedAtDisplay || formatLocalTimestamp(state.syncedAt);
  state.overview = payload.overview || null;
  state.grammarPoints = Array.isArray(payload.grammarPoints) ? payload.grammarPoints : [];
  state.sentences = Array.isArray(payload.sentences) ? payload.sentences : [];
  state.grammarById = new Map(state.grammarPoints.map((point) => [String(point.id), point]));
  state.hydrateCache = new Map();
  for (const point of state.grammarPoints) {
    if (point.id) state.hydrateCache.set(String(point.id), point);
    if (point.slug) state.hydrateCache.set(String(point.slug), point);
  }
}

function formatLocalTimestamp(isoTimestamp) {
  if (!isoTimestamp) return null;
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body, null, 2));
}

function serveStatic(req, res, url) {
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(PUBLIC_DIR, filePath);
  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(absolutePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, {
      "Content-Type": contentType(absolutePath),
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
