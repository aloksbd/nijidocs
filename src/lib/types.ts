export type Meta = {
  name: string;
  slug: string;            // permanent ID, set at creation
  belongsTo?: string;      // whose document it is (may differ from uploader)
  docNumber?: string;
  expiry?: string;         // yyyy-mm-dd
  ocrText?: string;
  files: { name: string; mime: string; size: number }[];
  createdAt: string;
};

export type DocEntry = {
  id: string;
  ownerId: string;
  pageCount: number;
  contentHmac: string;
  slugHmac: string;
  createdAt: string;
  updatedAt: string;
  key: CryptoKey;          // document key (in memory only)
  meta: Meta;
  groupIds: string[];      // groups this doc is shared with (that I can see)
};

export type Group = {
  id: string; name: string; ownerId: string; isDefault: boolean; key: CryptoKey; role: "owner" | "member";
};
export type Folder = { id: string; name: string; ownerId: string | null; groupId: string | null };
export type FolderItem = { folderId: string; documentId: string };
export type PrintShare = {
  id: string; document_id: string; created_by: string; status: "active" | "requested" | "revoked";
  expires_at: string; request_count: number; last_opened_at: string | null; created_at: string;
};
