// Used by run-overlay.bat so a normal launch skips `npm install`.
//   node scripts/needs-install.cjs          exit 0 = install needed, 1 = node_modules is up to date
//   node scripts/needs-install.cjs --mark   record the current package-lock.json as installed
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const lock = path.join(root, "package-lock.json");
const marker = path.join(root, "node_modules", ".lock-hash");

const hash = crypto.createHash("sha256").update(fs.readFileSync(lock)).digest("hex");

if (process.argv.includes("--mark")) {
  fs.writeFileSync(marker, hash);
  process.exit(0);
}

let installed = "";
try {
  installed = fs.readFileSync(marker, "utf8").trim();
} catch {
  /* never marked: install */
}
process.exit(installed === hash ? 1 : 0);
