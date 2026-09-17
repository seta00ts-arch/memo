import { useStore } from "../store/useStore";

interface Props {
  onOpenNote: (id: string) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP");
}

export default function TrashPanel({ onOpenNote: _onOpenNote }: Props) {
  const notes = useStore((s) => s.notes);
  const restoreNote = useStore((s) => s.restoreNote);
  const permanentlyDeleteNote = useStore((s) => s.permanentlyDeleteNote);

  const trashed = notes
    .filter((n) => n.trashed)
    .sort((a, b) => ((a.trashedAt ?? "") < (b.trashedAt ?? "") ? 1 : -1));

  return (
    <div className="trash-panel">
      <h2>ゴミ箱</h2>
      <p className="muted">
        削除したノートはここから復元できます。初期版では自動的な完全削除は行いません。
      </p>
      {trashed.length === 0 ? (
        <p className="muted">ゴミ箱は空です</p>
      ) : (
        <ul className="trash-list">
          {trashed.map((n) => (
            <li key={n.id}>
              <div>
                <div className="note-item-title">{n.title || "無題"}</div>
                <div className="muted small">削除日時: {n.trashedAt ? formatDate(n.trashedAt) : "-"}</div>
              </div>
              <div className="trash-actions">
                <button className="btn" onClick={() => restoreNote(n.id)}>
                  復元
                </button>
                <button
                  className="btn danger"
                  onClick={() => {
                    if (window.confirm("完全に削除します。元に戻せません。よろしいですか？")) {
                      permanentlyDeleteNote(n.id);
                    }
                  }}
                >
                  完全に削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
