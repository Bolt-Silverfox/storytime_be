import { Test, TestingModule } from '@nestjs/testing';
import { SSMLFormatter } from './ssml-formatter';

describe('SSMLFormatter', () => {
  let formatter: SSMLFormatter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SSMLFormatter],
    }).compile();

    formatter = module.get<SSMLFormatter>(SSMLFormatter);
  });

  it('should be defined', () => {
    expect(formatter).toBeDefined();
  });

  it('should format text to SSML with proper escaping and pauses', () => {
    const input = 'Hello, World! & "Test"';
    // Detailed expectation calculation:
    // 1. Newline placeholder: no change.
    // 2. Clean spacing: "Hello, World! & \"Test\""
    // 3. Escape: "Hello, World! &amp; &quot;Test&quot;"
    // 4. Comma pause: "Hello, <break time=\"300ms\"/> World! &amp; &quot;Test&quot;"
    // 5. Sentence pause: "Hello, <break time=\"300ms\"/> World! <break time=\"800ms\"/> &amp; &quot;Test&quot;"
    //    (Note: "World! " matches so "! " becomes "! <break time="800ms"/> ")
    // 6. Restore paragraphs: no change.
    // 7. Wrap: <speak>...</speak>

    const expected =
      '<speak>Hello, <break time="300ms"/> World! <break time="800ms"/> &amp; &quot;Test&quot;</speak>';
    expect(formatter.format(input)).toBe(expected);
  });

  it('should handle double newlines as paragraphs', () => {
    const input = 'Paragraph one.\n\nParagraph two.';
    // 1. Placeholder: "Paragraph one.___PARAGRAPH_BREAK___Paragraph two."
    // 2. Clean spacing: "Paragraph one.___PARAGRAPH_BREAK___Paragraph two."
    //    (Note: "one." is followed by "_", so no space inserted if there wasn't one. The regex is \s+. \n\n was replaced.)
    // 3. Escape: no change.
    // 4. Comma: no change.
    // 5. Sentence: /([.!?])\s/g. "one." followed by "_" -> NO MATCH.
    // 6. Restore: "Paragraph one.<break time="1500ms"/>Paragraph two."

    const expected =
      '<speak>Paragraph one.<break time="1500ms"/>Paragraph two.</speak>';
    expect(formatter.format(input)).toBe(expected);
  });
});
