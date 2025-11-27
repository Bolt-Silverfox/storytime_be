/**
 * Small avatar helper utilities.
 * Keep logic centralized: if avatar row exists return url, otherwise null or placeholder.
 */

export function getAvatarUrlFromUser(user: any): string | null {
  if (!user) return null;
  if (user.avatar && typeof user.avatar.url === 'string') {
    return user.avatar.url;
  }
  // fallback: if you have a field avatarUrl on user (legacy), return it
  if (user.avatarUrl) return user.avatarUrl;
  return null;
}

/**
 * Build a minimal avatar info object for responses
 */
export function buildAvatarInfo(user: any) {
  if (!user) return null;
  if (user.avatar) {
    return {
      id: user.avatar.id,
      url: user.avatar.url,
      isSystemAvatar: !!user.avatar.isSystemAvatar,
    };
  }
  return null;
}
