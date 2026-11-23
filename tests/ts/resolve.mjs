import { readFileSync, statSync } from "node:fs";
import { dirname, resolve as join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, next) {
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  if (relative && context.parentURL && context.parentURL.startsWith("file:")) {
    const base = join(dirname(fileURLToPath(context.parentURL)), specifier);
    const stem = base.replace(/\.js$/, "");
    for (const candidate of [base, stem + ".ts", base + ".ts", base + ".js"]) {
      if (isFile(candidate)) return next(pathToFileURL(candidate).href, context);
    }
  }
  return next(specifier, context);
}

const NAMED_IMPORT = /^import\s*\{([^}]*)\}\s*from\s*(['"])(\.{1,2}\/[^'"]+)\2;?/gm;
const TYPE_EXPORT = /^export\s+(?:declare\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm;
const VALUE_EXPORT = /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|enum)\s+([A-Za-z_$][\w$]*)/gm;
const typeOnly = new Map();

function typeOnlyNames(path) {
  if (!typeOnly.has(path)) {
    const text = readFileSync(path, "utf8");
    const values = new Set([...text.matchAll(VALUE_EXPORT)].map((found) => found[1]));
    const types = [...text.matchAll(TYPE_EXPORT)].map((found) => found[1]);
    typeOnly.set(path, new Set(types.filter((name) => !values.has(name))));
  }
  return typeOnly.get(path);
}

function withoutTypeNames(source, path) {
  return source.replace(NAMED_IMPORT, (whole, list, quote, specifier) => {
    const base = join(dirname(path), specifier);
    const target = [base + ".ts", base.replace(/\.js$/, "") + ".ts", base].find(isFile);
    if (!target || !target.endsWith(".ts")) return whole;
    const drop = typeOnlyNames(target);
    const names = list.split(",").map((name) => name.trim()).filter(Boolean);
    const kept = names.filter((name) => !name.startsWith("type ") && !drop.has(name.split(/\s+as\s+/)[0]));
    if (kept.length === names.length) return whole;
    const lines = "\n".repeat(whole.split("\n").length - 1);
    return (kept.length ? `import { ${kept.join(", ")} } from ${quote}${specifier}${quote};` : "") + lines;
  });
}

export async function load(url, context, next) {
  const result = await next(url, context);
  if (result.format !== "module-typescript" || result.source == null || !url.startsWith("file:")) return result;
  const text = typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);
  return { ...result, source: withoutTypeNames(text, fileURLToPath(url)) };
}
