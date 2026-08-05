/**
 * Stable-id generation shared by every `ConfigurationRepository` implementation (in-memory today,
 * D1 once bound), so ids look identical regardless of which one is active.
 */
export function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${random.replace(/-/g, "").slice(0, 20)}`;
}
