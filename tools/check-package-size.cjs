"use strict";

// Conservative source-byte audit. DevTools' actual upload result is authoritative.
// Official limits verified 2026-09-07:
// https://developers.weixin.qq.com/minigame/dev/guide/base-ability/subPackage/useSubPackage.html
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const game = JSON.parse(fs.readFileSync(path.join(root, "game.json"), "utf8"));
const project = JSON.parse(fs.readFileSync(path.join(root, "project.config.json"), "utf8"));
const ignores = project.packOptions && project.packOptions.ignore || [];
const includes = project.packOptions && project.packOptions.include || [];
const normalize = (value) => value.replace(/\\/g, "/").replace(/\/$/, "");

for (const rule of ignores.concat(includes)) {
  if (rule.type !== "file" && rule.type !== "folder") {
    throw new Error(`Package audit needs support for packOptions rule type: ${rule.type}`);
  }
}

function matches(relative, rule) {
  const value = normalize(rule.value);
  return relative === value || (rule.type === "folder" && relative.startsWith(`${value}/`));
}

const packages = (game.subpackages || []).map((item) => {
  const normalizedRoot = normalize(item.root);
  const absolute = path.resolve(root, normalizedRoot);
  if (!absolute.startsWith(root + path.sep)) throw new Error(`Invalid subpackage root: ${item.root}`);
  if (!fs.existsSync(path.join(absolute, "game.js"))) throw new Error(`Missing subpackage entry: ${item.root}/game.js`);
  return { name: item.name, root: normalizedRoot, independent: !!item.independent, files: 0, bytes: 0 };
});
const main = { name: "main", files: 0, bytes: 0 };

function walk(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, item.name);
    const relative = normalize(path.relative(root, absolute));
    if (relative === ".git" || relative.startsWith(".git/")) continue;
    if (item.isSymbolicLink()) throw new Error(`Resolve linked assets before auditing: ${relative}`);
    if (item.isDirectory()) {
      walk(absolute);
      continue;
    }
    if (!item.isFile()) continue;
    const excluded = ignores.some((rule) => matches(relative, rule));
    const included = includes.some((rule) => matches(relative, rule));
    if (excluded && !included) continue;
    const bucket = packages.find((pkg) => relative.startsWith(`${pkg.root}/`)) || main;
    bucket.files += 1;
    bucket.bytes += fs.statSync(absolute).size;
  }
}
walk(root);

const entry = fs.readFileSync(path.join(root, "game.js"), "utf8");
const bootList = entry.match(/const BOOT_SUBPACKAGES\s*=\s*\[([^\]]*)\]/);
if (!bootList) throw new Error("Could not inspect BOOT_SUBPACKAGES in game.js");
const bootNames = Array.from(bootList[1].matchAll(/["']([^"']+)["']/g), (match) => match[1]);
const configuredNames = packages.map((pkg) => pkg.name);
if (new Set(bootNames).size !== bootNames.length
  || bootNames.length !== configuredNames.length
  || configuredNames.some((name) => !bootNames.includes(name))) {
  throw new Error("game.js boot package names do not match game.json subpackages");
}

const totalBytes = packages.reduce((sum, pkg) => sum + pkg.bytes, main.bytes);
// Decimal MB is stricter than MiB and avoids ambiguity in the documentation's M unit.
const errors = [];
if (main.bytes > 4000000) errors.push("Main package exceeds the conservative 4 MB budget");
if (totalBytes > 30000000) errors.push("Main + subpackages exceed the conservative 30 MB budget");
for (const pkg of packages) {
  if (pkg.independent && pkg.bytes > 4000000) errors.push(`${pkg.name} exceeds the independent-subpackage 4 MB budget`);
}
const report = { main, packages, totalBytes, remainingBytes: 30000000 - totalBytes, bootNames, errors };
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  for (const pkg of [main, ...packages]) console.log(`${pkg.name}: ${pkg.bytes.toLocaleString("en-US")} bytes (${(pkg.bytes / 1048576).toFixed(2)} MiB), ${pkg.files} files`);
  console.log(`Total: ${totalBytes.toLocaleString("en-US")} bytes; remaining: ${report.remainingBytes.toLocaleString("en-US")} bytes`);
  console.log(errors.length ? errors.join("\n") : "PASS: package budgets, entry files and boot names are valid.");
}
if (errors.length) process.exitCode = 1;
