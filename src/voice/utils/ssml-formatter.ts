import { Injectable } from '@nestjs/common';

@Injectable()
export class SSMLFormatter {
    /**
     * Adds "Breathing Room" to the story by formatting text to SSML
     */
    format(rawText: string, options?: { speed?: string }): string {
        // 1. Handle paragraph breaks (double newlines) BEFORE cleaning whitespace
        // Using a unique placeholder that isn't likely to be in the text
        const PARAGRAPH_MARKER = '___PARAGRAPH_BREAK___';
        let text = rawText.replace(/\n\s*\n/g, PARAGRAPH_MARKER);

        // 2. Clean up weird spacing
        text = text.replace(/\s+/g, ' ').trim();

        // 3. Escape special XML characters to prevent errors
        text = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

        // 4. Add pauses for dramatic effect
        // Pause after commas (short breath)
        text = text.replace(/,/g, ', <break time="300ms"/>');

        // Pause after sentences (medium breath)
        text = text.replace(/([.!?])\s/g, '$1 <break time="800ms"/> ');

        // Restore paragraph breaks with long pause
        text = text.replace(new RegExp(PARAGRAPH_MARKER, 'g'), '<break time="1500ms"/>');

        // 5. Apply prosody (speed/rate) if requested
        if (options?.speed) {
            text = `<prosody rate="${options.speed}">${text}</prosody>`;
        }

        // 6. Wrap in <speak> tags
        return `<speak>${text}</speak>`;
    }
}
