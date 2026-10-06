import { describe, expect, it } from "vitest";
import {
  addUserAgentToMp3Urls,
  classifyUserAgent,
  stripVideoEnclosures,
  transformRss,
} from "../src/transform";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:ab="https://audioboom.com/xmlns/rss" version="2.0">
  <channel>
    <item>
      <enclosure url="https://pdst.fm/e/audioboom.com/posts/1.mp3?source=rss&amp;sid=1" length="0" type="audio/mpeg" />
      <podcast:alternateEnclosure type="application/vnd.apple.mpegurl" ab:strip="true">
        <podcast:source uri="https://audioboom.com/posts/1/video.m3u8?source=rss" />
      </podcast:alternateEnclosure>
      <podcast:alternateEnclosure type="application/vnd.apple.mpegurl">
        <podcast:source uri="https://audioboom.com/posts/1/public-video.m3u8" />
      </podcast:alternateEnclosure>
    </item>
  </channel>
</rss>`;

describe("RSS transformation", () => {
  it("uses a stable label for known user agents", () => {
    expect(classifyUserAgent("Amazon Music Podcast")).toBe("Amazon Music");
    expect(classifyUserAgent("AmazonMusic/26.35.0 Dalvik/2.1.0 (Linux; U; Android 16; SM-S936U Build/BP4A.251205.006)")).toBe("Amazon Music");
    expect(classifyUserAgent("AmazonMusic/26.35.1")).toBe("Amazon Music");
    expect(classifyUserAgent("AppleCoreMedia/1.0")).toBe("Apple Podcasts");
  });

  it("does not treat embedded or case-altered Amazon tokens as allowlisted", () => {
    expect(classifyUserAgent("Fake AmazonMusic/26.35.1")).toBe("Fake AmazonMusic/26.35.1");
    expect(classifyUserAgent("amazonmusic/26.35.1")).toBe("amazonmusic/26.35.1");
    expect(classifyUserAgent("Amazon Music Podcast impersonator")).toBe("Amazon Music Podcast impersonator");
  });

  it("bounds unknown user-agent labels", () => {
    expect(classifyUserAgent("x".repeat(100))).toHaveLength(80);
  });

  it("adds an XML-safe query parameter to MP3 enclosure URLs", () => {
    const result = addUserAgentToMp3Urls(RSS, "Apple Podcasts");
    expect(result).toContain("&amp;rss_ua=Apple+Podcasts");
  });

  it("does not add a duplicate parameter", () => {
    const once = addUserAgentToMp3Urls(RSS, "Apple Podcasts");
    const twice = addUserAgentToMp3Urls(once, "Apple Podcasts");
    expect(twice.match(/rss_ua=/g)).toHaveLength(1);
  });

  it("does not transform enclosure examples in CDATA or comments", () => {
    const protectedXml = `<![CDATA[<enclosure url="https://example.com/example.mp3" type="audio/mpeg" />]]><!-- <enclosure url="https://example.com/comment.mp3" type="audio/mpeg" /> -->`;
    expect(addUserAgentToMp3Urls(protectedXml, "Apple Podcasts")).toBe(protectedXml);
  });

  it("retains all video for Amazon Music clients", () => {
    const result = transformRss(RSS, "AmazonMusic/26.35.1", "marked-only");
    expect(result).toContain("video.m3u8");
    expect(result).toContain("public-video.m3u8");
  });

  it("strips only marked video for other clients", () => {
    const result = stripVideoEnclosures(RSS, false, "marked-only");
    expect(result).not.toContain("video.m3u8?source=rss");
    expect(result).toContain("public-video.m3u8");
  });

  it("can strip every alternate enclosure during the initial trial", () => {
    const result = stripVideoEnclosures(RSS, false, "all");
    expect(result).not.toContain("podcast:alternateEnclosure");
  });
});
