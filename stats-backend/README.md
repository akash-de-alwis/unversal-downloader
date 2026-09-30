# Universal Downloader — stats backend

A small Cloudflare Worker that collects anonymous usage stats for the app, stored in Cloudflare KV.

| Endpoint | Body | Does |
|---|---|---|
| `POST /ping` | `{ "deviceId": "<anonymous id>" }` | Marks the device as seen now |
| `POST /download-complete` | none | Adds 1 to the global download counter |
| `GET /stats` | none | Returns the counts below |

```json
{
  "totalDownloads": 1284,
  "activeUsers": { "last5Minutes": 7, "last24Hours": 112 },
  "generatedAt": "2026-09-30T05:19:13.695Z"
}
```

- `deviceId` must be 8–64 characters of letters, digits, `-` or `_`. A random UUID generated once per install is the intended value; never send anything that identifies the person. The `/ping` body can be at most 1 KB; anything larger gets a 413.
- `last5Minutes` counts devices that pinged in the last 5 minutes (the "using it right now" number). `last24Hours` counts devices that pinged in the last day.
- `/stats` is cached at Cloudflare's edge for 60 seconds, so numbers can lag by up to a minute.
- All endpoints send `Access-Control-Allow-Origin: *`, so they can be called from the renderer or the main process.

## Deploy

You need a free Cloudflare account. Run everything from this folder.

1. **Install dependencies**

   ```sh
   cd stats-backend
   npm install
   ```

2. **Log in to Cloudflare** (opens your browser once)

   ```sh
   npx wrangler login
   ```

3. **Create the KV namespace**

   ```sh
   npx wrangler kv namespace create STATS
   ```

   It prints a block containing `id = "..."`. Copy that id into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

4. **Deploy**

   ```sh
   npx wrangler deploy
   ```

   It prints the Worker's URL, like `https://universal-downloader-stats.<your-subdomain>.workers.dev`. That's the base URL the app will call.

5. **Check it**

   ```sh
   curl https://universal-downloader-stats.<your-subdomain>.workers.dev/stats
   ```

   A fresh deploy returns `{"totalDownloads":0,"activeUsers":{"last5Minutes":0,"last24Hours":0},...}`.

To publish a change later, just run `npx wrangler deploy` again.

Logs and traces are switched on in `wrangler.toml`: the Worker's own error logs are kept and 1 in 10 requests is traced. Per-request invocation logs are off, because they record request metadata such as headers and location, and the app tells users no personal data is kept. View them in the Cloudflare dashboard under **Workers & Pages → universal-downloader-stats → Observability**, or stream them live with `npx wrangler tail`. Errors are logged as JSON (`{"message":"request failed","route":...,"error":...}`), so you can search for them.

If you add or rename a binding in `wrangler.toml`, run `npm run cf-typegen` to regenerate `worker-configuration.d.ts`, which holds the `Env` type the code uses.

### Try it locally first (no login needed)

```sh
npm run dev
```

This serves the Worker at `http://127.0.0.1:8787` with a local, simulated KV store, so it works before step 3.

## How the app should call it

- **Ping** when the app starts, then **every 4 minutes** while it's open. A shorter interval than the 5-minute window keeps an open app counted as active.
- **Download complete**: one `POST /download-complete` each time a download finishes successfully.
- **Stats**: fetch `/stats` only when you're about to show the numbers, not on a timer.

Send pings and download events fire-and-forget: if the request fails, ignore it and never let it block or slow down a download.

## Limits to know about

**Cloudflare's free plan will run out quickly once real people use the app.** Every ping and every finished download is one KV write, and the free plan allows **1,000 KV writes per day**. With a ping every 4 minutes, one open app uses 15 writes an hour, so the free plan covers roughly 60 hours of total app use per day across all users.

The free plan also allows 1,000 KV list operations per day. Each `/stats` that isn't served from the 60-second cache costs at least one.

When the limit is hit, writes fail for the rest of the day and the numbers stop updating (the app is unaffected if it sends fire-and-forget). For real use, the **Workers Paid plan ($5/month)** includes 1 million KV writes and 1 million list operations a month, which is plenty here. Check [Cloudflare's KV pricing page](https://developers.cloudflare.com/kv/platform/pricing/) for current numbers.

**The download counter is approximate.** KV has no atomic increment, so two downloads finishing at the same moment can both read the same total and one increment is lost. KV also only allows about one write per second to the same key. For a public "downloads so far" figure that's fine. If you ever need an exact count, move the counter to a Durable Object.

**Anyone can call these endpoints.** The Worker's URL ships inside the app, so someone could inflate the counters with a script. A secret key embedded in the app wouldn't prevent this, since it can be extracted. Treat the numbers as indicative, not audited.

## How data is stored

- `device:<deviceId>`: empty value, with the last-seen time in the key's metadata. It expires automatically 25 hours after the device's last ping, so the store only ever holds recent devices and nothing about inactive installs is kept.
- `counter:downloads`: the total, as a number stored as text.

`/stats` counts devices from the key list alone (metadata comes back with the list), so it doesn't do one read per device.
