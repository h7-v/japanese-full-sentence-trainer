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
const sourceContext = document.querySelector("#sourceContext");
const englishPrompt = document.querySelector("#englishPrompt");
const referenceJapanese = document.querySelector("#referenceJapanese");
const resultPanel = document.querySelector("#resultPanel");
const verdictPill = document.querySelector("#verdictPill");
const scoreText = document.querySelector("#scoreText");
const feedbackText = document.querySelector("#feedbackText");
const referenceSentenceText = document.querySelector("#referenceSentenceText");
const correctionText = document.querySelector("#correctionText");
const drillForm = document.querySelector("#drillForm");
const drillInput = document.querySelector("#drillInput");
const drillFeedback = document.querySelector("#drillFeedback");
const retryDelayInput = document.querySelector("#retryDelayInput");
const retryStatus = document.querySelector("#retryStatus");
const retryBadge = document.querySelector("#retryBadge");
const jlptFilter = document.querySelector("#jlptFilter");
const jlptFilterOptions = document.querySelector("#jlptFilterOptions");
const importStatusPanel = document.querySelector("#importStatusPanel");
const bunproSettingsForm = document.querySelector("#bunproSettingsForm");
const bunproTokenInput = document.querySelector("#bunproTokenInput");
const saveBunproTokenButton = document.querySelector("#saveBunproTokenButton");
const bunproSettingsStatus = document.querySelector("#bunproSettingsStatus");
const llmSettingsForm = document.querySelector("#llmSettingsForm");
const llmBaseUrlInput = document.querySelector("#llmBaseUrlInput");
const llmApiKeyInput = document.querySelector("#llmApiKeyInput");
const llmModelInput = document.querySelector("#llmModelInput");
const saveLlmSettingsButton = document.querySelector("#saveLlmSettingsButton");
const llmSettingsStatus = document.querySelector("#llmSettingsStatus");
const ankiConnectButton = document.querySelector("#ankiConnectButton");
const ankiDeckSelect = document.querySelector("#ankiDeckSelect");
const ankiEnglishFieldSelect = document.querySelector("#ankiEnglishFieldSelect");
const ankiJapaneseFieldSelect = document.querySelector("#ankiJapaneseFieldSelect");
const ankiGrammarHintFieldSelect = document.querySelector("#ankiGrammarHintFieldSelect");
const ankiPreviewButton = document.querySelector("#ankiPreviewButton");
const ankiImportButton = document.querySelector("#ankiImportButton");
const ankiStatus = document.querySelector("#ankiStatus");
const ankiPreview = document.querySelector("#ankiPreview");
const ankiFields = Array.from(document.querySelectorAll(".anki-field"));

let currentSentence = null;
let currentCorrectAnswers = [];
let lastStatusText = "";
let sessionHistory = [];
let sessionIndex = -1;
let nextSessionEntryId = 1;
let retryQueue = [];
let sentencePool = [];
let availablePracticeFilters = [];
let selectedPracticeFilters = new Set();
let busy = false;
let ankiBusy = false;

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
bunproSettingsForm.addEventListener("submit", saveBunproSettings);
llmSettingsForm.addEventListener("submit", saveLlmSettings);
ankiConnectButton.addEventListener("click", loadAnkiDecks);
ankiDeckSelect.addEventListener("change", loadAnkiFields);
ankiPreviewButton.addEventListener("click", previewAnkiImport);
ankiImportButton.addEventListener("click", importAnkiSentences);
setInterval(updateRetryStatus, 15000);

boot();

