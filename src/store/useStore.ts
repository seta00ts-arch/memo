import { create } from "zustand";
import { getDB } from "../db";
import { newId, getDeviceId } from "../lib/id";
import type {
  Note,
  Attachment,
  HistoryEntry,
  Notebook,
  AppSettings,
  NoteType,
  Tombstone,
} from "../types";
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_SIZE } from "../types";

function nowIso(): string {
  return new Date().toISOString();
}

interface NewNoteInput {
  type: NoteType;
  title: string;
  body: string;
  sourceUrl?: string;
  notebookId?: string | null;
  tags?: string[];
  refNoteIds?: string[];
}

interface ShioriState {
  notes: Note[];
  notebooks: Notebook[];
  settings: AppSettings | null;
  loaded: boolean;

  init: () => Promise<void>;

  createNote: (input: NewNoteInput) => Promise<Note>;
  updateNote: (
    id: string,
    patch: Partial<Pick<Note, "title" | "body" | "sourceUrl" | "notebookId" | "tags" | "favorite">>
  ) => Promise<void>;
  trashNote: (id: string) => Promise<void>;
  restoreNote: (id: string) => Promise<void>;
  permanentlyDeleteNote: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;

  addAttachment: (noteId: string, file: File) => Promise<Attachment>;
  getAttachments: (noteId: string) => Promise<Attachment[]>;
  removeAttachment: (attachmentId: string) => Promise<void>;

  getHistory: (noteId: string) => Promise<HistoryEntry[]>;
  restoreHistoryAsNewNote: (historyId: string) => Promise<Note>;

  mergeNotes: (noteIds: string[], title: string) => Promise<Note>;

  addNotebook: (name: string) => Promise<Notebook>;
  renameNotebook: (id: string, name: string) => Promise<void>;
  removeNotebook: (id: string) => Promise<void>;

  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;

  /** 同期モジュールから、競合を保ったままリモートのノートを取り込む */
  importRemoteNote: (note: Note, history: HistoryEntry[]) => Promise<"applied" | "conflict-kept-both" | "skipped">;
  /** 同期モジュールから、リモートの添付ファイル実体を取り込む（既存なら上書きしない） */
  importAttachment: (attachment: Attachment) => Promise<void>;
  /** 同期モジュールから、リモートのノートブックを取り込む（未知のものだけ追加） */
  importNotebooks: (notebooks: Notebook[]) => Promise<void>;

  /** 完全削除の同期伝播用。ローカルの削除マーカーID一覧を返す */
  getTombstoneIds: () => Promise<Set<string>>;
  /** 同期モジュールから、他端末発の削除マーカーを取り込む。ローカルにまだ残っていれば削除する */
  importTombstone: (tombstone: Tombstone) => Promise<void>;
}

async function persistHistory(entry: HistoryEntry) {
  const db = await getDB();
  await db.put("history", entry);
}

async function persistNote(note: Note) {
  const db = await getDB();
  await db.put("notes", note);
}

