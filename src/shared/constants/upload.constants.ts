/**
 * Shared file upload validation constants.
 * Used by avatar, story-buddy, and any other controllers accepting image uploads.
 */

/** Regex matching allowed image MIME types for file uploads. */
export const ALLOWED_IMAGE_TYPES = /^image\/(png|jpeg|gif|webp)$/;

/** Maximum upload file size in bytes (5 MB). */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/** Cumulative Cloudinary upload cap per non-admin user in bytes (default 200 MB). */
export const MAX_USER_UPLOAD_BYTES =
  Number(process.env.MAX_USER_UPLOAD_BYTES) > 0
    ? Number(process.env.MAX_USER_UPLOAD_BYTES)
    : 200 * 1024 * 1024;
