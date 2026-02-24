import { Transform } from 'class-transformer';
import sanitizeHtml from 'sanitize-html';

export type SanitizeOptions = sanitizeHtml.IOptions;

export function SanitizeHtml(options?: SanitizeOptions) {
  return Transform(({ value }) => {
    if (typeof value !== 'string') {
      return value;
    }
    return sanitizeHtml(
      value,
      options || {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          '*': ['class', 'style'],
        },
      },
    );
  });
}
