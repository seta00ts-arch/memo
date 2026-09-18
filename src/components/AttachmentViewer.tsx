import type { Attachment } from "../types";

interface Props {
  attachment: Attachment;
  url: string;
  onClose: () => void;
}

export default function AttachmentViewer({ attachment, url, onClose }: Props) {
  const isImage = attachment.mimeType.startsWith("image/");
  const isPdf = attachment.mimeType === "application/pdf";
  const isText = attachment.mimeType === "text/plain";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal attachment-viewer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="attachment-viewer-title">{attachment.filename}</h2>
          <div className="attachment-viewer-actions">
            <a className="icon-btn" href={url} download={attachment.filename} title="ダウンロード" aria-label="ダウンロード">
              ⬇
            </a>
            <button className="icon-btn" onClick={onClose} aria-label="閉じる">
              ✕
            </button>
          </div>
        </div>
        <div className="attachment-viewer-body">
          {isImage && <img src={url} alt={attachment.filename} />}
          {isPdf && <iframe src={url} title={attachment.filename} />}
          {isText && <iframe src={url} title={attachment.filename} />}
          {!isImage && !isPdf && !isText && (
            <p className="muted">このファイル形式はプレビューできません。ダウンロードして開いてください。</p>
          )}
        </div>
      </div>
    </div>
  );
}
