import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const outIndex = process.argv.indexOf("--out");
assert(outIndex !== -1 && process.argv[outIndex + 1], "usage: node scripts/stage_huggingface_release.mjs --out EMPTY_DIRECTORY");
const output = path.resolve(process.argv[outIndex + 1]);
assert(output !== path.parse(output).root, "refusing filesystem root as output");
assert(!fs.existsSync(output), `output already exists: ${output}`);

execFileSync("node", ["scripts/check_corpus_rights.mjs"], { stdio: "inherit" });
const manifest = JSON.parse(fs.readFileSync("huggingface/release-manifest.json", "utf8"));
assert.equal(manifest.release_status, "ready");
fs.mkdirSync(output, { recursive: false });
const staged = [];
for (const entry of manifest.files) {
  assert(!entry.target.includes("..") && !path.isAbsolute(entry.target), `unsafe target: ${entry.target}`);
  const target = path.join(output, entry.target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(entry.source, target, fs.constants.COPYFILE_EXCL);
  const digest = sha256(target);
  if (entry.sha256) assert.equal(digest, entry.sha256);
  staged.push({ path: entry.target, sha256: digest, bytes: fs.statSync(target).size, license: entry.license });
}
fs.writeFileSync(path.join(output, "RELEASE_FILES.json"), `${JSON.stringify({ schema: "zero.huggingface_staged.v1", files: staged }, null, 2)}\n`, { flag: "wx" });
console.log(`Staged ${staged.length} allowlisted files at ${output}`);