async function boot() {
  try {
    initializeHintPreference();
    initializeRetryDelayPreference();
    const status = await api("/api/status");
    renderStatus(status);
    updateSettingsPlaceholders(status);
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
  setBusy(true, "Importing Bunpro grammar points and sentences...");
  try {
    await api("/api/sync", { method: "POST" });
    const status = await api("/api/status");
    renderStatus(status);
    updateSettingsPlaceholders(status);
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
  if (selectedPracticeFilters.size === 0) {
    statusText.textContent = "Select at least one practice filter.";
    return;
  }
  if (filteredSentences.length === 0) {
    statusText.textContent = "No sentences match the selected practice filters.";
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
  const llmStatus = status.hasLlmCredentials === false ? "LLM key missing" : `Grading with ${status.model || "configured model"}`;
  const sourceParts = [];
  const totalSentences = Number(status.sentenceCount || 0);
  if (status.ankiSentenceCount) {
    sourceParts.push(`Anki ${status.ankiSentenceCount}`);
  }

  if (status.bunproSentenceCount) {
    sourceParts.push(`Bunpro ${status.bunproSentenceCount}`);
  }

  const importStatus = totalSentences
    ? `${totalSentences} sentences${sourceParts.length ? ` (${sourceParts.join(", ")})` : ""}`
    : "No imported sentences yet";
  lastStatusText = `${llmStatus}. ${importStatus}.`;
  renderImportStatusPanel(status);
  restoreStatusText();
}

function renderImportStatusPanel(status) {
  importStatusPanel.textContent = "";
  const rows = [];

  if (status.ankiSentenceCount) {
    rows.push({
      source: "Anki",
      details: `${status.ankiSentenceCount} sentences`,
      importedAt: status.ankiSyncedAt ? `Last import ${formatSyncTime(status.ankiSyncedAt)}` : ""
    });
  }

  if (status.bunproSentenceCount) {
    rows.push({
      source: "Bunpro",
      details: `${status.bunproSentenceCount} sentences, ${status.grammarPointCount || 0} grammar points`,
      importedAt: status.syncedAt ? `Last import ${formatSyncTime(status.syncedAt)}` : ""
    });
  }

  importStatusPanel.classList.toggle("hidden", rows.length === 0);

  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "import-status-row";

    const source = document.createElement("span");
    source.className = "import-status-source";
    source.textContent = row.source;

    const detail = document.createElement("span");
    detail.textContent = row.importedAt
      ? `${row.details}. ${row.importedAt}.`
      : row.details;

    item.append(source, detail);
    importStatusPanel.append(item);
  }
}

function updateSettingsPlaceholders(status) {
  bunproTokenInput.placeholder = status.hasBunproToken ? "Token saved" : "Paste token to save";
  llmBaseUrlInput.placeholder = status.llmBaseUrl || "https://generativelanguage.googleapis.com/v1beta/openai";
  llmApiKeyInput.placeholder = status.hasLlmCredentials ? "Key saved" : "Paste key to save";
  llmModelInput.placeholder = status.model || "gemini-3.5-flash";
}

async function saveBunproSettings(event) {
  event.preventDefault();
  const bunproToken = bunproTokenInput.value.trim();
  if (!bunproToken) {
    bunproSettingsStatus.textContent = "Paste a Bunpro token first.";
    return;
  }

  setSettingsBusy(true, "Saving Bunpro token...");
  try {
    await api("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bunproToken })
    });
    bunproSettingsForm.reset();
    const status = await api("/api/status");
    renderStatus(status);
    updateSettingsPlaceholders(status);
    bunproSettingsStatus.textContent = "Bunpro token saved to .env.";
  } catch (error) {
    bunproSettingsStatus.textContent = error.message;
  } finally {
    setSettingsBusy(false);
  }
}

async function saveLlmSettings(event) {
  event.preventDefault();
  const payload = {
    llmBaseUrl: llmBaseUrlInput.value.trim(),
    llmApiKey: llmApiKeyInput.value.trim(),
    llmModel: llmModelInput.value.trim()
  };
  if (!payload.llmBaseUrl && !payload.llmApiKey && !payload.llmModel) {
    llmSettingsStatus.textContent = "Enter at least one LLM setting first.";
    return;
  }

  setSettingsBusy(true, "Saving LLM settings...");
  try {
    await api("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    llmSettingsForm.reset();
    const status = await api("/api/status");
    renderStatus(status);
    updateSettingsPlaceholders(status);
    llmSettingsStatus.textContent = "LLM settings saved to .env.";
  } catch (error) {
    llmSettingsStatus.textContent = error.message;
  } finally {
    setSettingsBusy(false);
  }
}

async function loadAnkiDecks() {
  setAnkiBusy(true, "Connecting to Anki...");
  try {
    const payload = await api("/api/anki/decks");
    populateSelect(ankiDeckSelect, payload.decks || []);
    const hasDecks = ankiDeckSelect.options.length > 0;
    ankiFields[0].classList.toggle("hidden", !hasDecks);
    ankiStatus.textContent = hasDecks ? "Choose a deck, then choose the fields to import." : "No Anki decks found.";
    if (hasDecks) {
      await loadAnkiFields();
    }
  } catch (error) {
    ankiStatus.textContent = error.message;
  } finally {
    setAnkiBusy(false);
  }
}

async function loadAnkiFields() {
  const deck = ankiDeckSelect.value;
  if (!deck) return;
  setAnkiBusy(true, "Loading fields...");
  try {
    const payload = await api("/api/anki/fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deck })
    });
    const fields = payload.fields || [];
    populateSelect(ankiEnglishFieldSelect, fields);
    populateSelect(ankiJapaneseFieldSelect, fields);
    populateSelect(ankiGrammarHintFieldSelect, fields, { blankLabel: "No grammar hint" });
    selectLikelyField(ankiEnglishFieldSelect, ["english", "translation", "meaning", "front"]);
    selectLikelyField(ankiJapaneseFieldSelect, ["japanese", "sentence", "expression", "back"]);
    selectLikelyField(ankiGrammarHintFieldSelect, ["grammar", "hint", "note", "explanation"]);

    const hasFields = fields.length > 0;
    ankiFields.slice(1).forEach((field) => field.classList.toggle("hidden", !hasFields));
    ankiPreviewButton.classList.toggle("hidden", !hasFields);
    ankiImportButton.classList.toggle("hidden", !hasFields);
    ankiPreview.classList.add("hidden");
    ankiPreview.textContent = "";
    ankiStatus.textContent = hasFields
      ? `${payload.noteCount || 0} notes found in ${deck}.`
      : `No fields found in ${deck}.`;
  } catch (error) {
    ankiStatus.textContent = error.message;
  } finally {
    setAnkiBusy(false);
  }
}

async function previewAnkiImport() {
  const options = getAnkiImportOptions();
  if (!options) return;
  setAnkiBusy(true, "Previewing import...");
  try {
    const payload = await api("/api/anki/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options)
    });
    renderAnkiPreview(payload);
    const usableCount = payload.usableSentenceCount || 0;
    ankiStatus.textContent = `${payload.noteCount || 0} notes found. ${usableCount} usable sentence ${usableCount === 1 ? "pair" : "pairs"} from the first ${payload.checkedNoteCount || 0} checked notes.`;
  } catch (error) {
    ankiStatus.textContent = error.message;
  } finally {
    setAnkiBusy(false);
  }
}

