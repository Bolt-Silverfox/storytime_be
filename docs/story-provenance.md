# Story provenance and source cache

Foundation for importing openly-licensed stories with correct credit, and for
fetching each source only once. This document covers the schema and rules only.
There is no importer, submission flow or payment code yet.

Items marked **(unverified)** are the engineering team's reading of the licences
and have not been confirmed by a lawyer or by the rights holder. Confirm them
before the first public import.

## Story fields (all nullable)

| Field | Meaning | Exposed to clients |
| --- | --- | --- |
| `sourceName` | `gutenberg`, `bookdash`, `storyweaver`, `africanstorybook`, `community` | yes |
| `sourceUrl` | page the story came from | yes |
| `licenseCode` | `PD-US`, `CC0`, `CC-BY-4.0`, `STORYTIME_SUBMISSION_V1` | yes |
| `licenseUrl` | link to the licence text | yes |
| `authorName` | primary author | yes |
| `attributionText` | the exact credit string to display | yes |
| `sourceId` | id at the source | no (internal) |
| `contentHash` | sha256 of the normalised text, for dedupe | no (internal) |
| `adaptationNotes` | what Storytime changed | admin story detail only |
| `importedAt` | when imported | admin story detail only |

Every existing and AI-generated story has all of these as `NULL`. `isPublished`
is unchanged (default `true`); an importer must set `isPublished: false` and
publishing stays a manual admin action.

Uniqueness: `@@unique([sourceName, sourceId])`. Postgres treats NULLs as
distinct, so stories with no source never collide. A partial unique index was
not used because Prisma cannot express it and `prisma migrate diff` would then
report drift. `contentHash` has a plain index.

### How internal fields stay hidden

`PrismaService` sets a Prisma global `omit` for `Story`
(`STORY_INTERNAL_FIELDS_OMIT`), so every read, including nested includes and
the feed/library endpoints that return raw rows, leaves out `sourceId`,
`contentHash`, `adaptationNotes` and `importedAt`. A query opts in explicitly
(`omit: { adaptationNotes: false }`); the admin story detail does this for
`adaptationNotes` and `importedAt`. Importers that need `sourceId` or
`contentHash` must opt in the same way. TypeScript types still list the fields
because the omit is applied at runtime.

The guest story response builds its fields explicitly and adds the six credit
fields only. Note that the six credit fields (`attributionText`, `authorName`,
`licenseCode`, `licenseUrl`, `sourceName`, `sourceUrl`) are plain story columns,
so they now appear (as `null` for existing stories) on every endpoint that
returns raw story rows (feeds, library, favourites, downloads and so on), not
only the guest and `GET /stories/:id` responses. Clients that render a story
must show `attributionText` wherever the story is shown.

## Attribution rules per licence

The importer must fill `attributionText`, `authorName`, `licenseCode`,
`licenseUrl`, `sourceName`, `sourceUrl` and `adaptationNotes`, and the app must
display `attributionText` with the story.

