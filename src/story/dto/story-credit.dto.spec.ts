import { GuestStoryResponseDto } from '@/guest/dto/guest.dto';
import * as adminResponses from '@/admin/dto/admin-responses.dto';
import * as readingAnalytics from '@/admin/dto/reading-analytics.dto';
import * as cursorPagination from '@/shared/dtos/cursor-pagination.dto';
import * as storyDtos from './story.dto';
import { StoryDetailDto } from '@/admin/dto/admin-responses.dto';
import {
  CategoryDto,
  StoryBranchDto,
  StoryCreditDto,
  StoryImageDto,
  StoryReadResponseDto,
  ThemeDto,
} from './story.dto';

const swaggerProps = (cls: any): string[] =>
  (
    Reflect.getMetadata('swagger/apiModelPropertiesArray', cls.prototype) ?? []
  ).map((p: string) => p.replace(/^:/, ''));

const CREDIT = [
  'attributionText',
  'authorName',
  'licenseCode',
  'licenseUrl',
  'sourceName',
  'sourceUrl',
];
const INTERNAL = ['sourceId', 'contentHash'];

describe('story credit DTO documentation', () => {
  it.each([
    ['StoryCreditDto', StoryCreditDto],
    ['GuestStoryResponseDto', GuestStoryResponseDto],
    ['StoryReadResponseDto', StoryReadResponseDto],
    ['admin StoryDetailDto', StoryDetailDto],
  ])('%s documents the six credit fields', (_n, cls) => {
    expect(swaggerProps(cls)).toEqual(expect.arrayContaining(CREDIT));
  });

  it.each([
    ['StoryCreditDto', StoryCreditDto],
    ['GuestStoryResponseDto', GuestStoryResponseDto],
    ['StoryReadResponseDto', StoryReadResponseDto],
    ['admin StoryDetailDto', StoryDetailDto],
  ])('%s never documents sourceId/contentHash', (_n, cls) => {
    for (const k of INTERNAL) expect(swaggerProps(cls)).not.toContain(k);
  });

  it('public DTOs do not document adaptationNotes/importedAt; admin does', () => {
    for (const cls of [
      StoryCreditDto,
      GuestStoryResponseDto,
      StoryReadResponseDto,
    ]) {
      expect(swaggerProps(cls)).not.toContain('adaptationNotes');
      expect(swaggerProps(cls)).not.toContain('importedAt');
    }
    expect(swaggerProps(StoryDetailDto)).toEqual(
      expect.arrayContaining(['adaptationNotes', 'importedAt']),
    );
  });

  it('StoryReadResponseDto documents categories, themes and questions', () => {
    expect(swaggerProps(StoryReadResponseDto)).toEqual(
      expect.arrayContaining(['categories', 'themes', 'questions']),
    );
  });

  it.each([
    ['CategoryDto', CategoryDto],
    ['ThemeDto', ThemeDto],
  ])(
    '%s documents nullable image/description (DB columns are nullable)',
    (_n, cls) => {
      for (const prop of ['image', 'description']) {
        const meta = Reflect.getMetadata(
          'swagger/apiModelProperties',
          cls.prototype,
          prop,
        ) as { nullable?: boolean };
        expect(meta.nullable).toBe(true);
      }
    },
  );

  describe('nullable fields declare an explicit scalar type', () => {
    // `string | null` emits `Object` under decorator metadata, which Swagger
    // would publish as an object schema. Each nullable field must therefore
    // carry an explicit `type` alongside `nullable: true`.
    const meta = (cls: any, prop: string) =>
      Reflect.getMetadata(
        'swagger/apiModelProperties',
        cls.prototype,
        prop,
      ) as { nullable?: boolean; type?: unknown };

    it.each([
      ...CREDIT.map((p) => [StoryCreditDto, p, String]),
      ...['coverImageUrl', 'audioUrl', 'textContent', ...CREDIT].map((p) => [
        StoryReadResponseDto,
        p,
        String,
      ]),
      [StoryDetailDto, 'adaptationNotes', String],
      [StoryDetailDto, 'importedAt', Date],
      [StoryImageDto, 'caption', String],
      [StoryBranchDto, 'nextA', String],
      [StoryBranchDto, 'nextB', String],
    ] as [any, string, unknown][])('%p.%s is a nullable %p', (cls, prop, t) => {
      const m = meta(cls, prop);
      expect(m.nullable).toBe(true);
      expect(m.type).toBe(t);
    });
  });

  describe('sweep: every nullable property declares an explicit type', () => {
    // design:type is Object for `T | null`, so a nullable ApiProperty without
    // an explicit `type` is published as an object schema.
    const offenders = (mod: Record<string, unknown>): string[] => {
      const out: string[] = [];
      for (const [name, cls] of Object.entries(mod)) {
        if (typeof cls !== 'function' || !cls.prototype) continue;
        const props: string[] = (
          Reflect.getMetadata(
            'swagger/apiModelPropertiesArray',
            cls.prototype,
          ) ?? []
        ).map((p: string) => p.replace(/^:/, ''));
        for (const prop of props) {
          const m = Reflect.getMetadata(
            'swagger/apiModelProperties',
            cls.prototype,
            prop,
          ) as { nullable?: boolean; type?: unknown } | undefined;
          if (m?.nullable && (m.type === undefined || m.type === Object))
            out.push(`${name}.${prop}`);
        }
      }
      return out;
    };

    it.each([
      ['story.dto', storyDtos],
      ['admin-responses.dto', adminResponses],
      ['reading-analytics.dto', readingAnalytics],
      ['cursor-pagination.dto', cursorPagination],
    ])('%s has no untyped nullable property', (_n, mod) => {
      expect(offenders(mod as Record<string, unknown>)).toEqual([]);
    });
  });
});