async function importAnkiSentences() {
  const options = getAnkiImportOptions();
  if (!options) return;
  setAnkiBusy(true, "Importing Anki sentences...");
  try {
    const result = await api("/api/anki/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options)
    });
    const status = await api("/api/status");
    renderStatus(status);
    await loadSentencePool({ resetLevels: true });
    resetSessionHistory();
    await showNextSentence();
    ankiStatus.textContent = `Imported ${result.importedSentenceCount || 0} sentence pairs from ${result.deck}.`;
  } catch (error) {
    ankiStatus.textContent = error.message;
  } finally {
    setAnkiBusy(false);
  }
}

function getAnkiImportOptions() {
  const deck = ankiDeckSelect.value;
  const englishField = ankiEnglishFieldSelect.value;
  const japaneseField = ankiJapaneseFieldSelect.value;
  const grammarHintField = ankiGrammarHintFieldSelect.value;
  if (!deck || !englishField || !japaneseField) {
    ankiStatus.textContent = "Choose a deck, English field, and Japanese field first.";
    return null;
  }
  return { deck, englishField, japaneseField, grammarHintField };
}

function renderAnkiPreview(payload) {
  const sentences = Array.isArray(payload) ? payload : payload.preview || [];
  ankiPreview.textContent = "";
  ankiPreview.classList.remove("hidden");
  for (const sentence of sentences) {
    const row = document.createElement("div");
    row.className = "anki-preview-row";

    const english = document.createElement("p");
    english.textContent = sentence.english;

    const japanese = document.createElement("p");
    japanese.textContent = sentence.japanese;

    row.append(english, japanese);
    ankiPreview.append(row);
  }
  if (sentences.length === 0) {
    const diagnostics = document.createElement("div");
    diagnostics.className = "anki-preview-row";

    const heading = document.createElement("p");
    heading.textContent = "No usable sentence pairs found with the selected fields.";

    const fieldInfo = document.createElement("p");
    const selectedFields = payload.selectedFields || {};
    fieldInfo.textContent = `Selected English: ${selectedFields.englishField || "-"} / Japanese: ${selectedFields.japaneseField || "-"}`;

    diagnostics.append(heading, fieldInfo);

    for (const sample of payload.samples || []) {
      const sampleText = document.createElement("p");
      sampleText.textContent = `Sample ${sample.noteId}: EN "${sample.english || "(empty)"}" / JA "${sample.japanese || "(empty)"}"`;
      diagnostics.append(sampleText);
    }

    ankiPreview.append(diagnostics);
  }
}

