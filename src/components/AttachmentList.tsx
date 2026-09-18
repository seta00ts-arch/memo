import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store/useStore";
import type { Attachment } from "../types";
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_SIZE } from "../types";
import AttachmentViewer from "./AttachmentViewer";

interface Props {
  noteId: string;
}

export default function AttachmentList({ noteId }: Props) {
  const getAttachments = useStore((s) => s.getAttachments);
  const addAttachment = useStore((s) => s.addAttachment);
  const removeAttachment = useStore((s) => s.removeAttachment);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Attachment | null>(null);

  async function refresh() {
    setAttachments(await getAttachments(noteId));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  const urls = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of attachments) map.set(a.id, URL.createObjectURL(a.data));
    return map;
  }, [attachments]);

  useEffect(() => {
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, [urls]);

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    setError(null);
    for (const file of Array.from(files)) {
      try {
        await addAttachment(noteId, file);
      } catch (e) {
        setError(e instanceof Error ? e.message : "添付に失敗しました");
      }
    }
    await refresh();
  }

  return (
    <div className="attachment-list">
      <div className="attachment-header">
        <span>添付（画像・PDF、1ファイル{Math.round(MAX_ATTACHMENT_SIZE / 1024 / 1024)}MBまで）</span>
        <label className="btn">
          追加
          <input
            type="file"
            hidden
            multiple
            accept={ALLOWED_ATTACHMENT_TYPES.join(",")}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      </div>
      {error && <p className="error-text">{error}</p>}
      {attachments.length === 0 ? (
        <p className="muted">添付はありません</p>
      ) : (
        <ul>
          {attachments.map((a) => {
            const url = urls.get(a.id) ?? "";
            return (
              <li key={a.id} className="attachment-item">
                <button className="attachment-name-btn" onClick={() => setViewing(a)}>
                  {a.filename}
                </button>
                <span className="muted">{Math.round(a.size / 1024)}KB</span>
                <a className="icon-btn" href={url} download={a.filename} title="ダウンロード" aria-label="ダウンロード">
                  ⬇
                </a>
                <button
                  className="icon-btn"
                  title="削除"
                  onClick={async () => {
                    await removeAttachment(noteId, a.id);
                    await refresh();
                  }}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {viewing && urls.has(viewing.id) && (
        <AttachmentViewer attachment={viewing} url={urls.get(viewing.id)!} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
