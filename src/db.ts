import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Note, Attachment, HistoryEntry, Notebook, AppSettings, Tombstone } from "./types";

interface ShioriDB extends DBSchema {
  notes: {
    key: string;
    value: Note;
    indexes: { updatedAt: string; notebookId: string };
  };
  attachments: {
    key: string;
    value: Attachment;
    indexes: { noteId: string };
  };
  history: {
    key: string;
    value: HistoryEntry;
    indexes: { noteId: string };
  };
  notebooks: {
    key: string;
    value: Notebook;
  };
  settings: {
    key: string;
    value: AppSettings;
  };
  tombstones: {
    key: string;
    value: Tombstone;
  };
}

const DB_NAME = "shiori-db";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<ShioriDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<ShioriDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ShioriDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const notes = db.createObjectStore("notes", { keyPath: "id" });
          notes.createIndex("updatedAt", "updatedAt");
          notes.createIndex("notebookId", "notebookId");

          const attachments = db.createObjectStore("attachments", { keyPath: "id" });
          attachments.createIndex("noteId", "noteId");

          const history = db.createObjectStore("history", { keyPath: "id" });
          history.createIndex("noteId", "noteId");

          db.createObjectStore("notebooks", { keyPath: "id" });
          db.createObjectStore("settings", { keyPath: "id" });
        }
        if (oldVersion < 2) {
          db.createObjectStore("tombstones", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export type { ShioriDB };
