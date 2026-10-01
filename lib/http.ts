import { XMLParser } from "fast-xml-parser";

// HTTP client for collectors (CLAUDE.md invariant 2 and 12): every request has
// a 10-second timeout and one retry with jitter on network errors, 429 and
// 5xx. Errors carry only the status code, host and a short reason, never the
// URL, whose query could hold a key.

export interface RequestOptions {
  headers?: Record<string, string>;
}

export interface Http {
  getJson(url: string, options?: RequestOptions): Promise<unknown>;
  getXml(url: string, options?: RequestOptions): Promise<unknown>;
  postFormJson(url: string, form: Record<string, string>, options?: RequestOptions): Promise<unknown>;
}

export class HttpError extends Error {
  override name = "HttpError";
  constructor(
    readonly status: number | null,
    readonly host: string,
    readonly reason: string,
  ) {
    super(`${status ?? "network"} ${host}: ${reason}`);
  }
}

export interface HttpConfig {
  userAgent?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  // Delay before the single retry; 250–750 ms of jitter by default.
  retryDelayMs?: () => number;
}

const DEFAULT_USER_AGENT = "top10-trends/0.1";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

// Short, key-free reason: no URLs, at most 120 characters.
export function shortReason(text: string): string {
  const cleaned = text
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
}

function networkReason(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return `timeout after ${timeoutMs / 1000}s`;
    const code = (error.cause as { code?: unknown } | undefined)?.code;
    if (typeof code === "string") return code;
    return shortReason(error.message) || "network error";
  }
  return "network error";
}

async function errorReason(response: Response): Promise<string> {
  let detail = "";
  try {
    const text = await response.text();
    const json = JSON.parse(text) as { message?: unknown; error?: unknown };
    const message =
      typeof json.message === "string"
        ? json.message
        : typeof json.error === "string"
          ? json.error
          : typeof (json.error as { message?: unknown } | undefined)?.message === "string"
            ? (json.error as { message: string }).message
            : "";
    detail = message;
  } catch {
    // Not JSON; the status text is enough.
  }
  return shortReason(detail || response.statusText || "request failed");
}

const retryable = (status: number) => status === 429 || status >= 500;

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  htmlEntities: true,
  trimValues: true,
  // RSS items, Atom entries and Google Trends news items are lists even when there is one.
  isArray: (name) => name === "item" || name === "entry" || name === "ht:news_item",
});

export function parseXml(text: string): unknown {
  return xmlParser.parse(text);
}

export function createHttp(config: HttpConfig = {}): Http {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? 10_000;
  const retryDelayMs = config.retryDelayMs ?? (() => 250 + Math.random() * 500);
  const userAgent = config.userAgent || DEFAULT_USER_AGENT;

  async function request(
    method: "GET" | "POST",
    url: string,
    accept: string,
    options: RequestOptions & { body?: string; contentType?: string } = {},
  ): Promise<string> {
    const host = hostOf(url);
    const headers: Record<string, string> = { "User-Agent": userAgent, Accept: accept, ...options.headers };
    if (options.contentType) headers["Content-Type"] = options.contentType;

    for (let attempt = 1; ; attempt++) {
      const last = attempt === 2;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method,
          headers,
          body: options.body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (!last) {
          await sleep(retryDelayMs());
          continue;
        }
        throw new HttpError(null, host, networkReason(error, timeoutMs));
      }
      if (response.ok) {
        try {
          return await response.text();
        } catch (error) {
          throw new HttpError(response.status, host, networkReason(error, timeoutMs));
        }
      }
      if (!last && retryable(response.status)) {
        await response.body?.cancel().catch(() => {});
        await sleep(retryDelayMs());
        continue;
      }
      throw new HttpError(response.status, host, await errorReason(response));
    }
  }

  async function json(url: string, text: string): Promise<unknown> {
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(200, hostOf(url), "response is not valid JSON");
    }
  }

  return {
    async getJson(url, options) {
      return json(url, await request("GET", url, "application/json", options));
    },
    async getXml(url, options) {
      const text = await request("GET", url, "application/rss+xml, application/atom+xml, application/xml, text/xml", options);
      try {
        return parseXml(text);
      } catch {
        throw new HttpError(200, hostOf(url), "response is not valid XML");
      }
    },
    async postFormJson(url, form, options) {
      const body = new URLSearchParams(form).toString();
      return json(
        url,
        await request("POST", url, "application/json", {
          ...options,
          body,
          contentType: "application/x-www-form-urlencoded",
        }),
      );
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
