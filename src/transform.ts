export type VideoPolicy = "all" | "marked-only";

const USER_AGENT_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:Amazon Music Podcast$|AmazonMusic\/)/, "Amazon Music"],
  [/AppleCoreMedia|Apple Podcasts|Podcasts\//i, "Apple Podcasts"],
  [/Spotify/i, "Spotify"],
  [/Overcast/i, "Overcast"],
  [/Pocket Casts|PocketCasts/i, "Pocket Casts"],
];

export function classifyUserAgent(userAgent: string | null): string {
  const normalized = (userAgent ?? "unknown").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

  for (const [pattern, label] of USER_AGENT_LABELS) {
    if (pattern.test(normalized)) return label;
  }

  return Array.from(normalized || "unknown").slice(0, 80).join("");
}

export function isAmazonMusicUserAgent(userAgent: string | null): boolean {
  return /^(?:Amazon Music Podcast$|AmazonMusic\/)/.test(userAgent ?? "");
}

export function transformRss(
  xml: string,
  userAgent: string | null,
  videoPolicy: VideoPolicy,
): string {
  const labeled = addUserAgentToMp3Urls(xml, classifyUserAgent(userAgent));
  return stripVideoEnclosures(labeled, isAmazonMusicUserAgent(userAgent), videoPolicy);
}

export function addUserAgentToMp3Urls(xml: string, userAgentLabel: string): string {
  return transformOutsideProtectedXml(xml, (fragment) =>
    fragment.replace(/<enclosure\b[^>]*>/gi, (tag) => {
      if (!/\btype\s*=\s*(?:"audio\/mpeg"|'audio\/mpeg')/i.test(tag)) return tag;

      return tag.replace(/(\burl\s*=\s*)(["'])(.*?)\2/i, (attribute, prefix: string, quote: string, url: string) => {
        if (/(?:\?|&amp;|&)rss_ua=/i.test(url)) return attribute;

        const separator = url.includes("?") ? "&amp;" : "?";
        return `${prefix}${quote}${url}${separator}rss_ua=${encodeQueryValue(userAgentLabel)}${quote}`;
      });
    }),
  );
}

export function stripVideoEnclosures(
  xml: string,
  allowVideo: boolean,
  policy: VideoPolicy,
): string {
  if (allowVideo) return xml;

  return transformOutsideProtectedXml(
    xml,
    (fragment) => fragment.replace(
      /<podcast:alternateEnclosure\b[\s\S]*?<\/podcast:alternateEnclosure\s*>/gi,
      (element) => {
        const openingTag = element.match(/^<podcast:alternateEnclosure\b[^>]*>/i)?.[0] ?? "";
        const isMarked = /\bab:strip\s*=\s*(?:"true"|'true')/i.test(openingTag);
        return policy === "all" || isMarked ? "" : element;
      },
    ),
  );
}

function transformOutsideProtectedXml(xml: string, transform: (fragment: string) => string): string {
  return xml
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->)/g)
    .map((fragment) => /^(?:<!\[CDATA\[|<!--)/.test(fragment) ? fragment : transform(fragment))
    .join("");
}

function encodeQueryValue(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}
