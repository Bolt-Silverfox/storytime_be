/**
 * Shared file upload validation constants.
 * Used by avatar, story-buddy, and any other controllers accepting image uploads.
 */

/** Regex matching allowed image MIME types for file uploads. */
export const ALLOWED_IMAGE_TYPES =
  /(image\/png|image\/jpeg|image\/gif|image\/webp)/;

/** Maximum upload file size in bytes (5 MB). */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
