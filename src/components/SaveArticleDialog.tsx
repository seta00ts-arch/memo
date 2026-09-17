import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";
import type { Note } from "../types";

function useNotebookName(id: string | null): string | null {
  const notebooks = useStore((s) => s.notebooks);
  if (!id) return null;
  return notebooks.find((n) => n.id === id)?.name ?? null;
}

interface Props {
  defaultNotebookId: string | null;
  /** iOSショートカット等からの共有URL引き継ぎ用。指定時は開いた瞬間に取得を試みる */
  initialUrl?: string;
  initialTitle?: string;
  onClose: () => void;
  onSaved: (noteId: string, notebookId: string | null) => void;
}

type Step = "url" | "duplicate" | "confirm";

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

async function tryFetchArticle(url: string): Promise<{ title: string; body: string } | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const title = doc.querySelector("title")?.textContent?.trim() || "";
    doc.querySelectorAll("script,style,nav,header,footer,noscript").forEach((el) => el.remove());
    const bodyText = (doc.body?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
    if (!bodyText) return null;
    return { title, body: bodyText };
  } catch {
    return null;
  }
}

export default function SaveArticleDialog({
  defaultNotebookId,
  initialUrl,
  initialTitle,
  onClose,
  onSaved,
}: Props) {
  const notes = useStore((s) => s.notes);
  const createNote = useStore((s) => s.createNote);
  const notebookName = useNotebookName(defaultNotebookId);
  const [step, setStep] = useState<Step>("url");
  const [url, setUrl] = useState(initialUrl ?? "");
  const [title, setTitle] = useState(initialTitle ?? "");
  const [body, setBody] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicateNote, setDuplicateNote] = useState<Note | null>(null);

  useEffect(() => {
    if (initialUrl) {
      proceedAfterUrl();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function findDuplicate(): Note | null {
    if (!url.trim()) return null;
    const target = normalizeUrl(url);
    return (
      notes.find((n) => !n.trashed && n.sourceUrl && normalizeUrl(n.sourceUrl) === target) ?? null
    );
  }

  async function proceedAfterUrl() {
    const dup = findDuplicate();
    if (dup) {
      setDuplicateNote(dup);
      setStep("duplicate");
      return;
    }
    await fetchAndGoToConfirm();
  }

  async function fetchAndGoToConfirm() {
    setFetching(true);
    setFetchFailed(false);
    const result = await tryFetchArticle(url);
    setFetching(false);
    if (result) {
      setTitle(result.title);
      setBody(result.body);
    } else {
      setFetchFailed(true);
    }
    setStep("confirm");
  }

  function handleSkipToPaste() {
    const dup = findDuplicate();
    if (dup) {
      setDuplicateNote(dup);
      setStep("duplicate");
      return;
    }
    setFetchFailed(false);
    setStep("confirm");
  }

  async function handleSave() {
    setSaving(true);
    try {
      const note = await createNote({
        type: "article",
        title: title.trim() || url || "無題の記事",
        body,
        sourceUrl: url || undefined,
        notebookId: defaultNotebookId,
      });
      onSaved(note.id, defaultNotebookId);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>記事を保存</h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        {notebookName ? (
          <p className="muted small">保存先: {notebookName}</p>
        ) : (
          <p className="muted small">保存先: 未整理</p>
        )}

        {step === "url" && (
          <div className="modal-body">
            <label className="field">
              <span>URL</span>
              <input
                autoFocus
                type="url"
                value={url}
                placeholder="https://example.com/article"
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <p className="muted small">
              本文の自動取得は、記事サイトがブラウザからの読み取りを許可している場合のみ成功します。
              ログインが必要な記事や取得制限のあるサイトでは、本文を貼り付けてください。
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={handleSkipToPaste}>
                貼り付けで入力する
              </button>
              <button className="btn btn-primary" disabled={!url || fetching} onClick={proceedAfterUrl}>
                {fetching ? "取得中…" : "本文の取得を試す"}
              </button>
            </div>
          </div>
        )}

        {step === "duplicate" && duplicateNote && (
          <div className="modal-body">
            <p>
              同じURLのノートが既にあります：<br />
              <strong>{duplicateNote.title || "無題"}</strong>
            </p>
            <p className="muted small">開いて確認するか、別の版として新しく保存できます。</p>
            <div className="modal-actions">
              <button className="btn" onClick={fetchAndGoToConfirm}>
                別の版として保存する
              </button>
              <button
                className="btn btn-primary"
                onClick={() => onSaved(duplicateNote.id, duplicateNote.notebookId ?? null)}
              >
                既存のノートを開く
              </button>
            </div>
          </div>
        )}

        {step === "confirm" && (
          <div className="modal-body">
            {fetchFailed && (
              <p className="error-text">
                本文を自動取得できませんでした。タイトルと本文を貼り付けて保存してください。
              </p>
            )}
            <label className="field">
              <span>タイトル</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="記事タイトル" />
            </label>
            <label className="field">
              <span>本文</span>
              <textarea
                className="body-textarea"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="本文を貼り付け、またはMarkdownで入力…"
              />
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setStep("url")}>
                戻る
              </button>
              <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? "保存中…" : `${notebookName ?? "未整理"}へ保存`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
