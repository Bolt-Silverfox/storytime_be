import { GuestStoryResponseDto } from '@/guest/dto/guest.dto';
import { StoryDetailDto } from '@/admin/dto/admin-responses.dto';
import {
  CategoryDto,
  StoryCreditDto,
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
});
