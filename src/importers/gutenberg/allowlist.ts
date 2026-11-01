import { AllowListEntry, EffectiveStatus } from './allowlist.types';
import { GUTENBERG_REFERENCE } from './gutenberg-text';

/** Last first-publication year that is US public domain by the 95-year rule. */
export const LATEST_PD_US_PUBLICATION_YEAR = 1930;

export function effectiveStatus(
  e: AllowListEntry,
  now: Date,
): { status: EffectiveStatus; reason?: string } {
  if (e.status === 'excluded')
    return { status: 'excluded', reason: e.statusReason };
  if (e.status === 'needs-review') {
    return { status: 'needs-review', reason: e.statusReason };
  }
  if (e.flags.includes('dated-content')) {
    return {
      status: 'needs-editorial-retell',
      reason:
        'flagged dated-content (stereotypes or violence): needs an editorial retell, not a direct import',
    };
  }
  if (e.translator) {
    const d = e.translator.deathYear;
    if (d === undefined) {
      return {
        status: 'needs-review',
        reason: `translator ${e.translator.name}: death year unknown, public-domain status unconfirmed`,
      };
    }
    // life+70: public domain from 1 January of (death year + 71).
    if (now.getUTCFullYear() < d + 71) {
      return {
        status: 'needs-review',
        reason: `translator ${e.translator.name} died ${d}: life+70 not yet elapsed`,
      };
    }
  }
  return { status: 'approved' };
}

export function validateAllowList(list: AllowListEntry[]): void {
  const seen = new Set<string>();
  for (const e of list) {
    const where = `allow-list entry ${e.ebookId}`;
    if (!/^\d{1,7}$/.test(e.ebookId))
      throw new Error(`${where}: invalid ebook id`);
    if (seen.has(e.ebookId)) throw new Error(`${where}: duplicate ebook id`);
    seen.add(e.ebookId);
    if (
      !Number.isInteger(e.ageMin) ||
      !Number.isInteger(e.ageMax) ||
      e.ageMin < 1 ||
      e.ageMax > 12 ||
      e.ageMin > e.ageMax
    ) {
      throw new Error(`${where}: invalid age band`);
    }
    const pub = [
      e.title,
      e.authorName,
      e.description,
      e.translator?.name,
      e.illustrator,
    ]
      .filter(Boolean)
      .join(' ');
    if (GUTENBERG_REFERENCE.test(pub)) {
      throw new Error(
        `${where}: public field contains a source-site reference`,
      );
    }
    if (e.status !== 'approved' && !e.statusReason) {
      throw new Error(`${where}: statusReason is required unless approved`);
    }
    if (
      e.status === 'approved' &&
      e.firstPublished > LATEST_PD_US_PUBLICATION_YEAR
    ) {
      throw new Error(
        `${where}: approved needs a pre-1931 first publication (got ${e.firstPublished})`,
      );
    }
    if (!e.expect?.title || !e.expect?.author || !e.pdJustification) {
      throw new Error(
        `${where}: expect.title, expect.author and pdJustification are required`,
      );
    }
  }
}

/**
 * The ONLY works the importer may touch. Ebook ids were entered from memory of
 * the public catalogue and are NOT yet confirmed against a mirror: the importer
 * checks each file's Title/Author (and Translator where set) against `expect`
 * and refuses a mismatch. Confirm every id before approving (docs).
 */