function populateSelect(select, values, options = {}) {
  select.textContent = "";
  if (options.blankLabel) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = options.blankLabel;
    select.append(option);
  }
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}

function selectLikelyField(select, candidates) {
  const option = Array.from(select.options).find((item) => {
    const value = item.value.toLowerCase();
    return candidates.some((candidate) => value.includes(candidate));
  });
  if (option) select.value = option.value;
}

async function loadSentencePool(options = {}) {
  const payload = await api("/api/sentences");
  sentencePool = Array.isArray(payload.sentences) ? payload.sentences : [];
  availablePracticeFilters = normalizePracticeFilters(payload.practiceFilters || collectPracticeFilters(sentencePool));
  renderJlptFilter(availablePracticeFilters, options);
}

function renderJlptFilter(filters, options = {}) {
  jlptFilterOptions.textContent = "";
  const normalizedFilters = normalizePracticeFilters(filters);
  availablePracticeFilters = normalizedFilters;
  jlptFilter.classList.toggle("hidden", normalizedFilters.length <= 1);

  const shouldReset = options.resetLevels || selectedPracticeFilters.size === 0;
  const selected = shouldReset
    ? new Set(normalizedFilters.map((filter) => filter.id))
    : new Set(normalizedFilters.map((filter) => filter.id).filter((id) => selectedPracticeFilters.has(id)));
  selectedPracticeFilters = selected.size > 0
    ? selected
    : new Set(normalizedFilters.map((filter) => filter.id));

  for (const filter of normalizedFilters) {
    const label = document.createElement("label");
    label.className = "jlpt-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = filter.id;
    checkbox.checked = selectedPracticeFilters.has(filter.id);

    label.append(checkbox, filter.label);
    jlptFilterOptions.append(label);
  }
}

function updateJlptFilterPreference(event) {
  const checkedInputs = Array.from(jlptFilterOptions.querySelectorAll("input:checked"));
  if (checkedInputs.length === 0 && event.target) {
    event.target.checked = true;
    checkedInputs.push(event.target);
  }
  selectedPracticeFilters = new Set(checkedInputs.map((input) => input.value));
  resetSessionHistory();
  void showNextSentence();
}

function getFilteredSentences() {
  if (availablePracticeFilters.length <= 1) return sentencePool;
  return sentencePool.filter((sentence) => selectedPracticeFilters.has(getSentencePracticeFilterId(sentence)));
}

