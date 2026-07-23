import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split(/\r?\n/).filter(Boolean);
const badNames = /(^|\/)(\.env($|\.)|credentials?.*\.json$|serviceaccount.*\.json$|id_(?:rsa|dsa|ecdsa|ed25519)$|.*\.(?:pem|key|p12|pfx|jks|keystore))$/i;
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bsk-(?:proj-|live-)?[0-9A-Za-z_-]{20,}\b/,
  /\b(?:ghp|github_pat)_[0-9A-Za-z_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
  /\bnpm_[0-9A-Za-z]{30,}\b/,
  /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/,
];
const failures = [];

for (const file of listed) {
  const normalized = file.replaceAll("\\", "/");
  if (badNames.test(normalized)) failures.push(`sensitive filename: ${file}`);
  if (normalized === "scripts/check_sensitive_files.mjs" || normalized.startsWith("vendor/")) continue;
  let stat;
  try { stat = statSync(file); } catch { continue; }
  if (!stat.isFile() || stat.size > 10_000_000) continue;
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) failures.push(`possible credential in: ${file}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Sensitive-file check passed (${listed.length} files inspected).`);
