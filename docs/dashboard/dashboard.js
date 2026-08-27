const $ = (selector) => document.querySelector(selector);
const number = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en");

function safe(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function percent(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "—";
}

function fixed(value, digits = 4) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
}

function parsePayload(run) {
  try { return JSON.parse(run.payload_json || "{}"); } catch { return {}; }
}

function metricType(payload) {
  if (payload.metric_kind === "language-model-bits-per-byte") return "language";
  if (payload.metric_kind === "bits-per-byte") return "latent";
  if (payload.metric_kind === "paired-invariance") return "paired";
  return "standard";
}

function setConnection(mode, text) {
  $("#connection").className = `connection ${mode}`;
  $("#connectionText").textContent = text;
}

function renderDataset(dataset) {
  if (!dataset) {
    $("#datasetBody").className = "empty";
    $("#datasetBody").textContent = "No dataset has been promoted yet.";
    $("#datasetSeal").textContent = "EMPTY";
    return;
  }
  let quality = {};
  try { quality = JSON.parse(dataset.quality_json || "{}"); } catch {}
  $("#datasetSeal").textContent = String(dataset.status || "ready").toUpperCase();
  $("#datasetBody").className = "panel-content";
  $("#datasetBody").innerHTML = `
    <p class="dataset-name">${safe(dataset.dataset_id)}</p>
    <p class="dataset-version">${safe(dataset.version)} · promoted ${safe(new Date(dataset.promoted_at).toLocaleDateString())}</p>
    <div class="digest"><code title="${safe(dataset.dataset_digest)}">${safe(dataset.dataset_digest)}</code><button class="copy" type="button">COPY</button></div>
    <div class="details">
      <div class="detail"><span class="detail-label">SOURCES</span><span class="detail-value">${integer.format(dataset.source_count || 0)}</span></div>
      <div class="detail"><span class="detail-label">DOCUMENTS</span><span class="detail-value">${integer.format(dataset.documents || 0)}</span></div>
      <div class="detail"><span class="detail-label">TRAIN BYTES</span><span class="detail-value">${number.format(dataset.train_bytes || 0)}</span></div>
      <div class="detail"><span class="detail-label">TRAIN TOKENS</span><span class="detail-value">${number.format(dataset.train_tokens || 0)}</span></div>
    </div>
    <div class="quality-line">Quality gate passed · ${integer.format(quality.exact_duplicates_removed || 0)} exact and ${integer.format(quality.near_duplicates_removed || 0)} near duplicates removed · ${integer.format(quality.contamination_matches || 0)} held-out overlaps</div>`;
  $("#datasetBody .copy").addEventListener("click", async (event) => {
    await navigator.clipboard.writeText(dataset.dataset_digest);
    event.currentTarget.textContent = "COPIED";
  });
}

