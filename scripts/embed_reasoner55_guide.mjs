import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// Keep the measured implementation intact and give its CLI a separate symbol.
const source = readFileSync("reasoner55_semantic_guide.c", "utf8");
assert.equal(source.match(/^int main\(/gm)?.length, 1);
mkdirSync("build", { recursive: true });
writeFileSync("build/reasoner55_semantic_guide_embed.h",
  source.replace(/^int main\(/m, "int r55ft_previous_main("));
