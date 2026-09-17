// データモデル。仕様書「4 pCloud保存と同期の設計」「保存単位」「データ」節に対応する。

export type NoteType = "article" | "memo" | "summary";

export interface Note {
  id: string;
  type: NoteType;
  title: string;
  body: string; // Markdown
  sourceUrl?: string;
  notebookId?: string | null;
  tags: string[];
  favorite: boolean;
  trashed: boolean;
  trashedAt?: string | null;
  refNoteIds?: string[]; // まとめノートが参照する元ノートID
  createdAt: string;
  updatedAt: string;
  attachmentIds: string[];
  /** このノートが指す最新の履歴ID。競合時は複数の「リーフ」履歴が並存しうる。 */
  currentHistoryId?: string;
  /** 同期状態の記録用。 */
  deviceId: string;
}

export interface Attachment {
  id: string;
  noteId: string;
  filename: string;
  mimeType: string;
  size: number;
  data: Blob;
  createdAt: string;
}

export interface HistoryEntry {
  id: string;
  noteId: string;
  parentHistoryId: string | null;
  timestamp: string;
  deviceId: string;
  snapshot: {
    title: string;
    body: string;
    sourceUrl?: string;
    tags: string[];
    notebookId?: string | null;
  };
}

export interface Notebook {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * 完全削除の同期伝播用マーカー。permanentlyDeleteNote時にローカルへ記録し、
 * 同期時にpCloud側にもアップロードすることで、他端末が同じノートを
 * ダウンロードで復活させてしまわないようにする。
 */
export interface Tombstone {
  id: string; // 削除されたノートのID
  deletedAt: string;
  deviceId: string;
}

export type SyncStatus = "unconnected" | "syncing" | "done" | "failed";

export interface AppSettings {
  id: "settings";
  pcloudClientId?: string;
  pcloudFolderPath?: string; // 専用フォルダ
  deviceId: string;
  lastSyncAt?: string | null;
}

export const ALLOWED_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
] as const;

export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024; // 20MB（F03初期案は5MBだったが、利用者要望により緩和）
