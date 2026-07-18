import fs from "node:fs";
import createLiteraryModule from "../docs/literary.js";

const protocol = { channel: 1, message: 2, reply: 3, endMessage: 4, target: 6, summary: 7 };
const wasmBinary = fs.readFileSync(new URL("../docs/literary.wasm", import.meta.url));
const model = fs.readFileSync(new URL("../docs/model.litq8", import.meta.url));
const runtime = await createLiteraryModule({ wasmBinary });
const pointer = runtime._malloc(model.length);
runtime.HEAPU8.set(model, pointer);

if (runtime._lm_load(pointer, model.length) !== 0) throw new Error("model failed to load");
if (runtime._lm_get_parameters() !== 4_852_992) throw new Error("parameter count changed");
if (runtime._lm_get_context() !== 512) throw new Error("context changed");
if (runtime._lm_get_update() <= 11_600) throw new Error("channel checkpoint was not exported");
if (runtime._lm_holo_set_mode(0) !== 0 || runtime._lm_holo_get_mode() !== 0) throw new Error("disabled memory mode failed");

function feedToken(token) { runtime._lm_feed(token); }
function feed(text) { for (const character of text) feedToken(character.charCodeAt(0)); }
function withBytes(text, operation) {
  const bytes = new TextEncoder().encode(text);
  const address = runtime._malloc(bytes.length);
  runtime.HEAPU8.set(bytes, address);
  const result = operation(address, bytes.length);
  runtime._free(address);
  return result;
}
function message(role, replyRole, text) {
  feedToken(protocol.message);
  feedToken(role.charCodeAt(0));
  if (replyRole) {
    feedToken(protocol.reply);
    feedToken(replyRole.charCodeAt(0));
  }
  feed(text);
  feedToken(protocol.endMessage);
}
function beginChannel(memory) {
  runtime._lm_reset();
  feedToken(protocol.channel);
  feedToken("D".charCodeAt(0));
  feedToken(protocol.summary);
  feed(memory);
  feedToken(protocol.endMessage);
}
function sampleTarget(seed, limit, temperature = 0.55, topK = 24) {
  runtime._lm_seed(seed);
  let output = "";
  let ended = false;
  for (let index = 0; index < limit; index += 1) {
    const token = runtime._lm_sample(temperature, topK, 1.06);
    if (token < 0) throw new Error("sampling failed");
    if (token === protocol.endMessage) { ended = true; break; }
    feedToken(token);
    output += String.fromCharCode(token);
  }
  if (!ended) throw new Error(`target did not emit end marker: ${JSON.stringify(output)}`);
  if (output.trim().length < 6 || !/^[\n\x20-\x7e]+$/.test(output)) {
    throw new Error(`invalid target text: ${JSON.stringify(output)}`);
  }
  return output.trim();
}

for (const [mode, name] of [[1, "flat"], [2, "partitioned"]]) {
  if (runtime._lm_holo_set_mode(mode) !== 0 || runtime._lm_holo_get_mode() !== mode) {
    throw new Error(`${name} memory mode failed`);
  }
  runtime._lm_holo_reset();
  withBytes("the moonlit gate answers with a silver bell", (address, length) => runtime._lm_holo_remember(address, length));
  withBytes("the king wears a golden crown at morning court", (address, length) => runtime._lm_holo_remember(address, length));
  withBytes("winter rivers cross the dark forest", (address, length) => runtime._lm_holo_remember(address, length));
  const recalled = withBytes("what answers at the gate beneath the moon", (address, length) => runtime._lm_holo_recall(address, length));
  if (recalled !== 0 || runtime._lm_holo_get_score() < 0.22) throw new Error(`${name} holographic recall failed`);
  withBytes("database transaction isolation levels", (address, length) => runtime._lm_holo_recall(address, length));
  if (runtime._lm_holo_get_score() >= 0.22) throw new Error(`${name} holographic abstention failed`);
}

runtime._lm_holo_set_mode(1);
runtime._lm_holo_reset();
withBytes("What did you hear beyond the gate?", (address, length) => runtime._lm_holo_remember(address, length));
const channelRecall = withBytes("What did the gate answer?", (address, length) => runtime._lm_holo_recall(address, length));
if (channelRecall !== 0 || runtime._lm_holo_get_score() < 0.22) throw new Error("channel episode recall failed");

beginChannel("strange, attentive literary conversation");
message("A", "", "What spirit walks beneath the moon?");
feedToken(protocol.message);
feedToken("Z".charCodeAt(0));
feedToken(protocol.reply);
feedToken("A".charCodeAt(0));
feedToken(protocol.target);
const nextProbability = runtime._lm_probability("T".charCodeAt(0));
if (!(nextProbability > 0 && nextProbability < 1)) throw new Error("probability API failed");
const reply = sampleTarget(1, 240);

beginChannel("friends ask what waits beyond the moonlit gate");
message("A", "", "What did you hear beyond the gate?");
message("Z", "A", "Only the wind, and something beneath it.");
message("A", "Z", "Then the gate itself answered us.");
feedToken(protocol.summary);
feedToken(protocol.target);
const memory = sampleTarget(2, 140, 0.42, 20);

console.log(`reply: ${reply}\nmemory: ${memory}`);
