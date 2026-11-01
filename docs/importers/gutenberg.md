# Gutenberg importer

Imports a small, hand-picked set of US public-domain children's works into
`stories` as **unpublished** rows for human review. Built on the provenance
columns and the source cache described in `docs/story-provenance.md`.

Nothing here is legal advice. Items marked **(unverified)** have not been
confirmed by a lawyer or against the live catalogue.

## What it does and does not do

- Reads only works on the curated allow-list (`src/importers/gutenberg/allowlist.ts`). There is no bulk crawl; an id that is not on the list is rejected without being read.
- Reads text from a local directory (an rsync mirror copy or a folder you place files in). It never scrapes gutenberg.org pages. A real HTTPS/rsync source is a follow-up (see below).
- Every read goes through `SourceCacheService.getOrFetch`, so each work is read once per cache window (30 days by default; `--ttl-days`). The raw file is kept privately under `--cache-dir` (default `.cache/gutenberg`, git-ignored) and is never served.
- Strips edition boilerplate, normalises the text and stores it. No AI rewrite, no wording changes, no cover art, no audio.
- Creates stories with `isPublished=false`. Publishing is always a manual admin action.
- No HTTP endpoint. It is an operator script that needs a shell and `DATABASE_URL`.

## Running it

```
# 1. Get the files (one-off, then monthly): see "Mirror setup"
# 2. Dry run (default): prints what would happen, writes nothing
pnpm import:gutenberg -- --source-dir /data/gutenberg

# 3. Commit: writes unpublished stories, the source_cache rows and payload files
pnpm import:gutenberg -- --commit --source-dir /data/gutenberg [--only 14838] [--ttl-days 30]
```

Flags: `--dry-run` (default), `--commit`, `--allow-unverified-ids`, `--source-dir <dir>` (required), `--cache-dir <dir>`, `--only <ebook id>` (must be on the allow-list), `--ttl-days <n>`, `--yes-production` (required for `--commit` unless the `DATABASE_URL` host is clearly local: localhost, 127.0.0.1, ::1 or a unix socket; `*.local` names do NOT count as local; `NODE_ENV` is ignored; unknown or unparseable URLs count as remote). Limit: an SSH tunnel to a remote database looks like localhost and passes this guard, so it is a safety net against mistakes, not authorization. Exit code is 1 if any work errored.

Dry-run reads an existing cache entry if there is one, otherwise reads the file directly; it never writes a story, a cache row or a payload file.

### Report outcomes

| Outcome | Meaning |
| --- | --- |
| `create` | New unpublished story (written only with `--commit`). Unmapped category/theme names are listed. |
| `skip-exists` | A story with this `(sourceName, sourceId)` already exists and its text is unchanged. |
| `skip-duplicate` | Another story already has the same `contentHash`. |
| `changed` | Upstream text differs from the stored story. Nothing is updated or published; the cache row has `contentChanged=true` for a human to look at. |
| `needs-review` | Allow-list status, unprovable translator status, unverified ebook id on `--commit`, an oversized work, or the file failed a safety check (reason shown). Not imported. |
| `needs-editorial-retell` | Entry carries the `dated-content` flag. Not imported; needs a separate retell. |
| `excluded` | Known not usable (reason on the entry). |
| `rejected` | `--only` id is not on the allow-list. |
| `missing-in-source` | Not found in `--source-dir`. |

## Mirror setup

The Project Gutenberg robot policy asks bots to use a mirror, not the website. Use `rsync` against an official mirror (for example `rsync -av --include='*/' --include='*.txt' --exclude='*' rsync.ibiblio.org::gutenberg/ /data/gutenberg/`), restrict it to text, and re-sync about monthly **(unverified: confirm current mirror host, flags and bandwidth etiquette against gutenberg.org/help/mirroring.html before the first sync)**. For a handful of works you can instead copy the UTF-8 text files by hand into one folder.

Accepted layouts under `--source-dir`: `<id>-0.txt`, `<id>.txt`, `pg<id>.txt`, `<id>/<id>-0.txt`, the rsync digit layout (`1/2/3/1234/1234-0.txt`), `cache/epub/<id>/pg<id>.txt`, and `<id>-8.txt` (read as Latin-1). Files over 8 MB are refused. Ids must be digits only.

## Allow-list format

`allowlist.ts` exports `GUTENBERG_ALLOWLIST`, validated on load by `validateAllowList`.

| Field | Notes |
| --- | --- |
| `ebookId` | digits only, unique |
| `title`, `authorName`, `description` | our own wording; must not mention the source site |
| `translator {name, deathYear}`, `illustrator` | translator is credited in `attributionText` and needs a death year; the illustrator is informational only and is NOT credited because pictures are not imported |
| `firstPublished` | `approved` requires 1930 or earlier |
| `status` | `approved`, `needs-review` or `excluded` (the last two need `statusReason`) |
| `flags` | `dated-content` forces `needs-editorial-retell`; `violence` only adds an editor note to the report (an editorial call, still imports) |
| `ageMin`, `ageMax`, `difficultyLevel` | 1 to 12 |
| `categories`, `themes` | names of existing rows. Unknown names are reported and never created |
| `expect {title, author, translator?}` | the file header must contain these, or the work goes to `needs-review` (guards against a wrong id or edition) |
| `pdJustification` | why the text is US public domain |
| `idVerified` | `false` until a human confirmed the id (title, author, translator edition) against the catalogue. `--commit` refuses unverified ids unless `--allow-unverified-ids`; dry-run still reports them with a note |

