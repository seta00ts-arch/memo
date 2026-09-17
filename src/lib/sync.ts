// 同期エンジン: ローカル(IndexedDB)とpCloudの専用フォルダの間でノート・履歴・添付・
// ノートブックをやり取りする。仕様書の方針どおり、通信に失敗してもローカルのデータは
// 一切消さない（アップロード/ダウンロードいずれかの失敗は例外として呼び出し側に伝えるのみ）。

import { getDB } from "../db";
import { useStore } from "../store/useStore";
import type { Note, HistoryEntry, Notebook, Tombstone } from "../types";
import {
  getStoredAuth,
  ensureAppFolder,
  createFolderIfNotExists,
  listFolder,
  uploadJson,
  uploadBlob,
  downloadJson,
  downloadBlob,
  type PCloudAuth,
} from "./pcloud";

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
}

function requireAuth(): PCloudAuth {
  const auth = getStoredAuth();
  if (!auth) throw new Error("pCloudに未接続です。設定画面から接続してください。");
  return auth;
}

export async function syncAll(): Promise<SyncResult> {
  const auth = requireAuth();
  const folder = await ensureAppFolder(auth);
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
  };

  const store = useStore.getState();
  const localNotes = await db.getAll("notes");
  const localNotebooks = await db.getAll("notebooks");
  const localTombstoneIds = await store.getTombstoneIds();

  // ---- アップロード ----
  const remoteNoteNames = new Set((await listFolder(auth, `${folder}/notes`)).map((e) => e.name));
  for (const note of localNotes) {
    await uploadJson(auth, `${folder}/notes`, `${note.id}.json`, note);
    result.uploadedNotes++;

    const histFolderPath = `${folder}/history/${note.id}`;
    await createFolderIfNotExists(auth, histFolderPath);
    const remoteHistNames = new Set((await listFolder(auth, histFolderPath)).map((e) => e.name));
    const localHistory = await db.getAllFromIndex("history", "noteId", note.id);
    for (const h of localHistory) {
      const filename = `${h.id}.json`;
      if (remoteHistNames.has(filename)) continue; // 履歴は不変なので既存なら再送しない
      await uploadJson(auth, histFolderPath, filename, h);
      result.uploadedHistory++;
    }

    if (note.attachmentIds.length) {
      const remoteAttNames = new Set((await listFolder(auth, `${folder}/attachments`)).map((e) => e.name));
      for (const attId of note.attachmentIds) {
        const att = await db.get("attachments", attId);
        if (!att) continue;
        const filename = `${att.id}__${att.filename}`;
        if (remoteAttNames.has(filename)) continue;
        await uploadBlob(auth, `${folder}/attachments`, filename, att.data);
        result.uploadedAttachments++;
      }
    }
  }
  void remoteNoteNames; // 将来的な差分検出用に取得のみ行っている

  // ノートブックはノートと同様にID単位のファイルとして同期する（単一blobだと
  // 他端末のリネーム・削除が正しく伝わらないため）。
  for (const nb of localNotebooks) {
    await uploadJson(auth, `${folder}/notebooks`, `${nb.id}.json`, nb);
    result.uploadedNotebooks++;
  }

  // 完全削除の伝播: ローカルの削除マーカーをアップロードする。他端末が同じノートを
  // ダウンロードで復活させないよう、ノートのダウンロードより前に処理する。
  const deletedFolderPath = `${folder}/deleted`;
  if (localTombstoneIds.size) {
    const remoteTombstoneNames = new Set((await listFolder(auth, deletedFolderPath)).map((e) => e.name));
    for (const id of localTombstoneIds) {
      const filename = `${id}.json`;
      if (remoteTombstoneNames.has(filename)) continue;
      const tombstone = await db.get("tombstones", id);
      if (!tombstone) continue;
      await uploadJson(auth, deletedFolderPath, filename, tombstone);
      result.uploadedDeletions++;
    }
  }

  // 完全削除の伝播: 他端末発の削除マーカーを取り込む（まだローカルに残っているノートは削除する）
  const remoteTombstoneEntries = await listFolder(auth, deletedFolderPath);
  for (const entry of remoteTombstoneEntries) {
    if (entry.isfolder || !entry.name.endsWith(".json")) continue;
    const id = entry.name.replace(/\.json$/, "");
    if (localTombstoneIds.has(id)) continue;
    const tombstone = await downloadJson<Tombstone>(auth, `${deletedFolderPath}/${entry.name}`);
    await store.importTombstone(tombstone);
    result.downloadedDeletions++;
  }

  // ---- ダウンロード ----
  const remoteNoteEntries = await listFolder(auth, `${folder}/notes`);
  for (const entry of remoteNoteEntries) {
    if (entry.isfolder || !entry.name.endsWith(".json")) continue;
    const remoteNote = await downloadJson<Note>(auth, `${folder}/notes/${entry.name}`);

    const histFolderPath = `${folder}/history/${remoteNote.id}`;
    let remoteHistory: HistoryEntry[] = [];
    try {
      const histEntries = await listFolder(auth, histFolderPath);
      remoteHistory = await Promise.all(
        histEntries
          .filter((e) => !e.isfolder && e.name.endsWith(".json"))
          .map((e) => downloadJson<HistoryEntry>(auth, `${histFolderPath}/${e.name}`))
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
        const existing = await db.get("attachments", attId);
        if (existing) continue;
        const remoteAttEntries = await listFolder(auth, `${folder}/attachments`);
        const match = remoteAttEntries.find((e) => e.name.startsWith(`${attId}__`));
        if (!match) continue;
        const blob = await downloadBlob(auth, `${folder}/attachments/${match.name}`);
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
      }
    }
  }

  const remoteNotebookEntries = await listFolder(auth, `${folder}/notebooks`);
  for (const entry of remoteNotebookEntries) {
    if (entry.isfolder || !entry.name.endsWith(".json")) continue;
    const remoteNotebook = await downloadJson<Notebook>(auth, `${folder}/notebooks/${entry.name}`);
    const before = useStore.getState().notebooks.find((n) => n.id === remoteNotebook.id);
    await store.importNotebook(remoteNotebook);
    if (!before || before.updatedAt < remoteNotebook.updatedAt) result.downloadedNotebooks++;
  }

  await store.updateSettings({ lastSyncAt: new Date().toISOString() });

  return result;
}
