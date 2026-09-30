import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHttp } from "@/lib/http";
import type { CollectorContext, Env } from "./types";

// Test helpers: fixtures from __fixtures__/ and an Http whose fetch answers
// from a list of URL-prefix routes. Tests never touch the network.

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");
}

export function jsonFixture<T = unknown>(name: string): T {
  return JSON.parse(fixture(name)) as T;
}

export type Route = [prefix: string, respond: (url: string, init: RequestInit) => Response];

export function routedContext(routes: Route[], env: Env = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes.find(([prefix]) => url.startsWith(prefix));
    return route ? route[1](url, init) : new Response("no route", { status: 404, statusText: "Not Found" });
  }) as typeof fetch;
  const ctx: CollectorContext = {
    http: createHttp({ fetch: fetchImpl, retryDelayMs: () => 0 }),
    env,
    now: new Date("2026-09-30T12:07:00Z"),
  };
  return { ctx, calls };
}
