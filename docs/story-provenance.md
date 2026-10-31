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
fields only.

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
  the creator endorses Storytime.
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
  send `If-None-Match` / `If-Modified-Since`. A `304` result extends freshness
  and keeps the stored data.
- Defaults: 30 days for normal entries, 7 days for 404/410 (these are cached too
  so a missing page is not re-requested on every run).
- Not cached, error thrown: 5xx, 429 and other non-2xx/404/410 statuses, and
  any exception from the fetcher.
- Single flight: concurrent calls for one key in a process share one fetch; calls
  from different processes are serialised with a Postgres advisory transaction
  lock, so the second caller finds the first caller's row. The fetch runs inside
  that transaction (default timeout 120 s), so keep fetchers bounded.
- If a re-fetch returns a different `contentHash`, the row gets
  `contentChanged = true` and `previousContentHash`. The flag is a prompt for
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