Effective status order: `excluded`, `needs-review`, `dated-content` flag, translator rule, otherwise `approved`. Translator rule: a translator with no death year, or whose death year plus 71 is later than the current year, is `needs-review` (life+70).

### Adding a work

1. Find the ebook number in the catalogue and copy the file into the mirror/folder.
2. Check the edition's author, translator and illustrator, their death years, and the first publication year of this text. A modern translation or retelling is almost always copyrighted.
3. Read the text for stereotypes or violence; if present add `flags: ['dated-content']`.
4. Add the entry with a real `pdJustification`, run `--dry-run`, then `--commit --only <id>`.
5. A reviewer reads the unpublished story in the admin tool, adds categories/age checks and art, then publishes.

## What gets changed in the text

Header and footer removed, licence text removed, producer and transcriber notes removed, `[Illustration]` placeholders removed, table of contents removed, hard line wraps rejoined into paragraphs separated by one blank line, `_italic_` markers removed, chapter headings kept as their own paragraph with capitals normalised, BOM/CRLF/zero-width characters/NBSP normalised, NFC. These changes, plus any editor notes (`violence` flag, unverified ebook id), are recorded in `adaptationNotes` (admin only), so reviewers see them on the story. Pages are not stored: the reader splits `textContent` into 30-word pages at read time (`splitStoryIntoPages`), so scenes and paragraph audio are unaffected. `wordCount` and `durationSeconds` (150 words per minute) are filled in.

Rules enforced in code:

- Matching is done on a folded copy (NFKC, soft hyphens and zero-width characters removed, hyphen line breaks joined, look-alike Cyrillic/Greek letters mapped to Latin, non-letters ignored), so "Guten-\nberg", full-width and homoglyph variants are recognised. The stored text keeps its typography (NFC).
- Only recognised boilerplate paragraphs are dropped (produced/prepared/transcribed/digitized by, "This eBook/etext ...", Etext/eBook numbers, PG edition, Michael S. Hart, Distributed Proofreaders, "End of the Project ...", the project name at paragraph start, bracketed transcriber notes including multi-paragraph ones). A story paragraph that merely mentions the source is NOT silently removed: it fails the final residual check and the work becomes `needs-review`.
- Also `needs-review`: missing start/end marker (strict, at line start, three asterisks), header not matching `expect`, an unlisted translator, a bare "Transcriber's Note:" heading whose extent is unknown, and any work over 8,000 words (about 270 pages), which must be split first. Alice, Oz and any anthology are currently over the cap.
- An ebook/etext number inside a story sentence is never deleted (that would drop story words); the work fails closed to `needs-review`. The fold also strips combining marks and maps small-cap, Greek and Cyrillic look-alikes.
- All cleaning is linear time (no backtracking-prone regexes) and is covered by a performance test.
- Raw payload files are written 0600 in 0700 directories.

## Stored fields

`sourceName='gutenberg'`, `sourceId=<ebook number>`, `sourceUrl=https://www.gutenberg.org/ebooks/<id>`, `licenseCode='PD-US'`, `licenseUrl` = Public Domain Mark 1.0, `authorName`, `attributionText` ("Title by Author; translated by .... Public domain in the United States. Text cleaned and formatted for Storytime; wording unchanged."), `adaptationNotes`, `contentHash`, `importedAt`. `coverImageUrl` and `audioUrl` are empty strings because the columns are not nullable. `language='en'`, `aiGenerated=false`.

## Licence and legal caveats

- **All ebook ids in the shipped allow-list are from memory (`idVerified: false`).** Verify each against the catalogue before the first `--commit`.
- Public domain **in the United States only**. Storytime serves users globally; status elsewhere is not assumed and is **unverified** per author. UK, EU and other terms can be longer (life+70 for authors who died after 1955; Barrie's Peter Pan has a special UK rule).
- "Project Gutenberg" is a registered trademark. Do not use the name in titles, text or attribution, and do not imply endorsement. The stored `sourceName` and `sourceUrl` contain the name for provenance, but API responses return them as `null` for public-domain stories (`PublicCreditInterceptor`, see `docs/story-provenance.md`); admin routes still show them.
- Translations and editions have their own copyright. This importer requires a known translator death year and the header check; it cannot see whether a particular edition added new copyrightable material (introductions, notes), which are dropped only where they sit outside the start/end markers.
- Raw payloads kept in `--cache-dir` still contain the source's boilerplate. Keep them private; never serve them.

## Unverified

- The ebook ids in the shipped allow-list were entered from memory and not checked against a mirror. The header check refuses a mismatch but cannot prove an edition is the intended translator's. Confirm each id before approving.
- Death years and publication years in `pdJustification` are the team's reading of standard references.
- The older "small print" licence layout (pre-2003 files without `*** START` markers) is not handled; those files become `needs-review`.
- A table of contents is only recognised when it starts with the word CONTENTS.

## Follow-ups (not in this change)

- HTTPS/rsync `GutenbergSource`: https only, host allow-list, SSRF guard, byte limit, content-type allow-list, connect and total timeouts, `Retry-After` back-off, honour the `AbortSignal`, descriptive User-Agent. See "Requirements for the future importer" in `docs/story-provenance.md`.
- Splitting anthologies (Grimm, Aesop, Andersen) into one story per tale.
- Editorial retell pipeline for `dated-content` works.
