const statusText = document.querySelector("#statusText");
const syncButton = document.querySelector("#syncButton");
const previousButton = document.querySelector("#previousButton");
const skipMissedButton = document.querySelector("#skipMissedButton");
const nextButton = document.querySelector("#nextButton");
const gradeButton = document.querySelector("#gradeButton");
const answerForm = document.querySelector("#answerForm");
const answerInput = document.querySelector("#answerInput");
const hintToggle = document.querySelector("#hintToggle");
const grammarHint = document.querySelector("#grammarHint");
const jlptLevel = document.querySelector("#jlptLevel");
const grammarTitle = document.querySelector("#grammarTitle");
const grammarMeaning = document.querySelector("#grammarMeaning");
const englishPrompt = document.querySelector("#englishPrompt");
const referenceJapanese = document.querySelector("#referenceJapanese");
const resultPanel = document.querySelector("#resultPanel");
const verdictPill = document.querySelector("#verdictPill");
const scoreText = document.querySelector("#scoreText");
const feedbackText = document.querySelector("#feedbackText");
const bunproSentenceText = document.querySelector("#bunproSentenceText");
const correctionText = document.querySelector("#correctionText");
const drillForm = document.querySelector("#drillForm");
const drillInput = document.querySelector("#drillInput");
const drillFeedback = document.querySelector("#drillFeedback");
const retryDelayInput = document.querySelector("#retryDelayInput");
const retryStatus = document.querySelector("#retryStatus");
const retryBadge = document.querySelector("#retryBadge");
const jlptFilter = document.querySelector("#jlptFilter");
const jlptFilterOptions = document.querySelector("#jlptFilterOptions");

let currentSentence = null;
let currentCorrectAnswers = [];
let lastStatusText = "";
let sessionHistory = [];
let sessionIndex = -1;
let nextSessionEntryId = 1;
let retryQueue = [];
let sentencePool = [];
let availableJlptLevels = [];
let selectedJlptLevels = new Set();
let busy = false;

syncButton.addEventListener("click", syncBunpro);
previousButton.addEventListener("click", showPreviousSentence);
skipMissedButton.addEventListener("click", skipToMissed);
nextButton.addEventListener("click", showNextSentence);
answerForm.addEventListener("submit", gradeAnswer);
drillForm.addEventListener("submit", checkDrillAnswer);
hintToggle.addEventListener("change", updateHintPreference);
answerInput.addEventListener("input", saveCurrentDraft);
drillInput.addEventListener("input", saveCurrentDraft);
retryDelayInput.addEventListener("change", updateRetryDelayPreference);
jlptFilterOptions.addEventListener("change", updateJlptFilterPreference);
setInterval(updateRetryStatus, 15000);

boot();

async function boot() {
  try {
    initializeHintPreference();
    initializeRetryDelayPreference();
    const status = await api("/api/status");
    renderStatus(status);
    if (status.sentenceCount > 0) {
      await loadSentencePool();
      await showNextSentence();
    } else {
      renderJlptFilter([]);
    }
  } catch (error) {
    statusText.textContent = error.message;
  }
}

