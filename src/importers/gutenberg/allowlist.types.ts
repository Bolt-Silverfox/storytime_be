export type AllowListStatus = 'approved' | 'needs-review' | 'excluded';
export type AllowListFlag = 'dated-content' | 'violence';
export type EffectiveStatus = AllowListStatus | 'needs-editorial-retell';

export interface AllowListPerson {
  name: string;
  /** Needed for translators: PD by life+70 requires a known death year. */
  deathYear?: number;
}

export interface AllowListEntry {
  /** Ebook number (digits only). The ONLY thing that may be imported. */
  ebookId: string;
  /** Our own curated title (never copied from the source header). */
  title: string;
  authorName: string;
  translator?: AllowListPerson;
  illustrator?: string;
  /** Year of first publication of this edition's text. Approved => <= 1930. */
  firstPublished: number;
  status: AllowListStatus;
  /** Required unless approved. */
  statusReason?: string;
  /**
   * `dated-content` (stereotypes) forces needs-editorial-retell. `violence`
   * only adds an editor note to the report: an editorial call, not a block.
   */
  flags: AllowListFlag[];
  ageMin: number;
  ageMax: number;
  difficultyLevel?: number;
  /** Names of EXISTING categories/themes; unknown names are reported, never created. */
  categories: string[];
  themes: string[];
  /** One-line blurb written by us. */
  description: string;
  /** Sanity check of the source header so a wrong id cannot be imported. */
  expect: { title: string; author: string; translator?: string };
  /** Why this text is US public domain (author/translator death, pub year). */
  pdJustification: string;
  /**
   * true only once a human confirmed this id (title, author, translator
   * edition) against the catalogue. --commit refuses unverified ids unless
   * --allow-unverified-ids is given. Dry-run still reports them.
   */
  idVerified: boolean;
}
