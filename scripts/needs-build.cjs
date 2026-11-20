// Used by run-overlay.bat so a normal launch skips rebuilding when nothing changed.
//   node scripts/needs-build.cjs web|server          exit 0 = rebuild needed, 1 = the build is up to date
//   node scripts/needs-build.cjs web|server --mark   record the current sources as built
// The fingerprint is every file's path, size and modification time under the part's sources, plus the
// lockfile; reading stats only, so the check takes a few milliseconds.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const PARTS = {
  web: { sources: ["web/src", "web/index.html", "web/vite.config.ts", "web/package.json"], output: "web/dist/index.html" },
  server: { sources: ["server/src", "server/package.json"], output: "server/dist/index.js" },
};

const part = PARTS[process.argv[2]];
if (!part) {
  console.error("usage: needs-build.cjs web|server [--mark]");
  process.exit(2);
}

function walk(p, out) {
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return;
  }
  if (st.isDirectory()) for (const name of fs.readdirSync(p).sort()) walk(path.join(p, name), out);
  else out.push(`${path.relative(root, p)}:${st.size}:${Math.floor(st.mtimeMs)}`);
}

const entries = [];
for (const s of [...part.sources, "package-lock.json"]) walk(path.join(root, s), entries);
const hash = crypto.createHash("sha256").update(entries.join("\n")).digest("hex");
const marker = path.join(root, path.dirname(part.output), ".build-hash");

if (process.argv.includes("--mark")) {
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, hash);
  process.exit(0);
}
let built = "";
try {
  built = fs.readFileSync(marker, "utf8").trim();
} catch {
  /* never built through the launcher */
}
process.exit(built === hash && fs.existsSync(path.join(root, part.output)) ? 1 : 0);
