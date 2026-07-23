// ==================== Types ====================
export interface KidId {
  id: string;
}

export interface KidParentId {
  parentId: string;
}

export interface KidName {
  name: string | null;
}

// ==================== Repository Interface ====================
export interface IKidRepository {
  // Find the ids of all kids belonging to a parent
  findIdsByParent(parentId: string): Promise<KidId[]>;

  // Find the parentId of a kid by id
  findParentIdById(kidId: string): Promise<KidParentId | null>;

  // Find the name of a kid by id
  findNameById(kidId: string): Promise<KidName | null>;
}

export const KID_REPOSITORY = Symbol('KID_REPOSITORY');
