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
  tune: document.querySelector("#tuneButton"),
  tuning: document.querySelector("#tuning"),
  about: document.querySelector("#aboutButton"),
  dialog: document.querySelector("#aboutDialog"),
  dialogClose: document.querySelector("#dialogClose"),
  temperature: document.querySelector("#temperature"),
  topK: document.querySelector("#topK"),
  repetition: document.querySelector("#repetition"),
  length: document.querySelector("#length"),
};

const voiceOpenings = {
  mixed: "",
  shakespeare: "ACT I.\nSCENE I.\n\n",
  blake: "SONGS OF VISION\n\n",
  crowley: "THE BOOK OF THE LAW\n\n",
};

let module;
let modelPointer = 0;
let generating = false;
let shouldStop = false;
let conversationStarted = false;

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
  ui.statusText.textContent = "model awake · local only";
  ui.prompt.disabled = false;
  ui.send.disabled = false;
  ui.loadBar.style.width = "100%";
  ui.modelStats.textContent = `${module._lm_get_parameters().toLocaleString()} parameters · ${module._lm_get_context()} character memory · update ${module._lm_get_update().toLocaleString()}`;
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
  ui.prompt.disabled = true;
  addMessage("user", prompt);
  const answer = addMessage("model");
  ui.prompt.value = "";

  if (!conversationStarted) {
    module._lm_reset();
    module._lm_seed((Date.now() >>> 0) || 1);
    feed(voiceOpenings[ui.voice.value]);
    conversationStarted = true;
  } else {
    feed("\n\n");
  }
  feed(`${prompt}\n\n`);

  const length = Number(ui.length.value);
  const temperature = Number(ui.temperature.value);
  const topK = Number(ui.topK.value);
  const repetition = Number(ui.repetition.value);
  let text = "";

  for (let index = 0; index < length && !shouldStop; index += 1) {
    const token = module._lm_sample(temperature, topK, repetition);
    if (token < 0) break;
    module._lm_feed(token);
    text += String.fromCharCode(token);
    if (index % 5 === 0 || index === length - 1) {
      answer.body.textContent = text;
      answer.article.scrollIntoView({ block: "nearest", behavior: "smooth" });
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }

  answer.body.textContent = text.trimEnd();
  answer.article.classList.add("done");
  generating = false;
  shouldStop = false;
  ui.sendLabel.textContent = "BEGIN";
  ui.prompt.disabled = false;
  ui.send.disabled = false;
  ui.prompt.focus();
}

function clearMemory() {
  if (!module || generating) return;
  module._lm_reset();
  conversationStarted = false;
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

initialize();
