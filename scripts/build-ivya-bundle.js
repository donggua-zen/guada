/**
 * Regenerate build-resources/ivya/ivya.bundle.js from the pinned ivya package.
 *
 * This script is intentionally not part of the normal app build: the generated
 * bundle is committed so production builds do not need ivya/esbuild. Run it
 * only when updating the pinned version or rebuilding the injected engine.
 */
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const entry = path.join(root, "scripts", "ivya", "ivya-entry.js");
const outDir = path.join(root, "build-resources", "ivya");
const outfile = path.join(outDir, "ivya.bundle.js");

const pkgPath = path.resolve(path.dirname(require.resolve("ivya")), "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

fs.mkdirSync(outDir, { recursive: true });

esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  minify: true,
  legalComments: "none",
  outfile,
  banner: {
    js: `/*! ivya ${pkg.version} | MIT | https://github.com/vitest-dev/ivya */`,
  },
});

const size = fs.statSync(outfile).size;
console.log(`[build-ivya-bundle] ivya ${pkg.version} -> ${path.relative(root, outfile)} (${size} bytes)`);
