import { useMemo } from "react";
import { useStore } from "../store/useStore";

interface Props {
  onSelectTag: (tag: string) => void;
}

export default function TagsPanel({ onSelectTag }: Props) {
  const notes = useStore((s) => s.notes);

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      if (n.trashed) continue;
      for (const t of n.tags) map.set(t, (map.get(t) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [notes]);

  return (
    <div className="tags-panel">
      <h2>タグ一覧</h2>
      <p className="muted">タグをタップすると、そのタグの付いたノートを一覧できます。</p>
      {tagCounts.length === 0 ? (
        <p className="muted">タグはまだありません。ノート編集画面のタグ欄から追加できます。</p>
      ) : (
        <div className="tags-grid">
          {tagCounts.map(([tag, count]) => (
            <button key={tag} className="tags-grid-item" onClick={() => onSelectTag(tag)}>
              <span>#{tag}</span>
              <span className="count">{count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
