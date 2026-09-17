import { useMemo, useState } from "react";
import { useStore } from "../store/useStore";
import type { ViewFilter } from "../viewTypes";
import { ALLOWED_ATTACHMENT_TYPES } from "../types";

interface Props {
  view: ViewFilter;
  onChangeView: (v: ViewFilter) => void;
  onSaveArticle: () => void;
  onNewMemo: () => void;
  onImportFile: (file: File) => void;
  onClose: () => void;
}

function isSameView(a: ViewFilter, b: ViewFilter): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "notebook" && b.kind === "notebook") return a.id === b.id;
  if (a.kind === "tag" && b.kind === "tag") return a.tag === b.tag;
  return true;
}

export default function Sidebar({ view, onChangeView, onSaveArticle, onNewMemo, onImportFile, onClose }: Props) {
  const notes = useStore((s) => s.notes);
  const notebooks = useStore((s) => s.notebooks);
  const addNotebook = useStore((s) => s.addNotebook);
  const [addingNotebook, setAddingNotebook] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState("");

  const activeNotes = notes.filter((n) => !n.trashed);
  const inboxCount = activeNotes.filter((n) => !n.notebookId).length;
  const favoriteCount = activeNotes.filter((n) => n.favorite).length;
  const trashCount = notes.filter((n) => n.trashed).length;

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const n of activeNotes) for (const t of n.tags) set.add(t);
    return Array.from(set).sort();
  }, [activeNotes]);

  async function handleAddNotebook() {
    const name = newNotebookName.trim();
    if (!name) {
      setAddingNotebook(false);
      return;
    }
    await addNotebook(name);
    setNewNotebookName("");
    setAddingNotebook(false);
  }

  return (
    <nav className="sidebar" aria-label="分類">
      <div className="sidebar-header">
        <span className="app-title">しおり</span>
        <button className="icon-btn sidebar-close-btn" onClick={onClose} aria-label="メニューを閉じる">
          ✕
        </button>
      </div>

      <div className="sidebar-actions">
        <button className="btn btn-primary" onClick={onSaveArticle}>
          記事を保存
        </button>
        <button className="btn" onClick={onNewMemo}>
          新規メモ
        </button>
        <label className="btn">
          ファイルを取り込む
          <input
            type="file"
            hidden
            accept={ALLOWED_ATTACHMENT_TYPES.join(",")}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportFile(file);
              e.target.value = "";
            }}
          />
        </label>
        <p className="muted small sidebar-hint">PDF・画像・テキストを添付した新規ノートを作成します</p>
      </div>

      <ul className="sidebar-list">
        <li>
          <button
            className={isSameView(view, { kind: "inbox" }) ? "active" : ""}
            onClick={() => onChangeView({ kind: "inbox" })}
          >
            未整理 <span className="count">{inboxCount}</span>
          </button>
        </li>
        <li>
          <button
            className={isSameView(view, { kind: "all" }) ? "active" : ""}
            onClick={() => onChangeView({ kind: "all" })}
          >
            すべてのノート <span className="count">{activeNotes.length}</span>
          </button>
        </li>
        <li>
          <button
            className={isSameView(view, { kind: "favorites" }) ? "active" : ""}
            onClick={() => onChangeView({ kind: "favorites" })}
          >
            お気に入り <span className="count">{favoriteCount}</span>
          </button>
        </li>
      </ul>

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>ノートブック</span>
          <button className="icon-btn" title="ノートブックを追加" onClick={() => setAddingNotebook(true)}>
            ＋
          </button>
        </div>
        <ul className="sidebar-list">
          {notebooks.map((nb) => (
            <li key={nb.id}>
              <button
                className={isSameView(view, { kind: "notebook", id: nb.id, name: nb.name }) ? "active" : ""}
                onClick={() => onChangeView({ kind: "notebook", id: nb.id, name: nb.name })}
              >
                {nb.name}
              </button>
            </li>
          ))}
          {addingNotebook && (
            <li>
              <input
                autoFocus
                className="inline-input"
                value={newNotebookName}
                placeholder="ノートブック名"
                onChange={(e) => setNewNotebookName(e.target.value)}
                onBlur={handleAddNotebook}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddNotebook();
                  if (e.key === "Escape") {
                    setAddingNotebook(false);
                    setNewNotebookName("");
                  }
                }}
              />
            </li>
          )}
        </ul>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <button
            className={`sidebar-section-link ${isSameView(view, { kind: "tags" }) ? "active" : ""}`}
            onClick={() => onChangeView({ kind: "tags" })}
          >
            タグ一覧
          </button>
        </div>
        {tags.length > 0 && (
          <ul className="sidebar-list">
            {tags.map((t) => (
              <li key={t}>
                <button
                  className={isSameView(view, { kind: "tag", tag: t }) ? "active" : ""}
                  onClick={() => onChangeView({ kind: "tag", tag: t })}
                >
                  #{t}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sidebar-footer">
        <ul className="sidebar-list">
          <li>
            <button
              className={isSameView(view, { kind: "trash" }) ? "active" : ""}
              onClick={() => onChangeView({ kind: "trash" })}
            >
              ゴミ箱 <span className="count">{trashCount}</span>
            </button>
          </li>
          <li>
            <button
              className={isSameView(view, { kind: "settings" }) ? "active" : ""}
              onClick={() => onChangeView({ kind: "settings" })}
            >
              設定
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
}
