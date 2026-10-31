#!/usr/bin/env node
/**
 * Secret scan (Phase 1 upgrade, security §12) — a gitleaks-equivalent
 * scripted scan used in this repo's CI when gitleaks is unavailable.
 * Scans tracked source files for high-signal credential patterns.
 * Exit 1 on any hit; findings print file:line and the RULE, never the
 * matched secret itself.
 *
 *   node scripts/scan-secrets.mjs [dir]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] ?? path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const RULES = [
  { id: "stripe-live-secret", re: /sk_live_[0-9a-zA-Z]{16,}/ },
  { id: "stripe-test-secret", re: /sk_test_[0-9a-zA-Z]{16,}/ },
  { id: "aws-access-key", re: /AKIA[0-9A-Z]{16}/ },
  { id: "generic-private-key", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: "github-token", re: /gh[pousr]_[0-9a-zA-Z]{36,}/ },
  { id: "slack-token", re: /xox[baprs]-[0-9a-zA-Z-]{10,}/ },
  { id: "jwt-long", re: /eyJ[a-zA-Z0-9_-]{40,}\.eyJ[a-zA-Z0-9_-]{20,}\./ },
  { id: "hardcoded-secret-assignment", re: /(?:SECRET|PASSWORD|API_KEY|ACCESS_TOKEN)\s*[:=]\s*["'][^"'\n]{12,}["']/ },
];

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".data", "backups"]);
const SKIP_FILES = new Set(["package-lock.json"]);
const EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".yml", ".yaml", ".toml", ".txt", ".sql", ".sh"]);
// Lines that are documentation/placeholders, not credentials.
const ALLOW = [/\.env\.example/, /process\.env\./, /example/i, /placeholder/i, /your[-_ ]/i, /<[^>]+>/, /xxx+/i, /e2e-smoke-test-only/, /phase1pass/, /test-only/i];

// Precise per-finding ignores (the .gitleaksignore equivalent). Each
// entry must name the file AND the symbol; anything else still fails.
const IGNORES = [
  {
    file: "src/lib/keys.ts",
    rule: "hardcoded-secret-assignment",
    symbol: "LEGACY_DEV_SECRET",
    why: "Intentionally public, low-entropy PRE-UPGRADE dev fallback kept only so old dev tokens verify outside production; lib/keys.ts refuses it whenever NODE_ENV=production.",
  },
];

let hits = 0;
let scanned = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (EXTS.has(path.extname(entry)) && !SKIP_FILES.has(entry) && st.size < 2_000_000) {
      scanned++;
      const lines = readFileSync(full, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (ALLOW.some((re) => re.test(line))) return;
        for (const rule of RULES) {
          if (rule.re.test(line)) {
            const rel = path.relative(root, full);
            const ignored = IGNORES.some((g) => g.file === rel && g.rule === rule.id && line.includes(g.symbol));
            if (ignored) continue;
            console.log(`HIT ${rel}:${i + 1} rule=${rule.id}`);
            hits++;
          }
        }
      });
    }
  }
}

walk(root);
console.log(`secret scan: ${scanned} files scanned, ${hits} hits`);
process.exit(hits > 0 ? 1 : 0);
