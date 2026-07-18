import createLiteraryModule from "./literary.js";

const ui = {
  status: document.querySelector("#status"),
  statusText: document.querySelector("#statusText"),
  loadBar: document.querySelector("#loadBar"),
  modelStats: document.querySelector("#modelStats"),
  prompt: document.querySelector("#prompt"),
  send: document.querySelector("#sendButton"),
  sendLabel: document.querySelector("#sendLabel"),
  clear: document.querySelector("#clearButton"),
  messages: document.querySelector("#messages"),
  empty: document.querySelector("#emptyState"),
  voice: document.querySelector("#voice"),
  memoryMode: document.querySelector("#memoryMode"),
  summary: document.querySelector("#channelSummary"),
  memory: document.querySelector("#channelMemory"),
  echo: document.querySelector("#holographicEcho"),
  tune: document.querySelector("#tuneButton"),
  tuning: document.querySelector("#tuning"),
  about: document.querySelector("#aboutButton"),
  dialog: document.querySelector("#aboutDialog"),
  dialogClose: document.querySelector("#dialogClose"),
  temperature: document.querySelector("#temperature"),
  topK: document.querySelector("#topK"),
  repetition: document.querySelector("#repetition"),
  length: document.querySelector("#length"),
  trainingValue: document.querySelector("#trainingValue"),
};

const protocol = {
  channel: 1,
  message: 2,
  reply: 3,
  endMessage: 4,
  target: 6,
  summary: 7,
};

const voiceSettings = {
  mixed: { style: "D", summary: "mixed literary conversation; strange, attentive, intimate" },
  shakespeare: { style: "S", summary: "Shakespearean dramatic scene; answer as a present companion" },
  blake: { style: "B", summary: "Blakean visionary verse; symbolic, lucid, wondering" },
  crowley: { style: "C", summary: "Crowleyan dramatic scene; ceremonial, oracular, direct" },
};

const memoryModes = {
  transcript: { holo: 0, compress: false, echo: false, label: "transcript window" },
  recurrent: { holo: 0, compress: true, echo: false, label: "recurrent memory" },
  flat: { holo: 1, compress: true, echo: true, label: "flat Holo" },
  partitioned: { holo: 2, compress: true, echo: true, label: "partitioned Holo" },
};

let module;
let modelPointer = 0;
let generating = false;
let shouldStop = false;
let history = [];
let channelMemory = "";
let holographicEcho = "";
let holographicEpisodes = [];

function selectedMemoryMode() {
  return memoryModes[ui.memoryMode.value] || memoryModes.flat;
}

function applyMemoryMode() {
  if (module) module._lm_holo_set_mode(selectedMemoryMode().holo);
}

function normalizeAscii(text) {
  const replacements = {
    "‘": "'", "’": "'", "‚": "'", "“": '"', "”": '"',
    "–": "-", "—": "--", "…": "...", "\u00a0": " ",
  };
  const cleaned = text.normalize("NFKD").replace(/[‘’‚“”–—…\u00a0]/g, character => replacements[character]);
  let output = "";
  for (const character of cleaned) {
    const code = character.charCodeAt(0);
    if (character === "\n" || character === "\t" || (code >= 32 && code < 127)) output += character === "\t" ? " " : character;
    else if (code >= 128) output += "?";
  }
  return output;
}

function feed(text) {
  for (const character of normalizeAscii(text)) module._lm_feed(character.charCodeAt(0));
}

function feedToken(token) {
  module._lm_feed(token);
}

function compactMessage(text, limit = 150) {
  const normalized = normalizeAscii(text).replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : normalized.slice(-limit);
}

function compactSummary(text, limit = 100) {
  return normalizeAscii(text).replace(/\s+/g, " ").trim().slice(0, limit);
}

function activeMemory() {
  const voice = voiceSettings[ui.voice.value];
  if (!selectedMemoryMode().compress) return compactSummary(ui.summary.value) || voice.summary;
  return channelMemory || compactSummary(ui.summary.value) || voice.summary;
}

function contextMemory() {
  const memory = activeMemory();
  if (!selectedMemoryMode().echo || !holographicEcho) return compactSummary(memory, 80);
  return compactSummary(`${memory.slice(0, 48)} | ~${holographicEcho.slice(0, 28)}`, 80);
}

function updateMemoryDisplay() {
  const enabled = selectedMemoryMode().compress;
  ui.memory.textContent = enabled ? (channelMemory || "not yet compressed") : "disabled; retaining recent turns";
  ui.memory.classList.toggle("empty", !channelMemory);
}

function updateEchoDisplay(score = 0) {
  const enabled = selectedMemoryMode().echo;
  ui.echo.textContent = !enabled
    ? "disabled in this mode"
    : holographicEcho
    ? `${holographicEcho} · cosine ${score.toFixed(2)}`
    : "no relevant older episode";
  ui.echo.classList.toggle("empty", !enabled || !holographicEcho);
}

