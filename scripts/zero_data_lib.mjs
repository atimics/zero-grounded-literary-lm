import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) =>
      [key, stableValue(value[key])]));
  }
  return value;
}

export function stableJson(value, indent = 2) {
  return `${JSON.stringify(stableValue(value), null, indent)}\n`;
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, stableJson(value));
  fs.renameSync(temporary, file);
}

export function artifact(root, file) {
  const absolute = path.join(root, file);
  return {
    path: file.split(path.sep).join("/"),
    sha256: sha256File(absolute),
    bytes: fs.statSync(absolute).size,
  };
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function parseNamedArgs(argv, defaults) {
  const options = { ...defaults };
  for (let index = 2; index < argv.length; ++index) {
    const argument = argv[index];
    assert(argument.startsWith("--"), `unexpected argument ${argument}`);
    const key = argument.slice(2).replaceAll("-", "_");
    assert(Object.hasOwn(options, key), `unknown option ${argument}`);
    assert(index + 1 < argv.length, `missing value for ${argument}`);
    options[key] = argv[++index];
  }
  return options;
}

export function listFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else files.push(path.relative(root, full));
    }
  }
  visit(root);
  return files;
}
