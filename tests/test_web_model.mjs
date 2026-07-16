import fs from "node:fs";
import createLiteraryModule from "../docs/literary.js";

const wasmBinary = fs.readFileSync(new URL("../docs/literary.wasm", import.meta.url));
const model = fs.readFileSync(new URL("../docs/model.litq8", import.meta.url));
const runtime = await createLiteraryModule({ wasmBinary });
const pointer = runtime._malloc(model.length);
runtime.HEAPU8.set(model, pointer);

if (runtime._lm_load(pointer, model.length) !== 0) throw new Error("model failed to load");
if (runtime._lm_get_parameters() !== 4_852_992) throw new Error("parameter count changed");
if (runtime._lm_get_context() !== 512) throw new Error("context changed");
if (runtime._lm_get_update() !== 11_600) throw new Error("wrong checkpoint update");

runtime._lm_seed(1);
const prompt = "The zero opened its eyes, and";
for (const character of prompt) runtime._lm_feed(character.charCodeAt(0));
let output = "";
for (let index = 0; index < 120; index += 1) {
  const token = runtime._lm_sample(0.62, 28, 1.12);
  if (token < 0) throw new Error("sampling failed");
  output += String.fromCharCode(token);
  runtime._lm_feed(token);
}
if (!/^[\n\x20-\x7e]+$/.test(output)) throw new Error("output contains invalid browser text");
console.log(`${prompt}${output}`);
