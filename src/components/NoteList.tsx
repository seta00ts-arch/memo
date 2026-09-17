import { useMemo, useState } from "react";
import { useStore } from "../store/useStore";
import type { ViewFilter } from "../viewTypes";
import type { Note } from "../types";

interface Props {
  view: ViewFilter;
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  onSaveArticle: () => void;
  onNewMemo: () => void;
}

function viewTitle(view: ViewFilter): string {
  switch (view.kind) {
    case "inbox":
      return "未整理";
    case "all":
      return "すべてのノート";
    case "favorites":
      return "お気に入り";
    case "notebook":
      return view.name;
    case "tag":
      return `#${view.tag}`;
    default:
      return "";
  }
}

function matchesView(note: Note, view: ViewFilter): boolean {
  if (note.trashed) return false;
  switch (view.kind) {
    case "inbox":
      return !note.notebookId;
    case "all":
      return true;
    case "favorites":
      return note.favorite;
    case "notebook":
      return note.notebookId === view.id;
    case "tag":
      return note.tags.includes(view.tag);
    default:
      return false;
  }
}

function matchesQuery(note: Note, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    note.title.toLowerCase().includes(q) ||
    note.body.toLowerCase().includes(q) ||
    (note.sourceUrl?.toLowerCase().includes(q) ?? false) ||
    note.tags.some((t) => t.toLowerCase().includes(q))
  );
}

function excerpt(body: string): string {
  const plain = body.replace(/[#*_`>[\]!-]/g, " ").replace(/\s+/g, " ").trim();
  return plain.slice(0, 80);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function NoteList({ view, selectedNoteId, onSelectNote, onSaveArticle, onNewMemo }: Props) {
  const notes = useStore((s) => s.notes);
  const mergeNotes = useStore((s) => s.mergeNotes);
  const [query, setQuery] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCreateMenu, setShowCreateMenu] = useState(false);

  const filtered = useMemo(() => {
    return notes
      .filter((n) => matchesView(n, view) && matchesQuery(n, query))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [notes, view, query]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleMerge() {
    if (selected.size < 2) return;
    const title = window.prompt("まとめノートのタイトル", "まとめノート");
    if (!title) return;
    const note = await mergeNotes(Array.from(selected), title);
    setSelectMode(false);
    setSelected(new Set());
    onSelectNote(note.id);
  }

  return (
    <section className="note-list">
      <div className="note-list-header">
        <h2>{viewTitle(view)}</h2>
        <div className="note-list-header-actions">
          <div className="create-menu-wrap">
            <button
              className="icon-btn"
              title="新規作成"
              aria-label="新規作成"
              onClick={() => setShowCreateMenu((v) => !v)}
            >
              ＋
            </button>
            {showCreateMenu && (
              <div className="create-menu" onMouseLeave={() => setShowCreateMenu(false)}>
                <button
                  onClick={() => {
                    setShowCreateMenu(false);
                    onSaveArticle();
                  }}
                >
                  記事を保存
                </button>
                <button
                  onClick={() => {
                    setShowCreateMenu(false);
                    onNewMemo();
                  }}
                >
                  新規メモ
                </button>
              </div>
            )}
          </div>
          <button className="link-btn" onClick={() => setSelectMode((v) => !v)}>
            {selectMode ? "キャンセル" : "選択"}
          </button>
        </div>
      </div>
      <input
        className="search-input"
        type="search"
        placeholder="タイトル・本文・タグを検索"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {selectMode && (
        <div className="select-toolbar">
          <span>{selected.size}件選択中</span>
          <button className="btn btn-primary" disabled={selected.size < 2} onClick={handleMerge}>
            まとめる
          </button>
        </div>
      )}

      <ul className="note-list-items">
        {filtered.length === 0 && <li className="empty-state">ノートがありません</li>}
        {filtered.map((n) => (
          <li key={n.id} className={n.id === selectedNoteId ? "selected" : ""}>
            {selectMode && (
              <input
                type="checkbox"
                checked={selected.has(n.id)}
                onChange={() => toggleSelect(n.id)}
                aria-label={`${n.title}を選択`}
              />
            )}
            <button className="note-item" onClick={() => onSelectNote(n.id)}>
              <div className="note-item-title">
                {n.favorite && <span className="star">★</span>}
                {n.title || "無題"}
              </div>
              <div className="note-item-excerpt">{excerpt(n.body)}</div>
              <div className="note-item-meta">
                <span>{formatDate(n.updatedAt)}</span>
                {n.type === "article" && <span className="badge">記事</span>}
                {n.type === "summary" && <span className="badge">まとめ</span>}
                {n.tags.map((t) => (
                  <span key={t} className="badge badge-tag">
                    #{t}
                  </span>
                ))}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
