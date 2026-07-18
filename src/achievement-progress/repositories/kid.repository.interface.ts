// ==================== Types ====================
export interface KidId {
  id: string;
}

export interface KidParentId {
  parentId: string;
}

// ==================== Repository Interface ====================
export interface IKidRepository {
  // Find the ids of all kids belonging to a parent
  findIdsByParent(parentId: string): Promise<KidId[]>;

  // Find the parentId of a kid by id
  findParentIdById(kidId: string): Promise<KidParentId | null>;
}

export const KID_REPOSITORY = Symbol('KID_REPOSITORY');