function renderRun(run) {
  if (!run) {
    $("#runBody").className = "empty";
    $("#runBody").textContent = "No run telemetry has been published yet.";
    $("#runSeal").textContent = "EMPTY";
    return;
  }
  const payload = parsePayload(run);
  const decision = run.decision || payload.decision || run.status;
  const type = metricType(payload); const byteRun = type === "language" || type === "latent";
  $("#runSeal").textContent = String(decision).toUpperCase();
  $("#runSeal").className = `seal ${/no-go|failed/.test(String(decision)) ? "no-go" : "neutral"}`;
  const labels = ["add", "multiply", "add-rational", "convert", "solve-linear"];
  const values = payload.per_class_accuracy || [];
  const chart = values.length ? `<div class="chart">${values.map((value, index) => `
    <div class="bar"><span>${safe(labels[index] || `class-${index}`)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, value * 100))}%"></div></div><span>${percent(value)}</span></div>`).join("")}</div>` : "";
  const details = type === "paired" ? `
      <div class="detail"><span class="detail-label">MEAN CHOICE</span><span class="detail-value">${percent(payload.mean_choice_accuracy)}</span></div>
      <div class="detail"><span class="detail-label">MEAN SWAP</span><span class="detail-value">${percent(payload.mean_swap_consistency_accuracy)}</span></div>
      <div class="detail"><span class="detail-label">PAIR EXACT</span><span class="detail-value">${percent(payload.mean_pair_exact_accuracy)}</span></div>
      <div class="detail"><span class="detail-label">AWS COST</span><span class="detail-value">$${fixed(payload.compute_usd, 2)}</span></div>` : type === "language" ? `
      <div class="detail"><span class="detail-label">TRAIN BYTES</span><span class="detail-value">${number.format(payload.training_bytes || 0)}</span></div>
      <div class="detail"><span class="detail-label">TRAIN TOKENS</span><span class="detail-value">${number.format(payload.training_tokens || 0)}</span></div>
      <div class="detail"><span class="detail-label">VALIDATION BPB</span><span class="detail-value">${fixed(payload.validation_bits_per_byte)}</span></div>
      <div class="detail"><span class="detail-label">TEST BPB</span><span class="detail-value">${fixed(payload.test_bits_per_byte)}</span></div>` : byteRun ? `
      <div class="detail"><span class="detail-label">TRAIN BYTES</span><span class="detail-value">${number.format(payload.training_bytes || 0)}</span></div>
      <div class="detail"><span class="detail-label">LATENT BPB</span><span class="detail-value">${fixed(payload.latent_bits_per_byte)}</span></div>
      <div class="detail"><span class="detail-label">BPE BPB</span><span class="detail-value">${fixed(payload.bpe_bits_per_byte)}</span></div>
      <div class="detail"><span class="detail-label">VS BPE</span><span class="detail-value">${fixed(payload.latent_to_bpe_bpb_ratio, 3)}×</span></div>` : `
      <div class="detail"><span class="detail-label">UPDATE</span><span class="detail-value">${integer.format(run.update || 0)}</span></div>
      <div class="detail"><span class="detail-label">LOSS</span><span class="detail-value">${fixed(run.loss)}</span></div>
      <div class="detail"><span class="detail-label">ACCURACY</span><span class="detail-value">${percent(run.accuracy)}</span></div>`;
  const note = type === "paired"
    ? `Claim position gap ${percent(payload.claim_position_gap)} · retrieval position gap ${percent(payload.retrieval_position_gap)}. ${safe(payload.note || "")}`
    : type === "language"
    ? `${fixed(payload.epoch, 2)} corpus epochs · ${fixed(payload.tokens_per_parameter, 2)} tokens per parameter. ${safe(payload.note || "")}`
    : byteRun
    ? `Learned chunk ${fixed(payload.bytes_per_chunk, 2)} bytes · BPE token ${fixed(payload.bytes_per_bpe_token, 2)} bytes · estimated compute ${fixed(payload.estimated_compute_ratio, 3)}× control. ${safe(payload.note || "")}`
    : safe(payload.note || "This snapshot is bound to the dataset digest recorded for the run.");
  $("#runBody").className = "panel-content";
  $("#runBody").innerHTML = `
    <p class="run-name">${safe(run.experiment || run.run_id)}</p>
    <p class="run-subtitle">${safe(run.run_id)} · ${safe(new Date(run.occurred_at).toLocaleString())}</p>
    <div class="details${byteRun ? " byte-details" : ""}">
      ${details}
    </div>${byteRun ? "" : chart}
    <div class="quality-line">${note}</div>`;
}

