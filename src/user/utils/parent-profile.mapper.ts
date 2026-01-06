/**
 * Map Prisma User -> Parent profile DTO / response
 */

export function mapParentProfile(user: any) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    title: user.title ?? null,
    name: user.name ?? null,
    avatar: user.avatar
      ? {
        id: user.avatar.id,
        url: user.avatar.url,
        isSystemAvatar: !!user.avatar.isSystemAvatar,
      }
      : null,
    profile: user.profile
      ? {
        explicitContent: user.profile.explicitContent,
        maxScreenTimeMins: user.profile.maxScreenTimeMins,
        language: user.profile.language,
        country: user.profile.country,
      }
      : null,
    role: user.role,
    numberOfKids: Array.isArray(user.kids) ? user.kids.length : 0,
    pinSet: !!user.pinHash,
    biometricsEnabled: !!user.biometricsEnabled,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
