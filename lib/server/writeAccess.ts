import { unauthorized } from "../api/errors";
import { getWriteApiKey } from "./cloudflareEnv";

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
}

/**
 * Optional write gate. When WRITE_API_KEY is absent the public-demo behavior is unchanged. When it
 * is configured, every POST/PATCH/DELETE must send the same value in `X-API-Key`.
 */
export async function requireWriteAccess(request: Request): Promise<void> {
  const expected = await getWriteApiKey();
  if (!expected) return;

  const supplied = request.headers.get("x-api-key") ?? "";
  if (!constantTimeEqual(supplied, expected)) throw unauthorized();
}
