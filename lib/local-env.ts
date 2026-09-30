import { existsSync } from "node:fs";

// Loads .env.local for local runs of the CLI scripts. In GitHub Actions the
// variables come from the workflow and there is no file.
export function loadLocalEnv(): void {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
}
