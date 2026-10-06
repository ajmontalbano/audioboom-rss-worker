import { transformRss, type VideoPolicy } from "./transform";

const RSS_PATH = /^\/channels\/\d+\.rss$/;
const DEFAULT_MAX_RSS_BYTES = 5 * 1024 * 1024;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const originUrl = new URL(request.url);
    originUrl.protocol = "https:";
    originUrl.hostname = env.ORIGIN_HOSTNAME;
    originUrl.port = "";

    if (request.method !== "GET" || !RSS_PATH.test(url.pathname)) {
      return fetch(new Request(originUrl, request));
    }

    originUrl.search = "";
    const canonicalRequest = new Request(originUrl, {
      headers: {
        accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
        "user-agent": "Audioboom-RSS-Worker/1.0",
      },
      method: "GET",
      redirect: "follow",
    });
    let originResponse: Response;
    try {
      originResponse = await fetch(canonicalRequest);
    } catch (error) {
      console.error(JSON.stringify({
        message: "Canonical RSS fetch failed; retrying without request sanitization",
        error: error instanceof Error ? error.message : String(error),
        path: url.pathname,
      }));
      return fetch(new Request(originUrl, request));
    }
    if (!originResponse.ok || !isXml(originResponse.headers.get("content-type"))) {
      return originResponse;
    }

    const maxBytes = parsePositiveInteger(env.MAX_RSS_BYTES, DEFAULT_MAX_RSS_BYTES);
    const declaredLength = Number(originResponse.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return originResponse;
    }

    try {
      const xml = await readBoundedText(originResponse.clone(), maxBytes);
      if (xml === null) return originResponse;

      const transformed = transformRss(
        xml,
        request.headers.get("user-agent"),
        parseVideoPolicy(env.VIDEO_POLICY),
      );
      const headers = new Headers(originResponse.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      headers.delete("content-md5");
      headers.delete("etag");
      appendVary(headers, "User-Agent");

      return new Response(transformed, {
        status: originResponse.status,
        statusText: originResponse.statusText,
        headers,
      });
    } catch (error) {
      console.error(JSON.stringify({
        message: "RSS transformation failed; returning the origin response",
        error: error instanceof Error ? error.message : String(error),
        path: url.pathname,
      }));
      return originResponse;
    }
  },
} satisfies ExportedHandler<CloudflareEnv>;

function isXml(contentType: string | null): boolean {
  return /(?:application|text)\/(?:rss\+xml|xml)/i.test(contentType ?? "");
}

function parseVideoPolicy(value: string | undefined): VideoPolicy {
  return value === "all" ? "all" : "marked-only";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      void reader.cancel("RSS response exceeded MAX_RSS_BYTES");
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function appendVary(headers: Headers, value: string): void {
  const existing = headers.get("vary");
  if (!existing) {
    headers.set("vary", value);
    return;
  }

  const values = existing.split(",").map((item) => item.trim().toLowerCase());
  if (!values.includes(value.toLowerCase())) headers.set("vary", `${existing}, ${value}`);
}