export const useStore = create<ShioriState>((set, get) => ({
  notes: [],
  notebooks: [],
  settings: null,
  loaded: false,

  init: async () => {
    const db = await getDB();
    const [notes, notebooks, settings] = await Promise.all([
      db.getAll("notes"),
      db.getAll("notebooks"),
      db.get("settings", "settings"),
    ]);
    let finalSettings = settings ?? null;
    if (!finalSettings) {
      finalSettings = { id: "settings", deviceId: getDeviceId(), lastSyncAt: null };
      await db.put("settings", finalSettings);
    }
    notes.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    set({ notes, notebooks, settings: finalSettings, loaded: true });
  },

  createNote: async (input) => {
    const deviceId = getDeviceId();
    const id = newId();
    const historyId = newId();
    const ts = nowIso();
    const note: Note = {
      id,
      type: input.type,
      title: input.title,
      body: input.body,
      sourceUrl: input.sourceUrl,
      notebookId: input.notebookId ?? null,
      tags: input.tags ?? [],
      favorite: false,
      trashed: false,
      trashedAt: null,
      refNoteIds: input.refNoteIds ?? [],
      createdAt: ts,
      updatedAt: ts,
      attachmentIds: [],
      currentHistoryId: historyId,
      deviceId,
    };
    const history: HistoryEntry = {
      id: historyId,
      noteId: id,
      parentHistoryId: null,
      timestamp: ts,
      deviceId,
      snapshot: {
        title: note.title,
        body: note.body,
        sourceUrl: note.sourceUrl,
        tags: note.tags,
        notebookId: note.notebookId,
      },
    };
    await persistNote(note);
    await persistHistory(history);
    set((s) => ({ notes: [note, ...s.notes] }));
    return note;
  },

  updateNote: async (id, patch) => {
    const existing = get().notes.find((n) => n.id === id);
    if (!existing) return;
    const deviceId = getDeviceId();
    const ts = nowIso();
    const updated: Note = {
      ...existing,
      ...patch,
      updatedAt: ts,
    };
    const historyId = newId();
    const history: HistoryEntry = {
      id: historyId,
      noteId: id,
      parentHistoryId: existing.currentHistoryId ?? null,
      timestamp: ts,
      deviceId,
      snapshot: {
        title: updated.title,
        body: updated.body,
        sourceUrl: updated.sourceUrl,
        tags: updated.tags,
        notebookId: updated.notebookId,
      },
    };
    updated.currentHistoryId = historyId;
    await persistNote(updated);
    await persistHistory(history);
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? updated : n)) }));
  },

  trashNote: async (id) => {
    const existing = get().notes.find((n) => n.id === id);
    if (!existing) return;
    const updated: Note = { ...existing, trashed: true, trashedAt: nowIso(), updatedAt: nowIso() };
    await persistNote(updated);
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? updated : n)) }));
  },

  restoreNote: async (id) => {
    const existing = get().notes.find((n) => n.id === id);
    if (!existing) return;
    const updated: Note = { ...existing, trashed: false, trashedAt: null, updatedAt: nowIso() };
    await persistNote(updated);
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? updated : n)) }));
  },

  permanentlyDeleteNote: async (id) => {
    const db = await getDB();
    const tx = db.transaction(["notes", "attachments", "history", "tombstones"], "readwrite");
    await tx.objectStore("notes").delete(id);
    const attStore = tx.objectStore("attachments");
    const attIndex = attStore.index("noteId");
    for await (const cursor of attIndex.iterate(id)) {
      await cursor.delete();
    }
    const histStore = tx.objectStore("history");
    const histIndex = histStore.index("noteId");
    for await (const cursor of histIndex.iterate(id)) {
      await cursor.delete();
    }
    // 削除マーカーを残す。同期時にpCloudへも伝え、他端末が同じノートを
    // 再ダウンロードで復活させてしまわないようにする。
    const tombstone: Tombstone = { id, deletedAt: nowIso(), deviceId: getDeviceId() };
    await tx.objectStore("tombstones").put(tombstone);
    await tx.done;
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
  },

  toggleFavorite: async (id) => {
    const existing = get().notes.find((n) => n.id === id);
    if (!existing) return;
    const updated: Note = { ...existing, favorite: !existing.favorite, updatedAt: nowIso() };
    await persistNote(updated);
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? updated : n)) }));
  },

  addAttachment: async (noteId, file) => {
    if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type as (typeof ALLOWED_ATTACHMENT_TYPES)[number])) {
      throw new Error(`未対応の形式です: ${file.type || "unknown"}`);
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      throw new Error(`1ファイル${Math.round(MAX_ATTACHMENT_SIZE / 1024 / 1024)}MBまでです`);
    }
    const attachment: Attachment = {
      id: newId(),
      noteId,
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      data: file,
      createdAt: nowIso(),
    };
    const db = await getDB();
    await db.put("attachments", attachment);
    const note = get().notes.find((n) => n.id === noteId);
    if (note) {
      const updated: Note = {
        ...note,
        attachmentIds: [...note.attachmentIds, attachment.id],
        updatedAt: nowIso(),
      };
      await persistNote(updated);
      set((s) => ({ notes: s.notes.map((n) => (n.id === noteId ? updated : n)) }));
    }
    return attachment;
  },

  getAttachments: async (noteId) => {
    const db = await getDB();
    return db.getAllFromIndex("attachments", "noteId", noteId);
  },

  removeAttachment: async (attachmentId) => {
    const db = await getDB();
    const att = await db.get("attachments", attachmentId);
    if (!att) return;
    await db.delete("attachments", attachmentId);
    const note = get().notes.find((n) => n.id === att.noteId);
    if (note) {
      const updated: Note = {
        ...note,
        attachmentIds: note.attachmentIds.filter((a) => a !== attachmentId),
        updatedAt: nowIso(),
      };
      await persistNote(updated);
      set((s) => ({ notes: s.notes.map((n) => (n.id === note.id ? updated : n)) }));
    }
  },

  getHistory: async (noteId) => {
    const db = await getDB();
    const list = await db.getAllFromIndex("history", "noteId", noteId);
    return list.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  },

  restoreHistoryAsNewNote: async (historyId) => {
    const db = await getDB();
    const entry = await db.get("history", historyId);
    if (!entry) throw new Error("履歴が見つかりません");
    const original = get().notes.find((n) => n.id === entry.noteId);
    return get().createNote({
      type: original?.type ?? "memo",
      title: `${entry.snapshot.title}（履歴から複製）`,
      body: entry.snapshot.body,
      sourceUrl: entry.snapshot.sourceUrl,
      notebookId: entry.snapshot.notebookId,
      tags: entry.snapshot.tags,
    });
  },

  mergeNotes: async (noteIds, title) => {
    const notes = get().notes.filter((n) => noteIds.includes(n.id));
    const parts = notes.map((n) => {
      const link = n.sourceUrl ? `\n\n出典: ${n.sourceUrl}` : "";
      return `## ${n.title}\n\n${n.body}${link}`;
    });
    const body = `<!-- 参照元ノートを残したまとめノート。自分の要点をここに追記してください。 -->\n\n${parts.join("\n\n---\n\n")}`;
    return get().createNote({
      type: "summary",
      title,
      body,
      refNoteIds: noteIds,
    });
  },

  addNotebook: async (name) => {
    const notebook: Notebook = { id: newId(), name, createdAt: nowIso() };
    const db = await getDB();
    await db.put("notebooks", notebook);
    set((s) => ({ notebooks: [...s.notebooks, notebook] }));
    return notebook;
  },

  renameNotebook: async (id, name) => {
    const db = await getDB();
    const nb = await db.get("notebooks", id);
    if (!nb) return;
    const updated = { ...nb, name };
    await db.put("notebooks", updated);
    set((s) => ({ notebooks: s.notebooks.map((n) => (n.id === id ? updated : n)) }));
  },

  removeNotebook: async (id) => {
    const db = await getDB();
    await db.delete("notebooks", id);
    set((s) => ({ notebooks: s.notebooks.filter((n) => n.id !== id) }));
    // このノートブックに属するノートは受信箱扱いに戻す
    const affected = get().notes.filter((n) => n.notebookId === id);
    for (const n of affected) {
      const updated: Note = { ...n, notebookId: null, updatedAt: nowIso() };
      await persistNote(updated);
    }
    if (affected.length) {
      set((s) => ({
        notes: s.notes.map((n) => (n.notebookId === id ? { ...n, notebookId: null } : n)),
      }));
    }
  },

  updateSettings: async (patch) => {
    const current = get().settings ?? { id: "settings", deviceId: getDeviceId(), lastSyncAt: null };
    const updated: AppSettings = { ...current, ...patch };
    const db = await getDB();
    await db.put("settings", updated);
    set({ settings: updated });
  },

  importRemoteNote: async (remote, remoteHistory) => {
    const db = await getDB();

    // 完全削除済みのノートは、リモートに古いコピーが残っていても復活させない。
    const tombstone = await db.get("tombstones", remote.id);
    if (tombstone) return "skipped";

    const local = get().notes.find((n) => n.id === remote.id);

    if (!local) {
      await db.put("notes", remote);
      const tx = db.transaction("history", "readwrite");
      for (const h of remoteHistory) await tx.store.put(h);
      await tx.done;
      set((s) => ({ notes: [remote, ...s.notes] }));
      return "applied";
    }

    if (local.updatedAt === remote.updatedAt && local.currentHistoryId === remote.currentHistoryId) {
      return "skipped";
    }

    // ローカルの履歴チェーンにリモートの履歴が含まれるか確認し、含まれれば単純に前進、
    // 含まれなければ「双方の版を残す」方針に従い、リモート版を別ノートとして複製する。
    const localHistory = await db.getAllFromIndex("history", "noteId", local.id);
    const localIds = new Set(localHistory.map((h) => h.id));
    const remoteIsDescendant = remote.currentHistoryId ? localIds.has(remote.currentHistoryId) : false;

    if (remoteIsDescendant || local.updatedAt < remote.updatedAt && !hasDivergedHistory(localHistory, remoteHistory)) {
      await db.put("notes", remote);
      const tx = db.transaction("history", "readwrite");
      for (const h of remoteHistory) await tx.store.put(h);
      await tx.done;
      set((s) => ({ notes: s.notes.map((n) => (n.id === remote.id ? remote : n)) }));
      return "applied";
    }

    // 競合: リモート版を新しいノートとして複製し、両方を残す
    const conflictNote: Note = {
      ...remote,
      id: newId(),
      title: `${remote.title}（競合版・他端末）`,
      updatedAt: nowIso(),
      createdAt: nowIso(),
    };
    await db.put("notes", conflictNote);
    const tx = db.transaction("history", "readwrite");
    for (const h of remoteHistory) {
      await tx.store.put({ ...h, id: newId(), noteId: conflictNote.id });
    }
    await tx.done;
    set((s) => ({ notes: [conflictNote, ...s.notes] }));
    return "conflict-kept-both";
  },

  importAttachment: async (attachment) => {
    const db = await getDB();
    const existing = await db.get("attachments", attachment.id);
    if (existing) return;
    await db.put("attachments", attachment);
  },

  importNotebooks: async (notebooks) => {
    const db = await getDB();
    const existingIds = new Set(get().notebooks.map((n) => n.id));
    const toAdd = notebooks.filter((n) => !existingIds.has(n.id));
    if (!toAdd.length) return;
    const tx = db.transaction("notebooks", "readwrite");
    for (const nb of toAdd) await tx.store.put(nb);
    await tx.done;
    set((s) => ({ notebooks: [...s.notebooks, ...toAdd] }));
  },

  getTombstoneIds: async () => {
    const db = await getDB();
    const all = await db.getAll("tombstones");
    return new Set(all.map((t) => t.id));
  },

  importTombstone: async (tombstone) => {
    const db = await getDB();
    const existing = await db.get("tombstones", tombstone.id);
    if (!existing) {
      await db.put("tombstones", tombstone);
    }
    const stillLocal = get().notes.find((n) => n.id === tombstone.id);
    if (!stillLocal) return;
    const tx = db.transaction(["notes", "attachments", "history"], "readwrite");
    await tx.objectStore("notes").delete(tombstone.id);
    const attStore = tx.objectStore("attachments");
    const attIndex = attStore.index("noteId");
    for await (const cursor of attIndex.iterate(tombstone.id)) {
      await cursor.delete();
    }
    const histStore = tx.objectStore("history");
    const histIndex = histStore.index("noteId");
    for await (const cursor of histIndex.iterate(tombstone.id)) {
      await cursor.delete();
    }
    await tx.done;
    set((s) => ({ notes: s.notes.filter((n) => n.id !== tombstone.id) }));
  },
}));

function hasDivergedHistory(localHistory: HistoryEntry[], remoteHistory: HistoryEntry[]): boolean {
  const localIds = new Set(localHistory.map((h) => h.id));
  const remoteIds = new Set(remoteHistory.map((h) => h.id));
  // 共通の祖先が一つも無ければ完全な分岐とみなす
  for (const id of localIds) {
    if (remoteIds.has(id)) return false;
  }
  return localHistory.length > 0 && remoteHistory.length > 0;
}
