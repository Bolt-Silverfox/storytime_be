import { Test, TestingModule } from '@nestjs/testing';
import { TextChunker } from './text-chunker';

describe('TextChunker', () => {
  let chunker: TextChunker;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TextChunker],
    }).compile();

    chunker = module.get<TextChunker>(TextChunker);
  });

  it('should be defined', () => {
    expect(chunker).toBeDefined();
  });

  it('should chunk text that exceeds max length', () => {
    const text = 'A'.repeat(100) + ' ' + 'B'.repeat(100);
    // chunks of max 150
    // It should split at the space
    const chunks = chunker.chunk(text, 150);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe('A'.repeat(100));
    expect(chunks[1]).toBe('B'.repeat(100));
  });

  it('should split at sentence boundaries if possible', () => {
    const sentence1 = 'This is a sentence.';
    const sentence2 = ' This is another sentence.';
    // length is roughly 20 + 25 = 45.
    // max length 30.
    // should split after sentence1.

    const chunks = chunker.chunk(sentence1 + sentence2, 30);
    expect(chunks[0]).toBe(sentence1);
    expect(chunks[1]).toBe(sentence2.trim());
  });

  it('should remove and re-add speak tags conceptually? (No, the chunker just removes them)', () => {
    // The chunker implementation:
    // let cleanText = text.replace(/^<speak>/, '').replace(/<\/speak>$/, '');
    // then pushes plain chunks.
    // The calling provider adds the tags back.

    const input = '<speak>Hello world</speak>';
    const chunks = chunker.chunk(input, 100);
    expect(chunks[0]).toBe('Hello world');
  });
});