function withModelBytes(text, operation) {
  const bytes = new TextEncoder().encode(normalizeAscii(text));
  if (!bytes.length) return -1;
  const pointer = module._malloc(bytes.length);
  if (!pointer) return -1;
  module.HEAPU8.set(bytes, pointer);
  const result = operation(pointer, bytes.length);
  module._free(pointer);
  return result;
}

function recallEpisode(query) {
  holographicEcho = "";
  if (!selectedMemoryMode().echo || !module || module._lm_holo_get_count() === 0) {
    updateEchoDisplay();
    return;
  }
  const slot = withModelBytes(query, (pointer, length) => module._lm_holo_recall(pointer, length));
  const score = module._lm_holo_get_score();
  if (slot >= 0 && score >= 0.22 && holographicEpisodes[slot]) {
    holographicEcho = holographicEpisodes[slot].memory;
  }
  updateEchoDisplay(score);
}

function rememberEpisode(key, memory) {
  if (!selectedMemoryMode().echo) return;
  const slot = withModelBytes(key, (pointer, length) => module._lm_holo_remember(pointer, length));
  if (slot >= 0) holographicEpisodes[slot] = { key, memory: compactSummary(memory, 80) };
}

function feedMessage(message) {
  feedToken(protocol.message);
  feedToken(message.role.charCodeAt(0));
  if (message.reply) {
    feedToken(protocol.reply);
    feedToken(message.reply.charCodeAt(0));
  }
  feed(message.text);
  feedToken(protocol.endMessage);
}

function recentMessages(maximum = 3, budget = 300) {
  const recent = [];
  for (let index = history.length - 1; index >= 0 && recent.length < maximum && budget > 24; index -= 1) {
    const text = compactMessage(history[index].text, 110);
    if (!text) continue;
    const cost = text.length + 5;
    if (cost > budget && recent.length) break;
    recent.push({ ...history[index], text: cost > budget ? text.slice(-Math.max(20, budget - 5)) : text });
    budget -= Math.min(cost, budget);
  }
  return recent.reverse();
}

function rebuildChannel() {
  const voice = voiceSettings[ui.voice.value];
  const recent = recentMessages();

  module._lm_reset();
  feedToken(protocol.channel);
  feedToken(voice.style.charCodeAt(0));
  feedToken(protocol.summary);
  feed(contextMemory());
  feedToken(protocol.endMessage);
  recent.forEach(feedMessage);
  feedToken(protocol.message);
  feedToken("Z".charCodeAt(0));
  feedToken(protocol.reply);
  feedToken("A".charCodeAt(0));
  feedToken(protocol.target);
}

async function compressChannelMemory() {
  if (!selectedMemoryMode().compress || history.length < 2 || shouldStop) return;
  const voice = voiceSettings[ui.voice.value];
  const recent = recentMessages();
  ui.statusText.textContent = "compressing the channel memory";
  await new Promise(resolve => requestAnimationFrame(resolve));

  module._lm_reset();
  feedToken(protocol.channel);
  feedToken(voice.style.charCodeAt(0));
  feedToken(protocol.summary);
  feed(contextMemory());
  feedToken(protocol.endMessage);
  recent.forEach(feedMessage);
  feedToken(protocol.summary);
  feedToken(protocol.target);

  let memory = "";
  for (let index = 0; index < 80 && !shouldStop; index += 1) {
    const token = module._lm_sample(0.42, 20, 1.04);
    if (token < 0 || token === protocol.endMessage) break;
    module._lm_feed(token);
    memory += String.fromCharCode(token);
    if (index % 8 === 0) await new Promise(resolve => requestAnimationFrame(resolve));
  }
  const compressed = compactSummary(memory, 80);
  if (compressed) {
    channelMemory = compressed;
    history = [];
    updateMemoryDisplay();
  }
  ui.statusText.textContent = compressed ? "model awake · memory compressed" : "model awake · local only";
}

function addMessage(kind, text = "") {
  const article = document.createElement("article");
  const label = document.createElement("div");
  const body = document.createElement("p");
  article.className = `message ${kind}`;
  label.className = "message-label";
  label.textContent = kind === "user" ? "YOU / SEED" : "ZERO / CONTINUATION";
  body.className = "message-text";
  body.textContent = text;
  article.append(label, body);
  ui.messages.append(article);
  ui.empty.hidden = true;
  return { article, body };
}

function setReady() {
  ui.status.className = "status ready";
  ui.statusText.textContent = `model awake · ${selectedMemoryMode().label} · local only`;
  ui.prompt.disabled = false;
  ui.send.disabled = false;
  ui.loadBar.style.width = "100%";
  ui.modelStats.textContent = `${module._lm_get_parameters().toLocaleString()} parameters · ${module._lm_get_context()} character memory · update ${module._lm_get_update().toLocaleString()}`;
  ui.trainingValue.textContent = `${module._lm_get_update().toLocaleString()} updates`;
  ui.prompt.focus();
}

function setError(error) {
  console.error(error);
  ui.status.className = "status error";
  ui.statusText.textContent = "model could not wake";
  ui.modelStats.textContent = "Reload the page to try again.";
}

