# Audioboom RSS Worker

Reference Worker for two RSS delivery use cases:

1. Add a bounded `rss_ua` query parameter to MP3 enclosure URLs without varying the cached origin RSS document by user agent.
2. Remove selected `podcast:alternateEnclosure` video elements for clients outside the Amazon Music user-agent allowlist.

The Worker runs only on `/channels/{id}.rss`. Other requests pass through unchanged.

## Behavior

Known user agents receive stable labels such as `Amazon Music` and `Apple Podcasts`. Unknown values are normalized and limited to 80 characters before URL encoding.

The initial production configuration uses `VIDEO_POLICY=all` because the current Rails feed does not yet emit a marker. After Rails adds the marker, change production to `VIDEO_POLICY=marked-only`. In that mode, non-Amazon clients lose only video elements carrying `ab:strip="true"`:

```xml
<rss
  xmlns:podcast="https://podcastindex.org/namespace/1.0"
  xmlns:ab="https://audioboom.com/xmlns/rss"
  version="2.0"
>
  <podcast:alternateEnclosure
    type="application/vnd.apple.mpegurl"
    ab:strip="true"
  >
    <podcast:source uri="https://audioboom.com/posts/1/video.m3u8" />
  </podcast:alternateEnclosure>
</rss>
```

The custom `ab` namespace must be declared on the RSS root. Omit `ab:strip` for video intended for every client.

Staging also uses `VIDEO_POLICY=all` so the existing test feed can be exercised before Rails emits the marker.

User-agent matching is presentation logic, not access control. Any client can spoof an Amazon Music user agent. Keep authorization in the signed HLS URL or origin if the video must be private.

## Local setup

```sh
npm install
npm run check
npm run dev
```

Test the staging Worker with Amazon and non-Amazon user agents:

```sh
curl -H 'User-Agent: AmazonMusic/26.35.1' \
  'http://localhost:8787/channels/4943124.rss'

curl -H 'User-Agent: AppleCoreMedia/1.0' \
  'http://localhost:8787/channels/4943124.rss'
```

## Deployment

Authenticate Wrangler, deploy staging, inspect the generated `workers.dev` URL, and then deploy production after validation:

```sh
npx wrangler login
npm run deploy:staging
npm run deploy:production
```

The production route is `audioboom.com/channels/*`; code limits transformation to numeric `.rss` paths. Review that route before deployment if Audioboom uses additional channel URL shapes.

## Cache behavior

The Worker rewrites the request host to `ORIGIN_HOSTNAME` and fetches the canonical feed with a fixed internal user agent before transforming the response. It does not forward client cookies or authorization. This prevents the staging `workers.dev` deployment from recursively requesting itself and prevents request headers from fragmenting or changing the origin feed. In production, Cloudflare's existing RSS cache policy continues to cache the canonical origin response by URL. User-agent-specific changes happen after that fetch and are not written back into the edge cache.

The response includes `Vary: User-Agent` for downstream HTTP caches. The Worker removes entity validators and length/encoding headers that no longer describe the transformed body.

RSS is intentionally buffered because XML elements may cross stream chunks. The implementation enforces a 5 MiB maximum and returns the untouched origin response if that bound is exceeded or transformation fails.

## Rough cost model

On Workers Standard, the account minimum is $5/month and includes 10 million requests plus 30 million CPU milliseconds each month. Additional usage is $0.30 per million requests and $0.02 per million CPU milliseconds. Origin subrequests and data transfer do not add request or egress charges. Enterprise accounts use their contracted rates.

For example, 15 million monthly RSS requests averaging 2 ms of CPU would be about $6.50/month on Standard: the $5 minimum plus $1.50 for requests, with CPU still inside the included allocation. Measure actual CPU after staging because feed size and item count affect transformation cost.

## Before production

- Confirm `rss_ua` survives the `pdst.fm` and Podtrac redirect chain to the intended analytics endpoint.
- Decide whether unknown user agents should carry a truncated raw value or a lower-cardinality label such as `Other`.
- Confirm the Amazon Music allowlist against production request samples.
- Confirm the origin does not generate user-agent-specific RSS before the Worker runs.
- Add more feed fixtures for CDATA, attribute ordering, and any alternate enclosure variants emitted by Rails.
- Set up a Cloudflare API token in CI only when Audioboom is ready to automate deployment. Do not commit it.

Current pricing: https://developers.cloudflare.com/workers/platform/pricing/
