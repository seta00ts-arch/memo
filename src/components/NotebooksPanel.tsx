import { useMemo, useState } from "react";
import { useStore } from "../store/useStore";

interface Props {
  onSelectNotebook: (id: string, name: string) => void;
}

export default function NotebooksPanel({ onSelectNotebook }: Props) {
  const notes = useStore((s) => s.notes);
  const notebooks = useStore((s) => s.notebooks);
  const addNotebook = useStore((s) => s.addNotebook);
  const renameNotebook = useStore((s) => s.renameNotebook);
  const removeNotebook = useStore((s) => s.removeNotebook);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      if (n.trashed || !n.notebookId) continue;
      map.set(n.notebookId, (map.get(n.notebookId) ?? 0) + 1);
    }
    return map;
  }, [notes]);

  const sorted = useMemo(
    () => [...notebooks].sort((a, b) => a.name.localeCompare(b.name, "ja")),
    [notebooks]
  );

  async function handleAdd() {
    const name = newName.trim();
    if (!name) {
      setAdding(false);
      return;
    }
    await addNotebook(name);
    setNewName("");
    setAdding(false);
  }

  async function handleRename(id: string) {
    const name = editingName.trim();
    if (name) await renameNotebook(id, name);
    setEditingId(null);
  }

  return (
    <div className="notebooks-panel">
      <div className="notebooks-panel-header">
        <h2>ノートブック一覧</h2>
        <button className="btn" onClick={() => setAdding(true)}>
          ＋ 追加
        </button>
      </div>
      <p className="muted">ノートブックをタップすると、その中のノートを一覧できます。</p>

      {adding && (
        <input
          autoFocus
          className="inline-input notebooks-add-input"
          value={newName}
          placeholder="ノートブック名"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
            if (e.key === "Escape") {
              setAdding(false);
              setNewName("");
            }
          }}
          onBlur={handleAdd}
        />
      )}

      {sorted.length === 0 ? (
        <p className="muted">ノートブックはまだありません。</p>
      ) : (
        <ul className="notebooks-list">
          {sorted.map((nb) => (
            <li key={nb.id} className="notebooks-list-item">
              {editingId === nb.id ? (
                <input
                  autoFocus
                  className="inline-input"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(nb.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => handleRename(nb.id)}
                />
              ) : (
                <button className="notebooks-list-name" onClick={() => onSelectNotebook(nb.id, nb.name)}>
                  <span>{nb.name}</span>
                  <span className="count">{counts.get(nb.id) ?? 0}</span>
                </button>
              )}
              <div className="notebooks-list-actions">
                <button
                  className="icon-btn"
                  title="名前を変更"
                  onClick={() => {
                    setEditingId(nb.id);
                    setEditingName(nb.name);
                  }}
                >
                  ✎
                </button>
                <button
                  className="icon-btn"
                  title="削除"
                  onClick={() => {
                    if (window.confirm(`「${nb.name}」を削除します。中のノートは未整理に戻ります。よろしいですか？`)) {
                      removeNotebook(nb.id);
                    }
                  }}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