- **PD-US (Project Gutenberg public domain).** The text is public domain in the
  USA, but the "Project Gutenberg" name is a registered trademark and the
  licence terms apply only to the trademarked, unmodified distribution.
  Strip every Project Gutenberg reference from the text (header, footer,
  licence block, "produced by" lines, trademark) before storing. Credit the
  original author. Do not imply Project Gutenberg endorsement. Public-domain
  status outside the USA is not assumed; Storytime serves users globally
  **(unverified: confirm for each author's death date)**.
- **CC BY 4.0 (Book Dash, StoryWeaver, African Storybook).** Credit the author,
  illustrator, translator, publisher and donor where the source names them,
  give the licence name and link, and state that the work was adapted. If any
  text was rewritten with AI, say so in the adaptation statement. Do not suggest
  the creator endorses Storytime. Also: keep any copyright notice, licence notice
  and disclaimer-of-warranties notice that the source carries; link to the
  original work (`sourceUrl`); and keep earlier modification notices the source
  already lists (add ours, do not replace theirs) **(unverified: reading of
  CC BY 4.0 section 3(a); confirm with counsel)**.
- **Book Dash extra credit rules.** Book Dash asks for its own credit line and
  for the book to link back to the original **(unverified: copy the exact wording
  from the book's own credits page into `attributionText` at import time)**.
- **CC0.** No credit is legally required; still record source and author.
- **Not accepted:** ShareAlike (SA), NonCommercial (NC) and NoDerivatives (ND)
  licences. SA would force the app's content to be relicensed, NC conflicts with
  a paid product, ND forbids the adaptation (shortening, audio, AI rewrite)
  this product relies on. The importer must reject these `licenseCode`s.
- **STORYTIME_SUBMISSION_V1 (`community`).** Author-submitted stories under a
  Storytime submission licence. The licence text and the author flow are not part
  of this change **(unverified: licence wording not written)**.

## Source cache (`source_cache` table)

Importers read only from this cache so each source site or API is fetched once
per revalidation window.

- One row per `(sourceName, sourceId)`. The payload is not stored in the table;
  `rawPayloadKey` is the object-store key or file path. `licenseSnapshot` keeps
  the rights statement as it was at fetch time.
- `SourceCacheService.getOrFetch(source, id, fetcher, opts)` returns the cached
  entry while `revalidateAfter` is in the future; otherwise it calls `fetcher`
  once and stores the result. The fetcher receives the previous entry so it can
  send `If-None-Match` / `If-Modified-Since`. A `304` keeps the stored data,
  refreshes `etag` / `lastModified` and extends freshness. A `304` with no
  stored row is an error (nothing to revalidate) and is not stored.
- Defaults: 30 days for normal entries, 7 days for 404/410 (these are cached too
  so a missing page is not re-requested on every run).
- Not cached, error thrown: 5xx, 429 and other non-2xx/404/410 statuses, and
  any exception from the fetcher.
- Single flight, no held connections: the fetch runs outside any database
  transaction. Cross-process exclusion uses a lease row in `source_fetch_lease`
  (claimed with one atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE expired`,
  expiry on the database clock). The holder renews it with a heartbeat while the
  fetcher runs (`leaseMs`, default 60 s) and releases it in `finally`; if the
  process dies the lease expires and another caller takes over. Waiters poll the
  cache with backoff (250 ms up to 2 s) and return the holder's result when it
  lands; after `waitTimeoutMs` (default 180 s) they throw
  `SourceCacheLeaseTimeoutError`. Neither the holder's fetch nor a waiter ties up
  a pooled connection. In-process, concurrent callers for one key share the
  first caller's promise, so a later caller's `fetcher` and options (`ttlMs`,
  `fetchedBy`, ...) are ignored for that flight. Only the caller that ran the
  fetcher gets `fetched: true`; joiners get the same entry with `fetched: false`.
- Lease loss is fenced. The heartbeat marks the lease lost when a renew reports
  another holder, or when renewals keep failing past the lease lifetime; the
  fetcher's `AbortSignal` (second argument) is then aborted. Independently, the
  cache write only happens if this process still holds an unexpired lease (the
  lease row is locked for the short write transaction), so a holder that lost
  the lease can never overwrite a newer fetch. A discarded result is logged and
  the current entry is returned with `fetched: false`, `leaseLost: true` and
  `stale` (true when that entry is already past `revalidateAfter`, so callers
  can tell they did not get fresh data), or `SourceCacheLeaseLostError` is
  thrown if there is none.
- `fetchTimeoutMs` (default 60 s) aborts a hung fetcher, rejects with
  `SourceCacheFetchTimeoutError` and releases the lease. This does not replace
  HTTP-level timeouts: importers must set their own and honour the signal. A
  fetcher that ignores the signal keeps running after a timeout and can overlap
  with the next holder's fetch (the cache write is still fenced, so its result
  is discarded, but the upstream request is made twice).
- The fenced write is a short transaction with a 15 s timeout. If the pool is
  starved so that the write cannot start or finish in time, a finished fetch is
  discarded (error, nothing cached) and must be fetched again.
- Failed fetches (5xx/429/exceptions/timeouts) are not negative-cached. If a
  holder fails, each waiting process claims the lease in turn and fetches again
  (N waiting processes can cause N upstream hits). Importers are responsible
  for backoff and `Retry-After` (see below) and should not retry a failing key
  in a tight loop.
- If a re-fetch returns a different `contentHash`, the row gets
  `contentChanged = true` and `previousContentHash`. If a story that had a hash
  now returns 404/410, or a response with no hash, the row keeps the last known
  `contentHash` and `rawPayloadKey`, takes the new `httpStatus`, and is also
  flagged `contentChanged = true` (removed upstream; check `httpStatus`). The flag is a prompt for
  human review. Nothing creates, updates or publishes a story from it. It stays
  set until `acknowledgeChange()` is called.
- `contentHash` comes from `contentHashOf()` (NFC, whitespace collapsed, trimmed,
  sha256 hex); the same function is used for `stories.contentHash`.

## Seeds

`prisma/seeds/stories.seed.ts` accepts the optional provenance fields in
`stories*.json`. Existing duplicates are skipped by title as before, and also by
`(sourceName, sourceId)` and by `contentHash` when provided. A story that has a
`sourceName` but no `contentHash` gets one computed from its content. Plain
curated stories are not hash-deduped.

## Requirements for the future importer (not implemented here)

The fetcher passed to `getOrFetch` is where network safety lives, and this change
contains no fetcher. The importer must:

- accept `https` URLs only, from an allow-list of the known source hosts;
- guard against SSRF: resolve and reject private, loopback and link-local
  addresses, and cap and re-validate redirects (host allow-list on each hop);
- enforce a response byte limit and a content-type allow-list, plus connect and
  total timeouts;
- honour `Retry-After` and back off on 429/503 (this cache deliberately does not
  store those responses);
- identify itself with a descriptive User-Agent and respect each source's terms
  and robots rules **(unverified per source)**.

## Deploy note

The migration sets `SET LOCAL lock_timeout = '5s'` before touching `stories`.
If the deploy fails with SQLSTATE 55P03 (lock not available), nothing was
applied, but Prisma marks the migration failed and a plain re-run fails with
P3009. Run

```
prisma migrate resolve --rolled-back 20261031000001_add_story_provenance_and_source_cache
prisma migrate deploy
```

and redeploy at a quieter time.
