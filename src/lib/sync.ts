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

// 同時実行数を絞りつつ並列実行する。クラウドAPIのレイテンシ（1件ごとの往復時間）が
// 同期時間の大半を占めるため、直列実行よりも大幅に速くなる。数を絞るのは、
// レート制限（特にDropbox）に配慮するため。
const CONCURRENCY = 4;

async function runConcurrently<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function runNext(): Promise<void> {
    const i = index++;
    if (i >= items.length) return;
    await worker(items[i]);
    await runNext();
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, runNext));
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
    const idsToUpload = Array.from(localTombstoneIds).filter((id) => !remoteTombstoneNames.has(`${id}.json`));
    await runConcurrently(idsToUpload, async (id) => {
      const filename = `${id}.json`;
      try {
        const tombstone = await db.get("tombstones", id);
        if (!tombstone) return;
        await provider.uploadJson(auth, deletedFolderPath, filename, tombstone);
        result.uploadedDeletions++;
      } catch (e) {
        result.errors.push(`削除マーカー送信失敗（${id}）: ${describeError(e)}`);
      }
    });
  }

  // 完全削除の伝播: 他端末発の削除マーカーを取り込む（まだローカルに残っているノートは削除する）
  const remoteTombstoneEntries = await provider.listFolder(auth, deletedFolderPath);
  const tombstonesToDownload = remoteTombstoneEntries.filter(
    (entry) => !entry.isfolder && entry.name.endsWith(".json") && !localTombstoneIds.has(entry.name.replace(/\.json$/, ""))
  );
  await runConcurrently(tombstonesToDownload, async (entry) => {
    const id = entry.name.replace(/\.json$/, "");
    try {
      const tombstone = await provider.downloadJson<Tombstone>(auth, `${deletedFolderPath}/${entry.name}`);
      await store.importTombstone(tombstone);
      result.downloadedDeletions++;
    } catch (e) {
      result.errors.push(`削除マーカー受信失敗（${id}）: ${describeError(e)}`);
    }
  });

  // ---- ダウンロード（マージ）----
  // アップロードより先に行う。先にアップロードしてしまうと、他端末の競合する編集を
  // 確認する前に自分の版でリモートを上書きしてしまい、「競合時は両方の版を残す」が
  // 機能しなくなるため（常に後からsyncした端末が勝ってしまう）。
  const remoteNoteEntries = (await provider.listFolder(auth, `${folder}/notes`)).filter(
    (e) => !e.isfolder && e.name.endsWith(".json")
  );
  // 添付フォルダの一覧はノート1件ごとではなく、同期1回につき1度だけ取得する
  // （以前はノート×添付ごとに毎回フォルダ全体を再取得しており、ノート数・添付数に対して
  // 通信回数が膨れ上がっていた）。
  const remoteAttEntriesForDownload = await provider.listFolder(auth, `${folder}/attachments`);

  await runConcurrently(remoteNoteEntries, async (entry) => {
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
        await runConcurrently(remoteNote.attachmentIds, async (attId) => {
          try {
            const existing = await db.get("attachments", attId);
            if (existing) return;
            const match = remoteAttEntriesForDownload.find((e) => e.name.startsWith(`${attId}__`));
            if (!match) return;
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
        });
      }
    } catch (e) {
      result.errors.push(`ノート受信失敗（${entry.name}）: ${describeError(e)}`);
    }
  });

  const remoteNotebookEntries = (await provider.listFolder(auth, `${folder}/notebooks`)).filter(
    (e) => !e.isfolder && e.name.endsWith(".json")
  );
  await runConcurrently(remoteNotebookEntries, async (entry) => {
    try {
      const remoteNotebook = await provider.downloadJson<Notebook>(auth, `${folder}/notebooks/${entry.name}`);
      const before = useStore.getState().notebooks.find((n) => n.id === remoteNotebook.id);
      await store.importNotebook(remoteNotebook);
      if (!before || before.updatedAt < remoteNotebook.updatedAt) result.downloadedNotebooks++;
    } catch (e) {
      result.errors.push(`ノートブック受信失敗（${entry.name}）: ${describeError(e)}`);
    }
  });

  // ---- アップロード ----
  // ダウンロード（マージ）の後に行う。これにより、ローカルにしかない新規ノート・
  // リモートに追いついただけのノートに加え、競合検出でこの端末側に新しく複製された
  // 「競合版」ノートも、ここでまとめてリモートへ反映される。
  const localNotes = await db.getAll("notes");
  const localNotebooks = await db.getAll("notebooks");

  // ダウンロード側と同様、添付フォルダの一覧は同期1回につき1度だけ取得して使い回す。
  // 同じ同期内でアップロードした添付は都度このSetに追加し、以降のノートでの重複判定に使う。
  const remoteAttNamesForUpload = new Set(
    localNotes.some((n) => n.attachmentIds.length)
      ? (await provider.listFolder(auth, `${folder}/attachments`)).map((e) => e.name)
      : []
  );

  await runConcurrently(localNotes, async (note) => {
    try {
      await provider.uploadJson(auth, `${folder}/notes`, `${note.id}.json`, note);
      result.uploadedNotes++;

      const histFolderPath = `${folder}/history/${note.id}`;
      await provider.createFolderIfNotExists(auth, histFolderPath);
      const remoteHistNames = new Set((await provider.listFolder(auth, histFolderPath)).map((e) => e.name));
      const localHistory = await db.getAllFromIndex("history", "noteId", note.id);
      const historyToUpload = localHistory.filter((h) => !remoteHistNames.has(`${h.id}.json`)); // 履歴は不変なので既存なら再送しない
      await runConcurrently(historyToUpload, async (h) => {
        try {
          await provider.uploadJson(auth, histFolderPath, `${h.id}.json`, h);
          result.uploadedHistory++;
        } catch (e) {
          result.errors.push(`履歴送信失敗（${note.title || note.id}）: ${describeError(e)}`);
        }
      });

      if (note.attachmentIds.length) {
        await runConcurrently(note.attachmentIds, async (attId) => {
          try {
            const att = await db.get("attachments", attId);
            if (!att) return;
            const filename = `${att.id}__${att.filename}`;
            if (remoteAttNamesForUpload.has(filename)) return;
            await provider.uploadBlob(auth, `${folder}/attachments`, filename, att.data);
            remoteAttNamesForUpload.add(filename);
            result.uploadedAttachments++;
          } catch (e) {
            result.errors.push(`添付送信失敗（${attId}）: ${describeError(e)}`);
          }
        });
      }
    } catch (e) {
      result.errors.push(`ノート送信失敗（${note.title || note.id}）: ${describeError(e)}`);
    }
  });

  // ノートブックはノートと同様にID単位のファイルとして同期する（単一blobだと
  // 他端末のリネーム・削除が正しく伝わらないため）。
  await runConcurrently(localNotebooks, async (nb) => {
    try {
      await provider.uploadJson(auth, `${folder}/notebooks`, `${nb.id}.json`, nb);
      result.uploadedNotebooks++;
    } catch (e) {
      result.errors.push(`ノートブック送信失敗（${nb.name}）: ${describeError(e)}`);
    }
  });

  await store.updateSettings({ lastSyncAt: new Date().toISOString() });

  return result;
}
