// 持ち出し（バックアップ）機能。F10「持ち出し」に対応する。
// 同期はバックアップと同一ではないため、全データを書き出し・読み戻しできる手段を独立して用意する。

import { getDB } from "../db";
import type { Note, Attachment, HistoryEntry, Notebook, AppSettings } from "../types";

interface BackupFile {
  formatVersion: 1;
  exportedAt: string;
  notes: Note[];
  notebooks: Notebook[];
  history: HistoryEntry[];
  attachments: Array<Omit<Attachment, "data"> & { dataBase64: string }>;
  settings: AppSettings | null;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mimeType });
}

export async function exportFullBackup(): Promise<Blob> {
  const db = await getDB();
  const [notes, notebooks, history, attachments, settings] = await Promise.all([
    db.getAll("notes"),
    db.getAll("notebooks"),
    db.getAll("history"),
    db.getAll("attachments"),
    db.get("settings", "settings"),
  ]);

  const attachmentsEncoded = await Promise.all(
    attachments.map(async (a) => ({
      id: a.id,
      noteId: a.noteId,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      createdAt: a.createdAt,
      dataBase64: await blobToBase64(a.data),
    }))
  );

  const backup: BackupFile = {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    notes,
    notebooks,
    history,
    attachments: attachmentsEncoded,
    settings: settings ?? null,
  };

  return new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
}

export interface ImportSummary {
  notes: number;
  notebooks: number;
  history: number;
  attachments: number;
}

/** バックアップの読み戻し。既存データはIDが一致すれば上書きし、そうでなければ追加する（非破壊的マージ） */
export async function importFullBackup(file: File): Promise<ImportSummary> {
  const text = await file.text();
  const backup = JSON.parse(text) as BackupFile;
  if (backup.formatVersion !== 1) {
    throw new Error("未対応のバックアップ形式です");
  }
  const db = await getDB();

  const notesTx = db.transaction("notes", "readwrite");
  for (const n of backup.notes) await notesTx.store.put(n);
  await notesTx.done;

  const nbTx = db.transaction("notebooks", "readwrite");
  for (const nb of backup.notebooks) await nbTx.store.put(nb);
  await nbTx.done;

  const histTx = db.transaction("history", "readwrite");
  for (const h of backup.history) await histTx.store.put(h);
  await histTx.done;

  const attTx = db.transaction("attachments", "readwrite");
  for (const a of backup.attachments) {
    const attachment: Attachment = {
      id: a.id,
      noteId: a.noteId,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      createdAt: a.createdAt,
      data: base64ToBlob(a.dataBase64, a.mimeType),
    };
    await attTx.store.put(attachment);
  }
  await attTx.done;

  return {
    notes: backup.notes.length,
    notebooks: backup.notebooks.length,
    history: backup.history.length,
    attachments: backup.attachments.length,
  };
}

export function noteToMarkdown(note: Note): string {
  const lines: string[] = [`# ${note.title}`, ""];
  if (note.sourceUrl) {
    lines.push(`出典: ${note.sourceUrl}`, "");
  }
  if (note.tags.length) {
    lines.push(`タグ: ${note.tags.map((t) => `#${t}`).join(" ")}`, "");
  }
  lines.push(`作成日時: ${note.createdAt}`, `更新日時: ${note.updatedAt}`, "", "---", "", note.body);
  return lines.join("\n");
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
