import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const ENV = {
  MAX_RSS_BYTES: "5242880",
  ORIGIN_HOSTNAME: "audioboom.com",
  VIDEO_POLICY: "all",
} as const satisfies CloudflareEnv;

const RSS = `<?xml version="1.0"?><rss><channel><item><enclosure url="https://example.com/1.mp3?source=rss" type="audio/mpeg" /></item></channel></rss>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Worker handler", () => {
  it("fetches a header-stable canonical URL and transforms the response", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response(RSS, {
      headers: { "content-type": "application/rss+xml", etag: "origin-etag" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(
      new Request("https://preview.example/channels/4943124.rss?cache_bust=1", {
        headers: { cookie: "session=private", "user-agent": "AppleCoreMedia/1.0" },
      }),
      ENV,
    );
    const originRequest = fetchMock.mock.calls[0][0];

    expect(originRequest.url).toBe("https://audioboom.com/channels/4943124.rss");
    expect(originRequest.headers.get("user-agent")).toBe("Audioboom-RSS-Worker/1.0");
    expect(originRequest.headers.has("cookie")).toBe(false);
    expect(await response.text()).toContain("rss_ua=Apple+Podcasts");
    expect(response.headers.has("etag")).toBe(false);
    expect(response.headers.get("vary")).toContain("User-Agent");
  });

  it("rewrites passthrough requests to the origin instead of recursing on staging", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response("origin"));
    vi.stubGlobal("fetch", fetchMock);

    await worker.fetch(new Request("https://preview.example/robots.txt"), ENV);

    expect(fetchMock.mock.calls[0][0].url).toBe("https://audioboom.com/robots.txt");
  });

  it("retries with original request headers when the canonical fetch fails", async () => {
    const fetchMock = vi.fn(async (_request: Request): Promise<Response> => new Response())
      .mockRejectedValueOnce(new Error("canonical fetch failed"))
      .mockResolvedValueOnce(new Response(RSS, { headers: { "content-type": "application/rss+xml" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(
      new Request("https://preview.example/channels/4943124.rss", {
        headers: { "user-agent": "AppleCoreMedia/1.0" },
      }),
      ENV,
    );
    const fallbackRequest = fetchMock.mock.calls[1][0];

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fallbackRequest.url).toBe("https://audioboom.com/channels/4943124.rss");
    expect(fallbackRequest.headers.get("user-agent")).toBe("AppleCoreMedia/1.0");
    expect(await response.text()).not.toContain("rss_ua=");
  });

  it("returns an oversized origin response without transforming it", async () => {
    const fetchMock = vi.fn(async (_request: Request) => new Response(RSS, {
      headers: {
        "content-length": "999",
        "content-type": "application/rss+xml",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(
      new Request("https://preview.example/channels/4943124.rss", {
        headers: { "user-agent": "AppleCoreMedia/1.0" },
      }),
      { ...ENV, MAX_RSS_BYTES: "100" } as unknown as CloudflareEnv,
    );

    expect(await response.text()).not.toContain("rss_ua=");
  });

  it("returns an oversized chunked response without waiting for clone cancellation", async () => {
    const oversizedRss = `<rss>${"x".repeat(200)}</rss>`;
    const fetchMock = vi.fn(async (_request: Request) => new Response(oversizedRss, {
      headers: { "content-type": "application/rss+xml" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(
      new Request("https://preview.example/channels/4943124.rss", {
        headers: { "user-agent": "AppleCoreMedia/1.0" },
      }),
      { ...ENV, MAX_RSS_BYTES: "100" } as unknown as CloudflareEnv,
    );

    expect(await response.text()).toBe(oversizedRss);
  });
});
