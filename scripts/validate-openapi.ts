import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

/**
 * Structural check for docs/openapi.yaml. Not a full JSON Schema validation against the official
 * OpenAPI 3.1 meta-schema (this environment has no network access to fetch it, and no
 * OpenAPI-specific validator is already a project dependency) — this instead checks the invariants
 * that actually matter for the document to be useful: every internal $ref resolves to something
 * that exists, every response carries a description, every path uses a real HTTP method, and every
 * `{param}` in a path template has a matching `in: path` parameter declared.
 *
 * `validateOpenApiDocument` is the reusable core (imported by `tests/openapi.test.ts`, so drift is
 * caught by `npm test`, not only by remembering to run this file by hand); the `require.main`-style
 * check at the bottom is this file's own CLI wrapper, run via `tsx scripts/validate-openapi.ts`.
 *
 * The document is treated as loosely-typed `unknown`-rooted JSON here on purpose — this is a
 * structural linter over arbitrary YAML, not a full OpenAPI type model; `docs/openapi.yaml` itself
 * is the source of truth for shapes, not this file.
 */

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateOpenApiDocument(doc: JsonObject): string[] {
  const errors: string[] = [];

  function resolveRef(ref: string): JsonValue | undefined {
    if (!ref.startsWith("#/")) return undefined;
    return ref
      .slice(2)
      .split("/")
      .reduce<JsonValue | undefined>((node, segment) => (isObject(node as JsonValue) ? (node as JsonObject)[segment] : undefined), doc);
  }

  function walk(node: JsonValue, at: string): void {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${at}[${i}]`));
      return;
    }
    if (!isObject(node)) return;

    if (typeof node.$ref === "string") {
      if (resolveRef(node.$ref) === undefined) errors.push(`${at}: $ref "${node.$ref}" does not resolve`);
    }
    for (const [key, value] of Object.entries(node)) {
      walk(value, `${at}/${key}`);
    }
  }

  walk(doc, "#");

  if (typeof doc.openapi !== "string" || !doc.openapi.startsWith("3.")) {
    errors.push(`root: "openapi" must be a 3.x version string, got ${JSON.stringify(doc.openapi)}`);
  }
  const info = isObject(doc.info) ? doc.info : {};
  if (!info.title || !info.version) errors.push("root: info.title and info.version are required");
  const paths = isObject(doc.paths) ? doc.paths : {};
  if (Object.keys(paths).length === 0) errors.push("root: paths must be non-empty");

  for (const [pathKey, rawPathItem] of Object.entries(paths)) {
    if (!isObject(rawPathItem)) continue;
    const pathItem = rawPathItem;
    const declaredMethods = Object.keys(pathItem).filter((key) => HTTP_METHODS.has(key));
    if (declaredMethods.length === 0) errors.push(`paths${pathKey}: no HTTP methods declared`);

    for (const method of declaredMethods) {
      const op = pathItem[method];
      if (!isObject(op)) continue;
      const opPath = `paths${pathKey}.${method}`;

      if (!op.operationId) errors.push(`${opPath}: missing operationId`);
      const responses = isObject(op.responses) ? op.responses : {};
      if (Object.keys(responses).length === 0) {
        errors.push(`${opPath}: no responses declared`);
        continue;
      }
      for (const [status, rawResponse] of Object.entries(responses)) {
        if (!/^[1-5]\d\d$/.test(status)) errors.push(`${opPath}.responses: "${status}" is not a valid HTTP status code`);
        if (isObject(rawResponse) && !rawResponse.description) errors.push(`${opPath}.responses.${status}: missing description`);
      }
      const parameters = Array.isArray(op.parameters) ? op.parameters : [];
      for (const rawParam of parameters) {
        const resolved = isObject(rawParam) && typeof rawParam.$ref === "string" ? resolveRef(rawParam.$ref) : rawParam;
        if (!isObject(resolved) || !resolved.name) errors.push(`${opPath}.parameters: a parameter is missing "name"`);
      }
    }

    // Path template params ({slug}, {configurationId}, ...) must each have a matching `in: path` parameter.
    const templateParams = [...pathKey.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    for (const templateParam of templateParams) {
      const declaredAcrossMethods = declaredMethods.some((method) => {
        const op = pathItem[method];
        const rawParams = isObject(op) && Array.isArray(op.parameters) ? op.parameters : [];
        return rawParams.some((rawParam) => {
          const resolved = isObject(rawParam) && typeof rawParam.$ref === "string" ? resolveRef(rawParam.$ref) : rawParam;
          return isObject(resolved) && resolved.in === "path" && resolved.name === templateParam;
        });
      });
      if (!declaredAcrossMethods) errors.push(`paths${pathKey}: template param "{${templateParam}}" has no matching path parameter`);
    }
  }

  return errors;
}

export function loadOpenApiDocument(filePath: string): JsonObject {
  return yaml.load(readFileSync(filePath, "utf8")) as JsonObject;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const openApiPath = path.resolve(import.meta.dirname, "../docs/openapi.yaml");
  const doc = loadOpenApiDocument(openApiPath);
  const errors = validateOpenApiDocument(doc);

  if (errors.length > 0) {
    console.error(`docs/openapi.yaml: ${errors.length} problem(s):\n`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  const schemas = isObject(doc.components) && isObject(doc.components.schemas) ? doc.components.schemas : {};
  console.log(`docs/openapi.yaml: OK (${Object.keys(doc.paths as JsonObject).length} paths, ${Object.keys(schemas).length} schemas, 0 problems).`);
}
