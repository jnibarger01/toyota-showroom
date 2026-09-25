import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEMO_SW_API_MARKER,
  DEMO_SW_CACHE_PREFIX,
  DEMO_SW_CATALOG_MARKER,
  DEMO_SW_HERO_VEHICLE_SLUG,
  DEMO_SW_IMMUTABLE_PATHS,
  DEMO_SW_PRECACHE_URLS,
  DEMO_SW_REVALIDATE_PATHS,
  demoSwCacheName,
  selectDemoCacheStrategy,
} from "../lib/pwa/demoSwPolicy";
import { stampDemoSwSource } from "../lib/pwa/stampDemoSw";

const SW_PATH = path.resolve(__dirname, "../public/sw.js");
const swSource = readFileSync(SW_PATH, "utf8");

describe("selectDemoCacheStrategy", () => {
  it("bypasses configuration APIs (network-only — never cached by the demo worker)", () => {
    expect(selectDemoCacheStrategy("/api/v1/configurations")).toBe("bypass");
    expect(selectDemoCacheStrategy("/toyota-showroom/api/v1/health")).toBe("bypass");
  });

  it("uses network-first for the static catalog mirror", () => {
    expect(selectDemoCacheStrategy("/catalog/v1/vehicles.json")).toBe("network-first");
    expect(selectDemoCacheStrategy("/toyota-showroom/catalog/v1/vehicles/4runner.json")).toBe(
      "network-first",
    );
  });

  it("uses cache-first for content-hashed /assets/*", () => {
    expect(selectDemoCacheStrategy("/toyota-showroom/assets/BuilderApp-abc12345.js")).toBe(
      "cache-first",
    );
  });

  it("uses stale-while-revalidate for models, draco, renders, and images", () => {
    expect(selectDemoCacheStrategy("/models/modsnation_7416_assets_assembled.glb")).toBe(
      "stale-while-revalidate",
    );
    expect(selectDemoCacheStrategy("/draco/draco_decoder.wasm")).toBe("stale-while-revalidate");
    expect(selectDemoCacheStrategy("/hdri/cold_photography_studio_1k.hdr")).toBe("stale-while-revalidate");
    expect(selectDemoCacheStrategy("/renders/rav4-2024/rendered-rav4-viewport.png")).toBe(
      "stale-while-revalidate",
    );
    expect(selectDemoCacheStrategy("/images/modsnation_7416_final_hero_tweaked.png")).toBe(
      "stale-while-revalidate",
    );
  });

  it("bypasses navigations and unrelated paths", () => {
    expect(selectDemoCacheStrategy("/")).toBe("bypass");
    expect(selectDemoCacheStrategy("/4runner/")).toBe("bypass");
    expect(selectDemoCacheStrategy("/explore")).toBe("bypass");
  });
});

describe("demo SW version / cache naming", () => {
  it("prefixes cache names so activate can find orphans", () => {
    expect(demoSwCacheName("v-abc1234")).toBe(`${DEMO_SW_CACHE_PREFIX}v-abc1234`);
  });

  it("stamps CACHE_VERSION so deploys are not sticky-cached forever", () => {
    const stamped = stampDemoSwSource(swSource, "v-deadbee");
    expect(stamped).toContain('const CACHE_VERSION = "v-deadbee";');
    expect(stamped).not.toContain('const CACHE_VERSION = "dev";');
  });

  it("refuses to stamp a worker that lost its version declaration", () => {
    expect(() => stampDemoSwSource("/* empty */", "v-1")).toThrow(/CACHE_VERSION/);
  });
});

describe("public/sw.js stays in lockstep with demoSwPolicy", () => {
  it("targets the active hero vehicle", () => {
    expect(DEMO_SW_HERO_VEHICLE_SLUG).toBe("4runner");
    expect(swSource).toContain("./4runner/");
    expect(swSource).toContain("modsnation_7416_assets_assembled.glb");
  });

  it("embeds every precache URL from the policy module", () => {
    for (const url of DEMO_SW_PRECACHE_URLS) {
      expect(swSource, `missing precache URL ${url}`).toContain(`"${url}"`);
    }
  });

  it("embeds the same path prefixes the policy module exports", () => {
    for (const prefix of DEMO_SW_IMMUTABLE_PATHS) {
      expect(swSource).toContain(`"${prefix}"`);
    }
    for (const prefix of DEMO_SW_REVALIDATE_PATHS) {
      expect(swSource).toContain(`"${prefix}"`);
    }
    expect(swSource).toContain(`"${DEMO_SW_CATALOG_MARKER}"`);
    expect(swSource).toContain(DEMO_SW_API_MARKER);
    expect(swSource).toContain(DEMO_SW_CACHE_PREFIX);
  });

  it("precache on install and evicts non-current caches on activate", () => {
    expect(swSource).toContain("precacheCritical");
    expect(swSource).toContain("skipWaiting");
    expect(swSource).toContain("clients.claim");
    expect(swSource).toMatch(/name\.startsWith\("toyota-showroom-demo-"\)/);
  });

  it("documents itself as Pages-demo only (#49)", () => {
    expect(swSource).toMatch(/GitHub Pages demo/i);
    expect(swSource).toContain("#49");
  });
});
