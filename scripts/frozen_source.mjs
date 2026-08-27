import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function verifyFrozenGitFile(revision, file, expectedSha256) {
  assert.match(revision, /^[0-9a-f]{7,40}$/);
  assert.match(expectedSha256, /^[0-9a-f]{64}$/);
  const result = spawnSync("git", ["show", `${revision}:${file}`], {
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    result.stderr?.toString() || `cannot read ${file} at ${revision}`);
  assert.equal(sha256(result.stdout), expectedSha256,
    `${file} at ${revision} does not match its frozen hash`);
  return result.stdout;
}

