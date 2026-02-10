import { Profile, Kid, User, Avatar } from '@prisma/client';

export interface KidWithAvatar extends Kid {
  avatar?: Avatar | null;
}

export interface KidWithParentProfile extends Kid {
  parent: User & {
    profile: Profile | null;
  };
}

export interface UserWithProfileAndKids extends User {
  profile: Profile | null;
  kids: Kid[];
}

export interface ISettingsRepository {
  // Profile operations
  findProfileByUserId(userId: string): Promise<Profile | null>;
  createProfile(
    userId: string,
    data: { language: string; country: string },
  ): Promise<Profile>;
  updateProfile(
    userId: string,
    data: Partial<
      Pick<
        Profile,
        'explicitContent' | 'maxScreenTimeMins' | 'language' | 'country'
      >
    >,
  ): Promise<Profile>;

  // Kid screen time operations
  findKidById(kidId: string): Promise<Kid | null>;
  findKidWithParentProfile(kidId: string): Promise<KidWithParentProfile | null>;
  updateKidScreenTimeLimit(
    kidId: string,
    limitMins: number | null,
  ): Promise<Kid>;
  findKidsByParentWithAvatar(parentId: string): Promise<KidWithAvatar[]>;
  updateManyKidsScreenTimeLimit(
    parentId: string,
    currentLimit: null,
    newLimit: number,
  ): Promise<{ count: number }>;

  // User operations
  findUserWithProfileAndKids(
    userId: string,
  ): Promise<UserWithProfileAndKids | null>;
  findUserWithProfile(
    userId: string,
  ): Promise<(User & { profile: Profile | null }) | null>;
}

export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY');
