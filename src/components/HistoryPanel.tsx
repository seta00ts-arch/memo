import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";
import type { HistoryEntry } from "../types";

interface Props {
  noteId: string;
  onRestored: (newNoteId: string) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP");
}

export default function HistoryPanel({ noteId, onRestored }: Props) {
  const getHistory = useStore((s) => s.getHistory);
  const restoreHistoryAsNewNote = useStore((s) => s.restoreHistoryAsNewNote);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getHistory(noteId).then((list) => {
      if (!cancelled) {
        setEntries(list);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [noteId, getHistory]);

  if (loading) return <p className="muted">履歴を読み込み中…</p>;
  if (entries.length === 0) return <p className="muted">履歴がありません</p>;

  return (
    <ul className="history-list">
      {entries.map((h) => (
        <li key={h.id}>
          <div className="history-entry-meta">
            <span>{formatDate(h.timestamp)}</span>
            <span className="muted">{h.snapshot.title}</span>
          </div>
          <button
            className="link-btn"
            onClick={async () => {
              const newNote = await restoreHistoryAsNewNote(h.id);
              onRestored(newNote.id);
            }}
          >
            このバージョンを複製
          </button>
        </li>
      ))}
    </ul>
  );
}
