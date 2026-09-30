import { describe, expect, it } from "vitest";
import { createHttp, HttpError, parseXml, shortReason } from "./http";

type Handler = (url: string, init: RequestInit) => Promise<Response> | Response;

function fakeFetch(...handlers: Handler[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const handler = handlers[Math.min(calls.length - 1, handlers.length - 1)];
    return handler(url, init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const noDelay = () => 0;

describe("createHttp", () => {
  it("sends the user agent and custom headers and parses JSON", async () => {
    const { fetchImpl, calls } = fakeFetch(() => Response.json({ ok: 1 }));
    const http = createHttp({ fetch: fetchImpl, userAgent: "ua/1", retryDelayMs: noDelay });
    await expect(http.getJson("https://api.example.com/x", { headers: { "X-Key": "k" } })).resolves.toEqual({ ok: 1 });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("ua/1");
    expect(headers["X-Key"]).toBe("k");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries once on 5xx and 429, then succeeds", async () => {
    for (const status of [503, 429]) {
      const { fetchImpl, calls } = fakeFetch(
        () => new Response("busy", { status }),
        () => Response.json([1, 2]),
      );
      const http = createHttp({ fetch: fetchImpl, retryDelayMs: noDelay });
      await expect(http.getJson("https://api.example.com/x")).resolves.toEqual([1, 2]);
      expect(calls).toHaveLength(2);
    }
  });

  it("does not retry a 404", async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response("nope", { status: 404, statusText: "Not Found" }));
    const http = createHttp({ fetch: fetchImpl, retryDelayMs: noDelay });
    await expect(http.getJson("https://api.example.com/x")).rejects.toThrow("404 api.example.com: Not Found");
    expect(calls).toHaveLength(1);
  });

  it("gives up after one retry and never puts the URL or its query in the error", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      Response.json({ error: { message: "API key not valid, see https://example.com/help?key=secret" } }, { status: 500 }),
    );
    const http = createHttp({ fetch: fetchImpl, retryDelayMs: noDelay });
    const error = await http.getJson("https://api.example.com/v3/videos?key=secret123").catch((e: unknown) => e);
    expect(calls).toHaveLength(2);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).message).toBe("500 api.example.com: API key not valid, see [url]");
    expect((error as HttpError).message).not.toContain("secret");
  });

  it("retries a network error and reports it without the URL", async () => {
    const { fetchImpl, calls } = fakeFetch(() => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("x"), { code: "ECONNRESET" }) });
    });
    const http = createHttp({ fetch: fetchImpl, retryDelayMs: noDelay });
    await expect(http.getJson("https://api.example.com/x?token=abc")).rejects.toThrow("network api.example.com: ECONNRESET");
    expect(calls).toHaveLength(2);
  });

  it("times out a slow request", async () => {
    const { fetchImpl } = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const http = createHttp({ fetch: fetchImpl, timeoutMs: 20, retryDelayMs: noDelay });
    await expect(http.getJson("https://slow.example.com/")).rejects.toThrow("network slow.example.com: timeout after 0.02s");
  });

  it("rejects invalid JSON with a short reason", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("<html>"));
    const http = createHttp({ fetch: fetchImpl, retryDelayMs: noDelay });
    await expect(http.getJson("https://api.example.com/x")).rejects.toThrow("200 api.example.com: response is not valid JSON");
  });

  it("posts a form and parses the JSON reply", async () => {
    const { fetchImpl, calls } = fakeFetch(() => Response.json({ access_token: "t" }));
    const http = createHttp({ fetch: fetchImpl, retryDelayMs: noDelay });
    await expect(http.postFormJson("https://id.example.com/token", { a: "1", b: "x y" })).resolves.toEqual({
      access_token: "t",
    });
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe("a=1&b=x+y");
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });
});

describe("parseXml", () => {
  it("keeps namespaced tags, decodes entities and always returns item lists", () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>Tom &amp; Jerry&#39;s</title><ht:approx_traffic>2000+</ht:approx_traffic><ht:news_item><ht:news_item_title>Headline</ht:news_item_title></ht:news_item></item></channel></rss>`;
    const parsed = parseXml(xml) as { rss: { channel: { item: Record<string, unknown>[] } } };
    const [item] = parsed.rss.channel.item;
    expect(item.title).toBe("Tom & Jerry's");
    expect(item["ht:approx_traffic"]).toBe("2000+");
    expect(item["ht:news_item"]).toEqual([{ "ht:news_item_title": "Headline" }]);
  });
});

describe("shortReason", () => {
  it("strips URLs and caps the length", () => {
    expect(shortReason("bad https://x.test/a?key=1 thing")).toBe("bad [url] thing");
    expect(shortReason("x".repeat(200))).toHaveLength(120);
  });
});