function collectPracticeFilters(sentences) {
  const filters = new Map();
  for (const sentence of sentences) {
    const id = getSentencePracticeFilterId(sentence);
    if (!id || filters.has(id)) continue;
    filters.set(id, {
      id,
      label: sentence.practiceFilterLabel || formatPracticeFilterLabel(sentence),
      source: sentence.source || ""
    });
  }
  return Array.from(filters.values());
}

function normalizePracticeFilters(filters) {
  const byId = new Map();
  for (const filter of filters) {
    if (typeof filter === "string") {
      const id = normalizeJlptLevel(filter);
      if (id) byId.set(id, { id, label: formatJlptLabel(id) });
      continue;
    }
    const id = String(filter?.id || "").trim();
    if (!id) continue;
    byId.set(id, {
      id,
      label: String(filter?.label || id),
      source: filter?.source || ""
    });
  }
  return Array.from(byId.values()).sort(comparePracticeFilters);
}

function getSentencePracticeFilterId(sentence) {
  if (sentence.practiceFilterId) return sentence.practiceFilterId;
  if (sentence.source === "anki") return `anki:${sentence.ankiDeck || sentence.sourceLabel || sentence.grammarTitle || "Anki"}`;
  const level = normalizeJlptLevel(sentence.jlptLevel);
  return level ? `bunpro:${level}` : "bunpro:unknown";
}

function formatPracticeFilterLabel(sentence) {
  if (sentence.source === "anki") {
    return `Anki ${sentence.ankiDeck || sentence.sourceLabel || sentence.grammarTitle || "deck"}`;
  }
  return `Bunpro ${formatJlptLabel(sentence.jlptLevel)}`;
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

function comparePracticeFilters(a, b) {
  const aSource = a.source || (a.id.startsWith("bunpro:") ? "bunpro" : "anki");
  const bSource = b.source || (b.id.startsWith("bunpro:") ? "bunpro" : "anki");
  if (aSource !== bSource) return aSource === "bunpro" ? -1 : 1;
  if (aSource === "bunpro") return compareJlptLevels(a.id.replace(/^bunpro:/, ""), b.id.replace(/^bunpro:/, ""));
  return a.label.localeCompare(b.label);
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
  sourceContext.textContent = sentence.sourceContext || "From imported sentences";
  jlptLevel.textContent = sentence.jlptLevel || "-";
  grammarTitle.textContent = sentence.grammarTitle || "Grammar point";
  grammarMeaning.textContent = sentence.grammarMeaning || sentence.grammarHint || "";
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
  referenceSentenceText.textContent = currentSentence?.japanese
    ? `Reference sentence: ${currentSentence.japanese}`
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
  setAnkiControlsDisabled(isBusy || ankiBusy);
  updateNavigationState();
  if (message) statusText.textContent = message;
  if (!isBusy && !message) restoreStatusText();
}

function setAnkiBusy(isBusy, message) {
  ankiBusy = isBusy;
  setAnkiControlsDisabled(isBusy || busy);
  if (message) ankiStatus.textContent = message;
}

function setAnkiControlsDisabled(isDisabled) {
  ankiConnectButton.disabled = isDisabled;
  ankiDeckSelect.disabled = isDisabled;
  ankiEnglishFieldSelect.disabled = isDisabled;
  ankiJapaneseFieldSelect.disabled = isDisabled;
  ankiGrammarHintFieldSelect.disabled = isDisabled;
  ankiPreviewButton.disabled = isDisabled;
  ankiImportButton.disabled = isDisabled;
}

function setSettingsBusy(isBusy, message) {
  saveBunproTokenButton.disabled = isBusy;
  saveLlmSettingsButton.disabled = isBusy;
  if (message) {
    if (message.includes("Bunpro")) bunproSettingsStatus.textContent = message;
    if (message.includes("LLM")) llmSettingsStatus.textContent = message;
  }
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