export const GUTENBERG_ALLOWLIST: AllowListEntry[] = [
  {
    ebookId: '14838',
    title: 'The Tale of Peter Rabbit',
    authorName: 'Beatrix Potter',
    illustrator: 'Beatrix Potter',
    firstPublished: 1902,
    status: 'approved',
    flags: [],
    ageMin: 4,
    ageMax: 6,
    difficultyLevel: 1,
    categories: ['Animal', 'Bedtime'],
    themes: ['Adventure'],
    description: 'A naughty young rabbit sneaks into Mr. McGregor’s garden.',
    expect: { title: 'Peter Rabbit', author: 'Potter' },
    pdJustification:
      'Published 1902 (pre-1931, US public domain). Author died 1943; she also drew the pictures. No translator.',
  },
  {
    ebookId: '11757',
    title: 'The Velveteen Rabbit',
    authorName: 'Margery Williams',
    illustrator: 'William Nicholson',
    firstPublished: 1922,
    status: 'approved',
    flags: [],
    ageMin: 4,
    ageMax: 8,
    difficultyLevel: 2,
    categories: ['Animal', 'Friendship and Feelings'],
    themes: ['Love & Family'],
    description: 'A toy rabbit longs to become real through a child’s love.',
    expect: { title: 'Velveteen', author: 'Williams' },
    pdJustification:
      'Published 1922 (pre-1931, US public domain). Author died 1944, illustrator died 1949. Pictures are not imported.',
  },
  {
    ebookId: '11',
    title: 'Alice’s Adventures in Wonderland',
    authorName: 'Lewis Carroll',
    illustrator: 'John Tenniel',
    firstPublished: 1865,
    status: 'approved',
    flags: [],
    ageMin: 7,
    ageMax: 12,
    difficultyLevel: 3,
    categories: ['Fantasy and Magical Stories'],
    themes: ['Adventure'],
    description:
      'Alice follows a white rabbit down a hole into a strange world.',
    expect: { title: 'Alice', author: 'Carroll' },
    pdJustification:
      'Published 1865. Author died 1898, illustrator died 1914. No translator.',
  },
  {
    ebookId: '55',
    title: 'The Wonderful Wizard of Oz',
    authorName: 'L. Frank Baum',
    illustrator: 'W. W. Denslow',
    firstPublished: 1900,
    status: 'approved',
    flags: [],
    ageMin: 7,
    ageMax: 10,
    difficultyLevel: 3,
    categories: ['Fantasy and Magical Stories', 'Adventures and Action'],
    themes: ['Friendship & Belonging'],
    description: 'A Kansas girl and three friends travel to the Emerald City.',
    expect: { title: 'Wizard of Oz', author: 'Baum' },
    pdJustification:
      'Published 1900. Author died 1919, illustrator died 1915. Contains mild peril; reviewer should read before publishing.',
  },
  {
    ebookId: '21',
    title: 'Aesop’s Fables',
    authorName: 'Aesop',
    translator: { name: 'George Fyler Townsend', deathYear: 1900 },
    firstPublished: 1867,
    status: 'approved',
    flags: [],
    ageMin: 4,
    ageMax: 9,
    difficultyLevel: 2,
    categories: ['Animal', 'Value and Life Lessons'],
    themes: ['Honesty & Integrity'],
    description: 'Short animal fables, each ending with a moral.',
    expect: { title: 'Aesop', author: 'Aesop', translator: 'Townsend' },
    pdJustification:
      'Ancient text. The Townsend translation (1867) is pre-1931 and Townsend died 1900. The importer requires the header to name Townsend; any other translation is refused.',
  },
  {
    ebookId: '16',
    title: 'Peter Pan',
    authorName: 'J. M. Barrie',
    illustrator: 'F. D. Bedford',
    firstPublished: 1911,
    status: 'approved',
    flags: ['dated-content'],
    ageMin: 7,
    ageMax: 10,
    difficultyLevel: 3,
    categories: ['Fantasy and Magical Stories', 'Adventures and Action'],
    themes: ['Coming of Age'],
    description: 'Wendy and her brothers fly to Neverland with Peter Pan.',
    expect: { title: 'Peter', author: 'Barrie' },
    pdJustification:
      'Published 1911. Author died 1937. UK rights in the play are perpetual to a hospital; that is a UK matter, not US, and is unverified for non-US use. Dated depictions of the island’s native people and violence: needs retell.',
  },
  {
    ebookId: '2781',
    title: 'Just So Stories',
    authorName: 'Rudyard Kipling',
    firstPublished: 1902,
    status: 'approved',
    flags: ['dated-content'],
    ageMin: 4,
    ageMax: 8,
    difficultyLevel: 2,
    categories: ['Animal', 'Bedtime'],
    themes: ['Identity & Self-Discovery'],
    description: 'Playful origin tales about how animals got their features.',
    expect: { title: 'Just So', author: 'Kipling' },
    pdJustification:
      'Published 1902. Author died 1936. Some tales carry colonial-era stereotypes: needs retell.',
  },
  {
    ebookId: '2591',
    title: 'Grimms’ Fairy Tales',
    authorName: 'Jacob and Wilhelm Grimm',
    translator: { name: 'Margaret Hunt', deathYear: 1912 },
    firstPublished: 1884,
    status: 'approved',
    flags: ['dated-content'],
    ageMin: 7,
    ageMax: 12,
    difficultyLevel: 3,
    categories: ['Fairytales & Folktales'],
    themes: ['Good vs. Evil'],
    description: 'A large collection of German folk and fairy tales.',
    expect: { title: 'Grimm', author: 'Grimm', translator: 'Hunt' },
    pdJustification:
      'Authors died 1859 and 1863. Margaret Hunt translation (1884), translator died 1912. The collection includes at least one antisemitic tale and graphic violence: needs retell, and it is an anthology that should be split per tale.',
  },
  {
    ebookId: '503',
    title: 'The Blue Fairy Book',
    authorName: 'Andrew Lang',
    illustrator: 'H. J. Ford',
    firstPublished: 1889,
    status: 'needs-review',
    statusReason:
      'multiple credited translators (various translators of the individual tales); each translator’s death year and public-domain status is unchecked',
    flags: ['dated-content'],
    ageMin: 7,
    ageMax: 12,
    difficultyLevel: 3,
    categories: ['Fairytales & Folktales'],
    themes: ['Good vs. Evil'],
    description: 'Andrew Lang’s collection of classic fairy tales.',
    expect: { title: 'Blue Fairy', author: 'Lang' },
    pdJustification:
      'Editor died 1912, illustrator died 1941; text published 1889. Individual translators unverified. Anthology with dated content.',
  },
  {
    ebookId: '1597',
    title: 'Fairy Tales of Hans Christian Andersen',
    authorName: 'Hans Christian Andersen',
    translator: { name: 'Mrs. H. B. Paull' },
    firstPublished: 1872,
    status: 'needs-review',
    statusReason:
      'ebook id and translator edition not confirmed against the mirror; translator death year not verified',
    flags: [],
    ageMin: 6,
    ageMax: 10,
    difficultyLevel: 3,
    categories: ['Fairytales & Folktales'],
    themes: ['Hope & Perseverance'],
    description: 'Classic tales by Hans Christian Andersen.',
    expect: { title: 'Andersen', author: 'Andersen', translator: 'Paull' },
    pdJustification:
      'Author died 1875. If the edition is the 1872 Paull translation it is pre-1931, but the translator’s death year is unverified.',
  },
  {
    ebookId: '27200',
    title: 'Andersen’s Fairy Tales (Hersholt translation)',
    authorName: 'Hans Christian Andersen',
    translator: { name: 'Jean Hersholt', deathYear: 1956 },
    firstPublished: 1949,
    status: 'excluded',
    statusReason:
      'Hersholt translation published 1949: inside the US 95-year term (to 2044) and Hersholt died 1956 (life+70 ends 2026). Not usable.',
    flags: [],
    ageMin: 6,
    ageMax: 10,
    categories: ['Fairytales & Folktales'],
    themes: [],
    description: 'Excluded entry kept so it is never added by mistake.',
    expect: { title: 'Andersen', author: 'Andersen', translator: 'Hersholt' },
    pdJustification: 'Not public domain: see statusReason.',
  },
];

validateAllowList(GUTENBERG_ALLOWLIST);