async function fetchWithProgress(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
  const total = Number(response.headers.get("content-length")) || 4_900_000;
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const percent = Math.min(99, Math.round(received / total * 100));
    ui.loadBar.style.width = `${percent}%`;
    ui.statusText.textContent = `awakening the model · ${percent}%`;
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

async function initialize() {
  try {
    module = await createLiteraryModule({ locateFile: file => new URL(file, import.meta.url).href });
    const bytes = await fetchWithProgress("./model.litq8");
    modelPointer = module._malloc(bytes.length);
    if (!modelPointer) throw new Error("WebAssembly memory allocation failed");
    module.HEAPU8.set(bytes, modelPointer);
    const result = module._lm_load(modelPointer, bytes.length);
    if (result !== 0) throw new Error(`Model format error ${result}`);
    applyMemoryMode();
    module._lm_seed((Date.now() >>> 0) || 1);
    setReady();
  } catch (error) {
    setError(error);
  }
}

async function generate() {
  const prompt = ui.prompt.value.trim();
  if (!prompt || !module || generating) return;
  generating = true;
  shouldStop = false;
  ui.sendLabel.textContent = "STOP";
  ui.send.disabled = false;
  ui.memoryMode.disabled = true;
  ui.prompt.disabled = true;
  addMessage("user", prompt);
  const answer = addMessage("model");
  ui.prompt.value = "";

  if (history.length === 0) {
    module._lm_seed((Date.now() >>> 0) || 1);
  }
  recallEpisode(prompt);
  history.push({ role: "A", reply: history.length ? "Z" : "", text: prompt });
  rebuildChannel();

  const length = Number(ui.length.value);
  const temperature = Number(ui.temperature.value);
  const topK = Number(ui.topK.value);
  const repetition = Number(ui.repetition.value);
  let text = "";
  let endedByModel = false;

  for (let index = 0; index < length && !shouldStop; index += 1) {
    const token = module._lm_sample(temperature, topK, repetition);
    if (token < 0) break;
    module._lm_feed(token);
    if (token === protocol.endMessage) {
      endedByModel = true;
      break;
    }
    text += String.fromCharCode(token);
    if (index % 5 === 0 || index === length - 1) {
      answer.body.textContent = text;
      answer.article.scrollIntoView({ block: "nearest", behavior: "smooth" });
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }

  answer.body.textContent = text.trimEnd();
  if (!endedByModel) feedToken(protocol.endMessage);
  history.push({ role: "Z", reply: "A", text: text.trimEnd() });
  answer.article.classList.add("done");
  const stoppedByUser = shouldStop;
  if (!stoppedByUser) await compressChannelMemory();
  rememberEpisode(prompt, channelMemory || `${prompt}; ${text}`);
  generating = false;
  shouldStop = false;
  ui.sendLabel.textContent = "BEGIN";
  ui.prompt.disabled = false;
  ui.send.disabled = false;
  ui.memoryMode.disabled = false;
  ui.statusText.textContent = `model awake · ${selectedMemoryMode().label} · local only`;
  ui.prompt.focus();
}

function clearMemory() {
  if (!module || generating) return;
  module._lm_reset();
  history = [];
  channelMemory = "";
  holographicEcho = "";
  holographicEpisodes = [];
  module._lm_holo_reset();
  updateMemoryDisplay();
  updateEchoDisplay();
  ui.messages.replaceChildren();
  ui.empty.hidden = false;
  ui.prompt.value = "";
  ui.prompt.focus();
}

ui.send.addEventListener("click", () => {
  if (generating) shouldStop = true;
  else generate();
});
ui.prompt.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); generate(); }
});
ui.clear.addEventListener("click", clearMemory);
ui.voice.addEventListener("change", () => {
  ui.summary.value = voiceSettings[ui.voice.value].summary;
  channelMemory = "";
  updateMemoryDisplay();
});
ui.summary.addEventListener("change", () => {
  channelMemory = "";
  updateMemoryDisplay();
});
ui.memoryMode.addEventListener("change", () => {
  if (!module || generating) return;
  applyMemoryMode();
  clearMemory();
  ui.statusText.textContent = `model awake · ${selectedMemoryMode().label} · local only`;
});
ui.tune.addEventListener("click", () => {
  const opening = ui.tuning.hidden;
  ui.tuning.hidden = !opening;
  ui.tune.setAttribute("aria-expanded", String(opening));
});
ui.about.addEventListener("click", () => ui.dialog.showModal());
ui.dialogClose.addEventListener("click", () => ui.dialog.close());
ui.dialog.addEventListener("click", event => { if (event.target === ui.dialog) ui.dialog.close(); });
document.querySelectorAll("[data-prompt]").forEach(button => button.addEventListener("click", () => {
  ui.prompt.value = button.dataset.prompt;
  ui.prompt.focus();
}));

for (const [control, output] of [
  [ui.temperature, "temperatureValue"],
  [ui.topK, "topKValue"],
  [ui.repetition, "repetitionValue"],
  [ui.length, "lengthValue"],
]) {
  control.addEventListener("input", () => { document.querySelector(`#${output}`).value = control.value; });
}

updateMemoryDisplay();
updateEchoDisplay();
initialize();