function renderHistory(runs) {
  if (!runs.length) {
    $("#runHistory").className = "empty";
    $("#runHistory").textContent = "The ledger is empty.";
    return;
  }
  $("#runHistory").className = "history-list";
  $("#runHistory").innerHTML = runs.map((run) => {
    const payload = parsePayload(run); const type = metricType(payload);
    const byteRun = type === "language" || type === "latent";
    const language = type === "language"; const paired = type === "paired";
    return `
    <div class="history-row">
      <div><span class="history-meta">RUN</span><div class="history-name">${safe(run.experiment || run.run_id)}</div></div>
      <div><span class="history-meta">STATUS</span><div class="history-value">${safe(run.decision || run.status)}</div></div>
      <div><span class="history-meta">UPDATE</span><div class="history-value">${integer.format(run.update || 0)}</div></div>
      <div><span class="history-meta">${paired ? "MEAN SWAP" : language ? "VALIDATION BPB" : byteRun ? "LATENT BPB" : "LOSS"}</span><div class="history-value">${paired ? percent(payload.mean_swap_consistency_accuracy) : fixed(language ? payload.validation_bits_per_byte : byteRun ? payload.latent_bits_per_byte : run.loss)}</div></div>
      <div><span class="history-meta">${paired ? "MEAN CHOICE" : language ? "TEST BPB" : byteRun ? "VS BPE" : "ACCURACY"}</span><div class="history-value">${paired ? percent(payload.mean_choice_accuracy) : language ? fixed(payload.test_bits_per_byte) : byteRun ? `${fixed(payload.latent_to_bpe_bpb_ratio, 3)}×` : percent(run.accuracy)}</div></div>
    </div>`;
  }).join("");
}

async function apiBase() {
  const query = new URLSearchParams(location.search).get("api");
  if (query) return query.replace(/\/$/, "");
  const config = await fetch("config.json", { cache: "no-store" }).then((response) => response.json());
  return String(config.apiBase || "").replace(/\/$/, "");
}

async function load() {
  $("#refresh").disabled = true;
  setConnection("", "CONNECTING TO THE LEDGER");
  try {
    const base = await apiBase();
    if (!base) throw new Error("The dashboard API has not been configured yet.");
    const [datasetResponse, runResponse] = await Promise.all([
      fetch(`${base}/datasets`, { cache: "no-store" }),
      fetch(`${base}/runs`, { cache: "no-store" }),
    ]);
    if (!datasetResponse.ok || !runResponse.ok) throw new Error("The ledger API returned an error.");
    const datasets = ((await datasetResponse.json()).datasets || [])
      .sort((left, right) => String(right.promoted_at || "")
        .localeCompare(String(left.promoted_at || "")));
    const runs = (await runResponse.json()).runs || [];
    const dataset = datasets[0]; const run = runs[0];
    $("#datasetCount").textContent = integer.format(datasets.filter((item) => item.status === "ready").length);
    $("#tokenCount").textContent = dataset ? number.format(dataset.train_tokens) : "—";
    $("#documentCount").textContent = dataset ? integer.format(dataset.documents) : "—";
    const latestPayload = run ? parsePayload(run) : {};
    const latestType = metricType(latestPayload);
    const latestIsByteRun = latestType === "language" || latestType === "latent";
    $("#latestMetricLabel").textContent = latestType === "paired" ? "LATEST MEAN CHOICE" : latestType === "language" ? "LATEST VALIDATION BPB" : latestIsByteRun ? "LATEST LATENT BPB" : "LATEST ACCURACY";
    $("#latestMetric").textContent = run
      ? (latestType === "paired" ? percent(latestPayload.mean_choice_accuracy) : latestType === "language" ? fixed(latestPayload.validation_bits_per_byte) : latestIsByteRun ? fixed(latestPayload.latent_bits_per_byte) : percent(run.accuracy)) : "—";
    $("#latestMetricNote").textContent = latestType === "paired" ? "paired validation · test sealed" : latestIsByteRun ? "held-out raw bytes" : "held-out measurement";
    renderDataset(dataset); renderRun(run); renderHistory(runs);
    setConnection("live", "LIVE AWS LEDGER");
  } catch (error) {
    setConnection("error", "LEDGER UNAVAILABLE");
    for (const selector of ["#datasetBody", "#runBody", "#runHistory"]) {
      $(selector).className = "error-message";
      $(selector).textContent = error.message;
    }
  } finally { $("#refresh").disabled = false; }
}

$("#refresh").addEventListener("click", load);
load();
