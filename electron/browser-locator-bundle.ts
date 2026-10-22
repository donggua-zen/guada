import * as fs from "fs";
import * as path from "path";

let cachedSource: string | undefined;

/**
 * ivya 的浏览器 IIFE bundle 随 build-resources 分发。
 *
 * dev:        <repo>/build-resources/ivya/ivya.bundle.js
 * packaged:   <resources>/build-resources/ivya/ivya.bundle.js
 */
export function getIvyaBundlePath(): string {
  const candidates = [
    path.join(__dirname, "..", "..", "build-resources", "ivya", "ivya.bundle.js"),
    path.join(process.resourcesPath, "build-resources", "ivya", "ivya.bundle.js"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `ivya bundle not found. Expected one of: ${candidates.join(", ")}`,
    );
  }
  return found;
}

export function getIvyaBundleSource(): string {
  if (cachedSource !== undefined) return cachedSource;
  const bundlePath = getIvyaBundlePath();
  const source = fs.readFileSync(bundlePath, "utf8");
  if (!source.includes("__guadaIvya")) {
    throw new Error(
      `ivya bundle at ${bundlePath} does not expose __guadaIvya; regenerate it with pnpm run build:ivya-bundle`,
    );
  }
  cachedSource = source;
  return source;
}
