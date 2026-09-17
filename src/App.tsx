import { useEffect, useState } from "react";
import { useStore } from "./store/useStore";
import Sidebar from "./components/Sidebar";
import NoteList from "./components/NoteList";
import NoteEditor from "./components/NoteEditor";
import SaveArticleDialog from "./components/SaveArticleDialog";
import SettingsPanel from "./components/SettingsPanel";
import TrashPanel from "./components/TrashPanel";
import TagsPanel from "./components/TagsPanel";
import NotebooksPanel from "./components/NotebooksPanel";
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
  const [sharedUrl, setSharedUrl] = useState<{ url: string; title: string } | null>(null);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    // iOSショートカット等から ?share_url=...&share_title=... で開かれた場合、
    // 記事保存ダイアログを自動的に開き、URLを引き継ぐ（共有メニューからの取り込みの代替）
    const params = new URLSearchParams(window.location.search);
    const shareUrl = params.get("share_url");
    if (shareUrl) {
      setSharedUrl({ url: shareUrl, title: params.get("share_title") ?? "" });
      setSaveArticleOpen(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

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

  // 新規ノートが現在のビューの一覧に表示されない場合（例: タグ・お気に入り絞り込み中）は、
  // 受信箱に切り替えて見えるようにする。ノートブック内で作成した場合はそのビューのまま。
  function revealNoteInList(notebookId: string | null) {
    if (notebookId) return;
    if (view.kind === "inbox" || view.kind === "all") return;
    setView({ kind: "inbox" });
  }

  async function handleNewMemo() {
    const notebookId = view.kind === "notebook" ? view.id : null;
    const note = await useStore.getState().createNote({ type: "memo", title: "無題のメモ", body: "", notebookId });
    revealNoteInList(notebookId);
    openNote(note.id);
  }

  const isSpecialView =
    view.kind === "settings" || view.kind === "trash" || view.kind === "tags" || view.kind === "notebooks";

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
        onNewMemo={handleNewMemo}
        onImportFile={async (file) => {
          const notebookId = view.kind === "notebook" ? view.id : null;
          const title = file.name.replace(/\.[^/.]+$/, "");
          const note = await useStore.getState().createNote({ type: "memo", title, body: "", notebookId });
          try {
            await useStore.getState().addAttachment(note.id, file);
          } catch (e) {
            window.alert(e instanceof Error ? e.message : "添付に失敗しました");
          }
          revealNoteInList(notebookId);
          openNote(note.id);
        }}
      />

      {isSpecialView ? (
        <main className="main-panel main-panel--full">
          {view.kind === "settings" && <SettingsPanel />}
          {view.kind === "trash" && <TrashPanel onOpenNote={openNote} />}
          {view.kind === "tags" && (
            <TagsPanel
              onSelectTag={(tag) => {
                setView({ kind: "tag", tag });
                setSelectedNoteId(null);
                setMobileScreen("list");
              }}
            />
          )}
          {view.kind === "notebooks" && (
            <NotebooksPanel
              onSelectNotebook={(id, name) => {
                setView({ kind: "notebook", id, name });
                setSelectedNoteId(null);
                setMobileScreen("list");
              }}
            />
          )}
        </main>
      ) : (
        <>
          <NoteList
            view={view}
            selectedNoteId={selectedNoteId}
            onSelectNote={openNote}
            onSaveArticle={() => setSaveArticleOpen(true)}
            onNewMemo={handleNewMemo}
          />
          <NoteEditor note={selectedNote} onBack={backToList} onDeleted={backToList} />
        </>
      )}

      {saveArticleOpen && (
        <SaveArticleDialog
          defaultNotebookId={view.kind === "notebook" ? view.id : null}
          initialUrl={sharedUrl?.url}
          initialTitle={sharedUrl?.title}
          onClose={() => {
            setSaveArticleOpen(false);
            setSharedUrl(null);
          }}
          onSaved={(id, notebookId) => {
            setSaveArticleOpen(false);
            setSharedUrl(null);
            revealNoteInList(notebookId);
            openNote(id);
          }}
        />
      )}
    </div>
  );
}

export default App;
