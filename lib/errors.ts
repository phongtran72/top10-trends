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

// A safe outline of a Postgres connection string for failure messages: user,
// host, port, database and warnings about the password's shape. Never the
// password itself.
export function describeDatabaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "not a valid URL";
  }
  let password: string | undefined;
  try {
    password = decodeURIComponent(parsed.password);
  } catch {
    password = undefined;
  }
  const warnings: string[] = [];
  if (password === undefined) warnings.push("password has a % that is not a valid escape; write each literal % as %25");
  else if (!password) warnings.push("no password");
  else if (/YOUR-PASSWORD/i.test(password)) warnings.push("password is still the [YOUR-PASSWORD] placeholder");
  else if (/[[\]]/.test(password)) warnings.push("password contains [ or ]; remove the brackets");
  else if (/\s/.test(password)) warnings.push("password contains spaces");
  else if (!/^[A-Za-z0-9]+$/.test(password)) warnings.push("password has characters other than letters and digits");
  const database = parsed.pathname.replace(/^\//, "") || "(none; add /postgres)";
  const fields = [
    `user=${decodeURIComponent(parsed.username) || "(none)"}`,
    `host=${parsed.hostname}`,
    `port=${parsed.port || "(default)"}`,
    `database=${database}`,
    warnings.length > 0 ? `warning: ${warnings.join("; ")}` : "password looks well formed",
  ];
  return fields.join(" ");
}