async function syncBunpro() {
  setBusy(true, "Syncing grammar points and sentences...");
  try {
    const result = await api("/api/sync", { method: "POST" });
    renderStatus(result);
    await loadSentencePool({ resetLevels: true });
    resetSessionHistory();
    await showNextSentence();
  } catch (error) {
    statusText.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function showNextSentence() {
  saveCurrentDraft();
  if (sessionIndex < sessionHistory.length - 1) {
    sessionIndex += 1;
    renderSessionEntry(sessionHistory[sessionIndex]);
    restoreStatusText();
    updateNavigationState();
    return;
  }

  const retry = takeDueRetry();
  if (retry) {
    sessionHistory.push(createSessionEntry(retry.sentence, { source: "retry", retryOf: retry.sourceEntryId }));
    sessionIndex = sessionHistory.length - 1;
    renderSessionEntry(sessionHistory[sessionIndex], { focus: true });
    restoreStatusText();
    updateRetryStatus();
    updateNavigationState();
    return;
  }

  if (sentencePool.length === 0) {
    setBusy(true, "Loading sentences...");
    try {
      await loadSentencePool();
    } catch (error) {
      statusText.textContent = error.message;
      return;
    } finally {
      setBusy(false);
    }
  }

  const filteredSentences = getFilteredSentences();
  if (selectedJlptLevels.size === 0) {
    statusText.textContent = "Select at least one JLPT level.";
    return;
  }
  if (filteredSentences.length === 0) {
    statusText.textContent = "No sentences match the selected JLPT levels.";
    return;
  }

  const sentence = chooseRandom(filteredSentences);
  sessionHistory.push(createSessionEntry(sentence, { source: "random" }));
  sessionIndex = sessionHistory.length - 1;
  renderSessionEntry(sessionHistory[sessionIndex], { focus: true });
  restoreStatusText();
  updateNavigationState();
}

function showPreviousSentence() {
  if (sessionIndex <= 0) return;
  saveCurrentDraft();
  sessionIndex -= 1;
  renderSessionEntry(sessionHistory[sessionIndex]);
  restoreStatusText();
  updateNavigationState();
}

function skipToMissed() {
  saveCurrentDraft();
  const retry = takeNextRetry();
  if (!retry) {
    updateRetryStatus();
    return;
  }
  sessionHistory.push(createSessionEntry(retry.sentence, { source: "retry", retryOf: retry.sourceEntryId }));
  sessionIndex = sessionHistory.length - 1;
  renderSessionEntry(sessionHistory[sessionIndex], { focus: true });
  restoreStatusText();
  updateRetryStatus();
  updateNavigationState();
}

async function gradeAnswer(event) {
  event.preventDefault();
  if (!currentSentence) {
    statusText.textContent = "Load a sentence first.";
    return;
  }
  const answer = answerInput.value.trim();
  if (!answer) {
    statusText.textContent = "Type your Japanese answer first.";
    answerInput.focus();
    return;
  }

  gradeButton.disabled = true;
  statusText.textContent = "Grading...";
  try {
    const result = await api("/api/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentence: currentSentence, answer })
    });
    renderGrade(result);
    const entry = getCurrentEntry();
    if (entry) {
      entry.answer = answer;
      entry.grade = result;
      scheduleRetryForEntry(entry, result);
    }
    restoreStatusText();
  } catch (error) {
    statusText.textContent = error.message;
  } finally {
    gradeButton.disabled = false;
  }
}

function renderStatus(status) {
  const tokenStatus = status.hasBunproToken === false ? "Bunpro token missing" : "Bunpro ready";
  const openaiStatus = status.hasOpenAiKey === false ? "OpenAI key missing" : `Grading with ${status.model || "configured model"}`;
  const counts = status.sentenceCount
    ? `${status.grammarPointCount} grammar points, ${status.sentenceCount} sentences`
    : "Not synced";
  const lastSync = status.syncedAt
    ? `Last sync ${formatSyncTime(status.syncedAt)}`
    : "No local sync cache yet";
  lastStatusText = `${tokenStatus}. ${openaiStatus}. ${counts}. ${lastSync}.`;
  restoreStatusText();
}

async function loadSentencePool(options = {}) {
  const payload = await api("/api/sentences");
  sentencePool = Array.isArray(payload.sentences) ? payload.sentences : [];
  availableJlptLevels = normalizeJlptLevels(payload.jlptLevels || collectJlptLevels(sentencePool));
  renderJlptFilter(availableJlptLevels, options);
}

function renderJlptFilter(levels, options = {}) {
  jlptFilterOptions.textContent = "";
  const normalizedLevels = normalizeJlptLevels(levels);
  availableJlptLevels = normalizedLevels;
  jlptFilter.classList.toggle("hidden", normalizedLevels.length <= 1);

  const shouldReset = options.resetLevels || selectedJlptLevels.size === 0;
  const selected = shouldReset
    ? new Set(normalizedLevels)
    : new Set(normalizedLevels.filter((level) => selectedJlptLevels.has(level)));
  selectedJlptLevels = selected.size > 0 ? selected : new Set(normalizedLevels);

  for (const level of normalizedLevels) {
    const label = document.createElement("label");
    label.className = "jlpt-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = level;
    checkbox.checked = selectedJlptLevels.has(level);

    label.append(checkbox, formatJlptLabel(level));
    jlptFilterOptions.append(label);
  }
}

function updateJlptFilterPreference(event) {
  const checkedInputs = Array.from(jlptFilterOptions.querySelectorAll("input:checked"));
  if (checkedInputs.length === 0 && event.target) {
    event.target.checked = true;
    checkedInputs.push(event.target);
  }
  selectedJlptLevels = new Set(checkedInputs.map((input) => input.value));
  resetSessionHistory();
  void showNextSentence();
}

function getFilteredSentences() {
  if (availableJlptLevels.length <= 1) return sentencePool;
  return sentencePool.filter((sentence) => selectedJlptLevels.has(normalizeJlptLevel(sentence.jlptLevel)));
}

function collectJlptLevels(sentences) {
  return Array.from(new Set(sentences.map((sentence) => normalizeJlptLevel(sentence.jlptLevel)).filter(Boolean)));
}

function normalizeJlptLevels(levels) {
  return Array.from(new Set(levels.map(normalizeJlptLevel).filter(Boolean))).sort(compareJlptLevels);
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

function formatJlptLabel(level) {
  return level.replace(/^JLPT([1-5])$/, "JLPT N$1");
}

function renderSessionEntry(entry, options = {}) {
  if (!entry) return;
  currentSentence = entry.sentence;
  retryBadge.classList.toggle("hidden", entry.source !== "retry");
  renderSentence(entry.sentence, { focus: options.focus === true });
  answerInput.value = entry.answer || "";

  if (entry.grade) {
    renderGrade(entry.grade);
    drillInput.value = entry.drillAnswer || "";
    drillFeedback.textContent = entry.drillFeedback || "";
    drillFeedback.className = entry.drillFeedbackClass || "";
  }

  updateNavigationState();
}

function renderSentence(sentence, options = {}) {
  resultPanel.classList.add("hidden");
  drillForm.classList.add("hidden");
  drillFeedback.textContent = "";
  currentCorrectAnswers = [];
  answerInput.value = "";
  drillInput.value = "";
  jlptLevel.textContent = sentence.jlptLevel || "-";
  grammarTitle.textContent = sentence.grammarTitle || "Grammar point";
  grammarMeaning.textContent = sentence.grammarMeaning || "";
  englishPrompt.textContent = sentence.english || "";
  referenceJapanese.textContent = sentence.japanese || "";
  renderHintVisibility();
  if (options.focus !== false) answerInput.focus();
}

function renderGrade(result) {
  resultPanel.classList.remove("hidden");
  verdictPill.className = "";
  verdictPill.classList.add(result.verdict || "incorrect");
  verdictPill.textContent = result.verdict || "incorrect";
  scoreText.textContent = `${normalizeScore(result.score)} / 10`;
  feedbackText.textContent = result.feedback || "";
  bunproSentenceText.textContent = currentSentence?.japanese
    ? `Bunpro sentence: ${currentSentence.japanese}`
    : "";
  correctionText.textContent = result.correctedJapanese
    ? `Natural answer: ${result.correctedJapanese}`
    : "";
  currentCorrectAnswers = uniqueAnswers([
    currentSentence?.japanese || "",
    result.correctedJapanese || "",
    ...(Array.isArray(result.acceptedJapaneseAnswers) ? result.acceptedJapaneseAnswers : [])
  ]);
  renderDrill(result.verdict);
}

function renderDrill(verdict) {
  drillInput.value = "";
  drillFeedback.textContent = "";
  if (verdict === "correct") {
    drillForm.classList.add("hidden");
    return;
  }
  drillForm.classList.remove("hidden");
}

function checkDrillAnswer(event) {
  event.preventDefault();
  const typedAnswer = normalizeAnswer(drillInput.value);
  const matches = currentCorrectAnswers.some((answer) => normalizeAnswer(answer) === typedAnswer);

  if (matches) {
    drillFeedback.textContent = "Correct. Nice, lock it in.";
    drillFeedback.className = "drill-ok";
    saveCurrentDraft();
    return;
  }

  drillFeedback.textContent = "Not quite. Use one of the correct answers and try again.";
  drillFeedback.className = "drill-miss";
  saveCurrentDraft();
}

function createSessionEntry(sentence, options = {}) {
  return {
    id: nextSessionEntryId++,
    sentence,
    source: options.source || "random",
    retryOf: options.retryOf || null,
    retryDueAt: null,
    answer: "",
    grade: null,
    drillAnswer: "",
    drillFeedback: "",
    drillFeedbackClass: ""
  };
}

function resetSessionHistory() {
  sessionHistory = [];
  sessionIndex = -1;
  retryQueue = [];
  updateNavigationState();
  updateRetryStatus();
}

function getCurrentEntry() {
  return sessionHistory[sessionIndex] || null;
}

function saveCurrentDraft() {
  const entry = getCurrentEntry();
  if (!entry) return;
  entry.answer = answerInput.value;
  entry.drillAnswer = drillInput.value;
  entry.drillFeedback = drillFeedback.textContent;
  entry.drillFeedbackClass = drillFeedback.className;
}

function scheduleRetryForEntry(entry, result) {
  clearRetryForEntry(entry);
  if (result.verdict === "correct") {
    entry.retryDueAt = null;
    updateRetryStatus();
    updateNavigationState();
    return;
  }

  const dueAt = Date.now() + getRetryDelayMinutes() * 60 * 1000;
  entry.retryDueAt = dueAt;
  retryQueue.push({
    sourceEntryId: entry.id,
    sentence: entry.sentence,
    dueAt
  });
  retryQueue.sort((a, b) => a.dueAt - b.dueAt);
  updateRetryStatus();
  updateNavigationState();
}

function clearRetryForEntry(entry) {
  retryQueue = retryQueue.filter((retry) => retry.sourceEntryId !== entry.id);
}

function takeDueRetry() {
  const dueIndex = retryQueue.findIndex((retry) => retry.dueAt <= Date.now());
  if (dueIndex === -1) return null;
  const [retry] = retryQueue.splice(dueIndex, 1);
  return retry;
}

function takeNextRetry() {
  return retryQueue.shift() || null;
}

function hasDueRetry() {
  return retryQueue.some((retry) => retry.dueAt <= Date.now());
}

function normalizeScore(score) {
  const numericScore = Number(score || 0);
  const tenPointScore = numericScore > 10 ? numericScore / 10 : numericScore;
  return Math.max(0, Math.min(10, Math.round(tenPointScore)));
}

function normalizeAnswer(answer) {
  return String(answer || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[（(][ぁ-んァ-ンー]+[）)]/g, "")
    .replace(/[、,，]/g, "")
    .replace(/[。.!！?？]+$/g, "");
}

function uniqueAnswers(answers) {
  const seen = new Set();
  const unique = [];
  for (const answer of answers) {
    const normalized = normalizeAnswer(answer);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(answer);
  }
  return unique;
}

function initializeHintPreference() {
  hintToggle.checked = localStorage.getItem("bunproTrainer.showGrammarHints") === "true";
  renderHintVisibility();
}

function initializeRetryDelayPreference() {
  const savedDelay = Number(localStorage.getItem("bunproTrainer.retryDelayMinutes"));
  retryDelayInput.value = clampRetryDelay(savedDelay || 7);
  updateRetryStatus();
}

function updateHintPreference() {
  localStorage.setItem("bunproTrainer.showGrammarHints", String(hintToggle.checked));
  renderHintVisibility();
}

function updateRetryDelayPreference() {
  const delay = clampRetryDelay(retryDelayInput.value);
  retryDelayInput.value = delay;
  localStorage.setItem("bunproTrainer.retryDelayMinutes", String(delay));
  updateRetryStatus();
}

function renderHintVisibility() {
  grammarHint.classList.toggle("hidden", !hintToggle.checked);
}

function getRetryDelayMinutes() {
  return clampRetryDelay(retryDelayInput.value);
}

function clampRetryDelay(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 7;
  return Math.max(1, Math.min(60, Math.round(numericValue)));
}

function updateRetryStatus() {
  if (retryQueue.length === 0) {
    retryStatus.textContent = "No retries waiting";
    updateNavigationState();
    return;
  }

  const dueCount = retryQueue.filter((retry) => retry.dueAt <= Date.now()).length;
  if (dueCount > 0) {
    retryStatus.textContent = `${dueCount} ${pluralize("retry", dueCount)} ready`;
    updateNavigationState();
    return;
  }

  const nextRetry = retryQueue[0];
  retryStatus.textContent = `${retryQueue.length} waiting, next in ${formatRemainingTime(nextRetry.dueAt - Date.now())}`;
  updateNavigationState();
}

function formatRemainingTime(milliseconds) {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes}m`;
}

function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}

function chooseRandom(items) {
  return items[Math.floor(Math.random() * items.length)] || null;
}

function formatSyncTime(isoTimestamp) {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "time unknown";
  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function setBusy(isBusy, message) {
  busy = isBusy;
  syncButton.disabled = isBusy;
  updateNavigationState();
  if (message) statusText.textContent = message;
  if (!isBusy && !message) restoreStatusText();
}

function restoreStatusText() {
  if (lastStatusText) statusText.textContent = lastStatusText;
}

function updateNavigationState() {
  previousButton.disabled = busy || sessionIndex <= 0;
  skipMissedButton.disabled = busy || retryQueue.length === 0;
  nextButton.disabled = busy;
  const atLatest = sessionIndex >= sessionHistory.length - 1;
  nextButton.textContent = atLatest && hasDueRetry() ? "Retry" : "Next";
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail ? `${payload.error}: ${payload.detail}` : payload.error || response.statusText);
  }
  return payload;
}
