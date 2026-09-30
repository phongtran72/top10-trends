// One-line description of an error and its causes, for CLI output. Drizzle
// wraps database errors ("Failed query: …"), so the useful reason is often in
// `cause`. Postgres and network errors name the host or user, never the
// connection string's password.
export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth++) {
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      parts.push(typeof code === "string" ? `${current.message} [${code}]` : current.message);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(" <- caused by: ");
}
