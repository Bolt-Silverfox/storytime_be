import { Injectable } from '@nestjs/common';

@Injectable()
export class TextChunker {
    chunk(text: string, maxLength: number): string[] {
        // Remove outer <speak> tags for splitting, we'll add them back to chunks
        let cleanText = text.replace(/^<speak>/, '').replace(/<\/speak>$/, '');

        const chunks: string[] = [];
        while (cleanText.length > maxLength) {
            let splitIndex = cleanText.lastIndexOf(' ', maxLength);
            // Try to split at a sentence end if possible
            const sentenceEnd = cleanText.lastIndexOf('. ', maxLength);
            if (sentenceEnd > maxLength * 0.5) {
                splitIndex = sentenceEnd + 1;
            }

            if (splitIndex === -1) splitIndex = maxLength;

            chunks.push(cleanText.substring(0, splitIndex).trim());
            cleanText = cleanText.substring(splitIndex).trim();
        }
        if (cleanText.length > 0) {
            chunks.push(cleanText);
        }
        return chunks;
    }
}
