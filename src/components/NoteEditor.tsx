import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import type { Note } from "../types";
import { renderMarkdown, TOOLBAR_ACTIONS } from "../lib/markdown";
import { noteToMarkdown, downloadBlob } from "../lib/backup";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";
import AttachmentList from "./AttachmentList";
import HistoryPanel from "./HistoryPanel";

interface Props {
  note: Note | null;
  onBack: () => void;
  onDeleted: () => void;
}

export default function NoteEditor({ note, onBack, onDeleted }: Props) {
  const updateNote = useStore((s) => s.updateNote);
  const trashNote = useStore((s) => s.trashNote);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const notebooks = useStore((s) => s.notebooks);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [notebookId, setNotebookId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setBody(note.body);
      setSourceUrl(note.sourceUrl ?? "");
      setTagsInput(note.tags.join(", "));
      setNotebookId(note.notebookId ?? null);
      setShowHistory(false);
    }
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function parseTags(input: string): string[] {
    return Array.from(
      new Set(
        input
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      )
    );
  }

  // フィールドごとに個別のタイマーを持つと、短時間に複数項目を編集した際に
  // 後発の保存が先発の保存を打ち消してしまう（例: タイトル入力直後に本文を編集すると
  // タイトルの変更が失われる）。そのため、常に「その時点の最新の全項目」をまとめて
  // 保存する単一のデバウンス関数を使う。
  const debouncedSave = useDebouncedCallback(() => {
    if (!note) return;
    updateNote(note.id, { title, body, sourceUrl, notebookId, tags: parseTags(tagsInput) });
  }, 600);

  if (!note) {
    return (
      <section className="note-editor note-editor--empty">
        <p className="muted">ノートを選択してください</p>
      </section>
    );
  }

  function applyToolbarAction(actionIndex: number) {
    const ta = textareaRef.current;
    const action = TOOLBAR_ACTIONS[actionIndex];
    if (!ta) {
      const result = action.apply(body, body.length, body.length);
      setBody(result.text);
      debouncedSave();
      return;
    }
    const result = action.apply(body, ta.selectionStart, ta.selectionEnd);
    setBody(result.text);
    debouncedSave();
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(result.selStart, result.selEnd);
    });
  }

  return (
    <section className="note-editor">
      <div className="note-editor-header">
        <button className="icon-btn back-btn" onClick={onBack} aria-label="一覧に戻る">
          ←
        </button>
        <input
          className="title-input"
          value={title}
          placeholder="無題"
          onChange={(e) => {
            setTitle(e.target.value);
            debouncedSave();
          }}
        />
        <button
          className={`icon-btn ${note.favorite ? "favorite-on" : ""}`}
          title="お気に入り"
          onClick={() => toggleFavorite(note.id)}
        >
          {note.favorite ? "★" : "☆"}
        </button>
      </div>

      <div className="note-editor-fields">
        <label className="field">
          <span>出典URL</span>
          <input
            type="url"
            value={sourceUrl}
            placeholder="https://…"
            onChange={(e) => {
              setSourceUrl(e.target.value);
              debouncedSave();
            }}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>ノートブック</span>
            <select
              value={notebookId ?? ""}
              onChange={(e) => {
                const value = e.target.value || null;
                setNotebookId(value);
                debouncedSave();
              }}
            >
              <option value="">受信箱</option>
              {notebooks.map((nb) => (
                <option key={nb.id} value={nb.id}>
                  {nb.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field field-grow">
            <span>タグ（カンマ区切り）</span>
            <input
              value={tagsInput}
              onChange={(e) => {
                setTagsInput(e.target.value);
                debouncedSave();
              }}
            />
          </label>
        </div>
      </div>

      <div className="editor-toolbar">
        {TOOLBAR_ACTIONS.map((a, i) => (
          <button key={a.label} title={a.title} onClick={() => applyToolbarAction(i)}>
            {a.label}
          </button>
        ))}
        <span className="spacer" />
        <button className={!showPreview ? "active" : ""} onClick={() => setShowPreview(false)}>
          編集
        </button>
        <button className={showPreview ? "active" : ""} onClick={() => setShowPreview(true)}>
          プレビュー
        </button>
      </div>

      {showPreview ? (
        <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
      ) : (
        <textarea
          ref={textareaRef}
          className="body-textarea"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            debouncedSave();
          }}
          placeholder="本文をMarkdownで入力…"
        />
      )}

      <AttachmentList noteId={note.id} />

      <div className="note-editor-footer">
        <button
          className="link-btn"
          onClick={() => downloadBlob(new Blob([noteToMarkdown(note)], { type: "text/markdown" }), `${note.title || "note"}.md`)}
        >
          Markdownで書き出す
        </button>
        <button className="link-btn" onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? "履歴を閉じる" : "履歴を見る"}
        </button>
        <button
          className="link-btn danger"
          onClick={async () => {
            await trashNote(note.id);
            onDeleted();
          }}
        >
          ゴミ箱へ移動
        </button>
      </div>

      {showHistory && (
        <div className="history-panel">
          <HistoryPanel noteId={note.id} onRestored={() => setShowHistory(false)} />
        </div>
      )}

      {note.refNoteIds && note.refNoteIds.length > 0 && (
        <p className="muted ref-note-hint">このノートは{note.refNoteIds.length}件のノートを参照するまとめノートです</p>
      )}
    </section>
  );
}
