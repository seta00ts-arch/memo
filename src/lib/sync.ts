// 同期エンジン: ローカル(IndexedDB)とpCloudの専用フォルダの間でノート・履歴・添付・
// ノートブックをやり取りする。仕様書の方針どおり、通信に失敗してもローカルのデータは
// 一切消さない（アップロード/ダウンロードいずれかの失敗は例外として呼び出し側に伝えるのみ）。

import { getDB } from "../db";
import { useStore } from "../store/useStore";
import type { Note, HistoryEntry, Notebook, Tombstone, SyncProviderId } from "../types";
import type { StorageProvider, StoredAuth } from "./storageProvider";
import { pcloudProvider } from "./pcloud";
import { dropboxProvider } from "./dropbox";

const PROVIDERS: Record<SyncProviderId, StorageProvider> = {
  pcloud: pcloudProvider,
  dropbox: dropboxProvider,
};

export function getProvider(id: SyncProviderId): StorageProvider {
  return PROVIDERS[id];
}

export function getAllProviders(): StorageProvider[] {
  return Object.values(PROVIDERS);
}

export interface SyncResult {
  uploadedNotes: number;
  uploadedHistory: number;
  uploadedAttachments: number;
  uploadedNotebooks: number;
  uploadedDeletions: number;
  downloadedNotes: number;
  downloadedAttachments: number;
  downloadedNotebooks: number;
  downloadedDeletions: number;
  conflicts: number;
  /** 個別アイテムの通信エラー一覧。ここに何か入っていても、他のアイテムの同期は続行済み。 */
  errors: string[];
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function requireAuth(provider: StorageProvider): StoredAuth {
  const auth = provider.getStoredAuth();
  if (!auth) throw new Error(`${provider.label}に未接続です。設定画面から接続してください。`);
  return auth;
}

export async function syncAll(providerId: SyncProviderId): Promise<SyncResult> {
  const provider = getProvider(providerId);
  const auth = requireAuth(provider);
  const folder = await provider.ensureAppFolder(auth);
  const db = await getDB();

  const result: SyncResult = {
    uploadedNotes: 0,
    uploadedHistory: 0,
    uploadedAttachments: 0,
    uploadedNotebooks: 0,
    uploadedDeletions: 0,
    downloadedNotes: 0,
    downloadedAttachments: 0,
    downloadedNotebooks: 0,
    downloadedDeletions: 0,
    conflicts: 0,
    errors: [],
  };

  const store = useStore.getState();
  const localTombstoneIds = await store.getTombstoneIds();

  // 完全削除の伝播: ローカルの削除マーカーをアップロードする。他端末が同じノートを
  // ダウンロードで復活させないよう、ノートのダウンロードより前に処理する。
  const deletedFolderPath = `${folder}/deleted`;
  if (localTombstoneIds.size) {
    const remoteTombstoneNames = new Set((await provider.listFolder(auth, deletedFolderPath)).map((e) => e.name));
    for (const id of localTombstoneIds) {
      const filename = `${id}.json`;
      if (remoteTombstoneNames.has(filename)) continue;
      try {
        const tombstone = await db.get("tombstones", id);
        if (!tombstone) continue;
        await provider.uploadJson(auth, deletedFolderPath, filename, tombstone);
        result.uploadedDeletions++;
      } catch (e) {
        result.errors.push(`削除マーカー送信失敗（${id}）: ${describeError(e)}`);
      }
    }
  }

  // 完全削除の伝播: 他端末発の削除マーカーを取り込む（まだローカルに残っているノートは削除する）
  const remoteTombstoneEntries = await provider.listFolder(auth, deletedFolderPath);
  for (const entry of remoteTombstoneEntries) {
    if (entry.isfolder || !entry.name.endsWith(".json")) continue;
    const id = entry.name.replace(/\.json$/, "");
    if (localTombstoneIds.has(id)) continue;
    try {
      const tombstone = await provider.downloadJson<Tombstone>(auth, `${deletedFolderPath}/${entry.name}`);
      await store.importTombstone(tombstone);
      result.downloadedDeletions++;
    } catch (e) {
      result.errors.push(`削除マーカー受信失敗（${id}）: ${describeError(e)}`);
    }
  }

  // ---- ダウンロード（マージ）----
  // アップロードより先に行う。先にアップロードしてしまうと、他端末の競合する編集を
  // 確認する前に自分の版でリモートを上書きしてしまい、「競合時は両方の版を残す」が
  // 機能しなくなるため（常に後からsyncした端末が勝ってしまう）。
  const remoteNoteEntries = await provider.listFolder(auth, `${folder}/notes`);
  for (const entry of remoteNoteEntries) {
    if (entry.isfolder || !entry.name.endsWith(".json")) continue;
    try {
      const remoteNote = await provider.downloadJson<Note>(auth, `${folder}/notes/${entry.name}`);

      const histFolderPath = `${folder}/history/${remoteNote.id}`;
      let remoteHistory: HistoryEntry[] = [];
      try {
        const histEntries = await provider.listFolder(auth, histFolderPath);
        remoteHistory = await Promise.all(
          histEntries
            .filter((e) => !e.isfolder && e.name.endsWith(".json"))
            .map((e) => provider.downloadJson<HistoryEntry>(auth, `${histFolderPath}/${e.name}`))
        );
      } catch {
        remoteHistory = [];
      }

      const outcome = await store.importRemoteNote(remoteNote, remoteHistory);
      if (outcome === "applied") result.downloadedNotes++;
      if (outcome === "conflict-kept-both") {
        result.downloadedNotes++;
        result.conflicts++;
      }

      if (remoteNote.attachmentIds.length) {
        for (const attId of remoteNote.attachmentIds) {
          try {
            const existing = await db.get("attachments", attId);
            if (existing) continue;
            const remoteAttEntries = await provider.listFolder(auth, `${folder}/attachments`);
            const match = remoteAttEntries.find((e) => e.name.startsWith(`${attId}__`));
            if (!match) continue;
            const blob = await provider.downloadBlob(auth, `${folder}/attachments/${match.name}`);
            await store.importAttachment({
              id: attId,
              noteId: remoteNote.id,
              filename: match.name.slice(attId.length + 2),
              mimeType: blob.type,
              size: blob.size,
              data: blob,
              createdAt: new Date().toISOString(),
            });
            result.downloadedAttachments++;
          } catch (e) {
            result.errors.push(`添付受信失敗（${attId}）: ${describeError(e)}`);
          }
        }
      }
    } catch (e) {
      result.errors.push(`ノート受信失敗（${entry.name}）: ${describeError(e)}`);
    }
  }

  const remoteNotebookEntries = await provider.listFolder(auth, `${folder}/notebooks`);
  for (const entry of remoteNotebookEntries) {
    if (entry.isfolder || !entry.name.endsWith(".json")) continue;
    try {
      const remoteNotebook = await provider.downloadJson<Notebook>(auth, `${folder}/notebooks/${entry.name}`);
      const before = useStore.getState().notebooks.find((n) => n.id === remoteNotebook.id);
      await store.importNotebook(remoteNotebook);
      if (!before || before.updatedAt < remoteNotebook.updatedAt) result.downloadedNotebooks++;
    } catch (e) {
      result.errors.push(`ノートブック受信失敗（${entry.name}）: ${describeError(e)}`);
    }
  }

  // ---- アップロード ----
  // ダウンロード（マージ）の後に行う。これにより、ローカルにしかない新規ノート・
  // リモートに追いついただけのノートに加え、競合検出でこの端末側に新しく複製された
  // 「競合版」ノートも、ここでまとめてリモートへ反映される。
  const localNotes = await db.getAll("notes");
  const localNotebooks = await db.getAll("notebooks");

  for (const note of localNotes) {
    try {
      await provider.uploadJson(auth, `${folder}/notes`, `${note.id}.json`, note);
      result.uploadedNotes++;

      const histFolderPath = `${folder}/history/${note.id}`;
      await provider.createFolderIfNotExists(auth, histFolderPath);
      const remoteHistNames = new Set((await provider.listFolder(auth, histFolderPath)).map((e) => e.name));
      const localHistory = await db.getAllFromIndex("history", "noteId", note.id);
      for (const h of localHistory) {
        const filename = `${h.id}.json`;
        if (remoteHistNames.has(filename)) continue; // 履歴は不変なので既存なら再送しない
        try {
          await provider.uploadJson(auth, histFolderPath, filename, h);
          result.uploadedHistory++;
        } catch (e) {
          result.errors.push(`履歴送信失敗（${note.title || note.id}）: ${describeError(e)}`);
        }
      }

      if (note.attachmentIds.length) {
        const remoteAttNames = new Set((await provider.listFolder(auth, `${folder}/attachments`)).map((e) => e.name));
        for (const attId of note.attachmentIds) {
          try {
            const att = await db.get("attachments", attId);
            if (!att) continue;
            const filename = `${att.id}__${att.filename}`;
            if (remoteAttNames.has(filename)) continue;
            await provider.uploadBlob(auth, `${folder}/attachments`, filename, att.data);
            result.uploadedAttachments++;
          } catch (e) {
            result.errors.push(`添付送信失敗（${attId}）: ${describeError(e)}`);
          }
        }
      }
    } catch (e) {
      result.errors.push(`ノート送信失敗（${note.title || note.id}）: ${describeError(e)}`);
    }
  }

  // ノートブックはノートと同様にID単位のファイルとして同期する（単一blobだと
  // 他端末のリネーム・削除が正しく伝わらないため）。
  for (const nb of localNotebooks) {
    try {
      await provider.uploadJson(auth, `${folder}/notebooks`, `${nb.id}.json`, nb);
      result.uploadedNotebooks++;
    } catch (e) {
      result.errors.push(`ノートブック送信失敗（${nb.name}）: ${describeError(e)}`);
    }
  }

  await store.updateSettings({ lastSyncAt: new Date().toISOString() });

  return result;
}
