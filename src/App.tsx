import { useEffect, useState } from "react";
import { useStore } from "./store/useStore";
import Sidebar from "./components/Sidebar";
import NoteList from "./components/NoteList";
import NoteEditor from "./components/NoteEditor";
import SaveArticleDialog from "./components/SaveArticleDialog";
import SettingsPanel from "./components/SettingsPanel";
import TrashPanel from "./components/TrashPanel";
import type { ViewFilter } from "./viewTypes";

export type MobileScreen = "sidebar" | "list" | "editor";

function App() {
  const init = useStore((s) => s.init);
  const loaded = useStore((s) => s.loaded);
  const notes = useStore((s) => s.notes);

  const [view, setView] = useState<ViewFilter>({ kind: "inbox" });
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [mobileScreen, setMobileScreen] = useState<MobileScreen>("list");
  const [saveArticleOpen, setSaveArticleOpen] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  if (!loaded) {
    return (
      <div className="app-loading" role="status">
        読み込み中…
      </div>
    );
  }

  const selectedNote = notes.find((n) => n.id === selectedNoteId) ?? null;

  function openNote(id: string) {
    setSelectedNoteId(id);
    setMobileScreen("editor");
  }

  function backToList() {
    setMobileScreen("list");
  }

  const isSpecialView = view.kind === "settings" || view.kind === "trash";

  return (
    <div className={`app-shell mobile-${mobileScreen}`}>
      <div className="mobile-topbar">
        <button className="icon-btn" onClick={() => setMobileScreen("sidebar")} aria-label="メニュー">
          ☰
        </button>
        <span className="mobile-topbar-title">しおり</span>
      </div>

      <Sidebar
        view={view}
        onChangeView={(v) => {
          setView(v);
          setSelectedNoteId(null);
          setMobileScreen("list");
        }}
        onClose={() => setMobileScreen("list")}
        onSaveArticle={() => setSaveArticleOpen(true)}
        onNewMemo={async () => {
          const note = await useStore.getState().createNote({ type: "memo", title: "無題のメモ", body: "" });
          setView({ kind: "inbox" });
          openNote(note.id);
        }}
      />

      {isSpecialView ? (
        <main className="main-panel main-panel--full">
          {view.kind === "settings" && <SettingsPanel />}
          {view.kind === "trash" && <TrashPanel onOpenNote={openNote} />}
        </main>
      ) : (
        <>
          <NoteList
            view={view}
            selectedNoteId={selectedNoteId}
            onSelectNote={openNote}
          />
          <NoteEditor note={selectedNote} onBack={backToList} onDeleted={backToList} />
        </>
      )}

      {saveArticleOpen && (
        <SaveArticleDialog
          onClose={() => setSaveArticleOpen(false)}
          onSaved={(id) => {
            setSaveArticleOpen(false);
            setView({ kind: "inbox" });
            openNote(id);
          }}
        />
      )}
    </div>
  );
}

export default App;
