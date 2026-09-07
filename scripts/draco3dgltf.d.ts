// `draco3dgltf` ships no types (scripts/optimize-models.mjs, a plain .mjs, has never needed any);
// scripts/asset-pipeline-report.ts is the first .ts file to import it, so it needs a declaration
// to typecheck under this repo's `**/*.ts` tsconfig include.
declare module "draco3dgltf";
