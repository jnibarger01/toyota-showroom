import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadOpenApiDocument, validateOpenApiDocument } from "../scripts/validate-openapi";

const OPENAPI_PATH = path.resolve(__dirname, "../docs/openapi.yaml");

describe("docs/openapi.yaml", () => {
  it("passes structural validation with no errors", () => {
    const doc = loadOpenApiDocument(OPENAPI_PATH);
    expect(validateOpenApiDocument(doc)).toEqual([]);
  });

  it("documents every real app/api/v1/** route this app actually has", () => {
    const doc = loadOpenApiDocument(OPENAPI_PATH);
    // Kept in sync by hand with app/api/v1/**/route.ts — there are only 7 route files, so an
    // automated directory walk would be more machinery than this needs; a new route file should
    // update both the real handler and this list in the same PR (docs/CONTRIBUTING.md's own
    // "update the doc in the same PR" rule).
    const expectedPaths = [
      "/health",
      "/vehicles",
      "/vehicles/{slug}",
      "/vehicles/{slug}/options",
      "/vehicles/{slug}/media",
      "/configurations",
      "/configurations/{configurationId}",
    ];
    expect(Object.keys(doc.paths as object).sort()).toEqual(expectedPaths.sort());
  });

  it("catches a broken $ref (deliberate-bug check against the validator itself)", () => {
    const doc = loadOpenApiDocument(OPENAPI_PATH);
    // Deliberately loosely typed: this constructs an intentionally-malformed document to prove
    // the validator itself flags it, not a document meant to satisfy any real OpenAPI shape.
    const broken = structuredClone(doc) as any;
    broken.paths["/health"].get.responses["200"].content["application/json"].schema.$ref = "#/components/schemas/DoesNotExist";
    const errors = validateOpenApiDocument(broken);
    expect(errors.some((e) => e.includes("DoesNotExist"))).toBe(true);
  });
});
