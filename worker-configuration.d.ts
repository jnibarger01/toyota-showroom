/// <reference types="@cloudflare/workers-types" />

/** Bindings supplied by Wrangler in the Cloudflare Worker runtime. */
interface Env {
  DB?: D1Database;
  WRITE_API_KEY?: string;
}
