import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";
import type { SyncProviderId } from "../types";
import type { StoredAuth } from "../lib/storageProvider";
import { syncAll, getProvider, getAllProviders, type SyncResult } from "../lib/sync";
import { exportFullBackup, importFullBackup, downloadBlob } from "../lib/backup";
import { importEvernoteExport } from "../lib/evernote";

const redirectUri = `${window.location.origin}${window.location.pathname}`;

function clientIdKey(providerId: SyncProviderId): "pcloudClientId" | "dropboxClientId" {
  return providerId === "pcloud" ? "pcloudClientId" : "dropboxClientId";
}

export default function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const init = useStore((s) => s.init);
  const notebooks = useStore((s) => s.notebooks);

  const [providerId, setProviderId] = useState<SyncProviderId>(settings?.syncProvider ?? "pcloud");
  const provider = getProvider(providerId);

  const [clientId, setClientId] = useState(settings?.[clientIdKey(providerId)] ?? "");
  const [auth, setAuth] = useState<StoredAuth | null>(provider.getStoredAuth());
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "done" | "partial" | "failed">("idle");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [evernoteNotebookId, setEvernoteNotebookId] = useState<string>("");
  const [evernoteImporting, setEvernoteImporting] = useState(false);
  const [evernoteMessage, setEvernoteMessage] = useState<string | null>(null);

  // プロバイダ切り替え時、そのプロバイダのClient ID・接続状態を出し直す
  useEffect(() => {
    setClientId(settings?.[clientIdKey(providerId)] ?? "");
    setAuth(provider.getStoredAuth());
    setConnectionOk(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  useEffect(() => {
    if (auth) {
      provider.verifyAuth(auth).then(setConnectionOk);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, providerId]);

  async function handleProviderChange(next: SyncProviderId) {
    setProviderId(next);
    await updateSettings({ syncProvider: next });
  }

  async function handleConnect() {
    if (!clientId.trim()) return;
    await updateSettings({ syncProvider: providerId, [clientIdKey(providerId)]: clientId.trim() });
    window.location.href = provider.buildAuthorizeUrl(clientId.trim(), redirectUri);
  }

  function handleDisconnect() {
    provider.clearAuth();
    setAuth(null);
    setConnectionOk(null);
  }

  async function handleSync() {
    setSyncStatus("syncing");
    setSyncMessage(null);
    try {
      const result: SyncResult = await syncAll(providerId);
      setSyncStatus(result.errors.length > 0 ? "partial" : "done");
      setSyncMessage(
        `アップロード ノート${result.uploadedNotes}件/履歴${result.uploadedHistory}件/添付${result.uploadedAttachments}件/ノートブック${result.uploadedNotebooks}件/削除${result.uploadedDeletions}件、` +
          `ダウンロード ノート${result.downloadedNotes}件/添付${result.downloadedAttachments}件/ノートブック${result.downloadedNotebooks}件/削除${result.downloadedDeletions}件` +
          (result.conflicts > 0 ? `（うち競合${result.conflicts}件は両方の版を保持しました）` : "") +
          (result.errors.length > 0
            ? `\n一部の項目で失敗しました（${result.errors.length}件、通信環境が悪いと起こることがあります。もう一度同期すると再試行されます）:\n` +
              result.errors.slice(0, 5).join("\n") +
              (result.errors.length > 5 ? `\n…他${result.errors.length - 5}件` : "")
            : "")
      );
    } catch (e) {
      setSyncStatus("failed");
      setSyncMessage(e instanceof Error ? e.message : "同期に失敗しました");
    }
  }

  async function handleExport() {
    const blob = await exportFullBackup();
    downloadBlob(blob, `shiori-backup-${new Date().toISOString().slice(0, 10)}.json`);
  }

  async function handleImport(file: File) {
    setImportMessage(null);
    try {
      const summary = await importFullBackup(file);
      await init();
      setImportMessage(
        `読み込み完了: ノート${summary.notes}件、ノートブック${summary.notebooks}件、履歴${summary.history}件、添付${summary.attachments}件`
      );
    } catch (e) {
      setImportMessage(e instanceof Error ? e.message : "読み込みに失敗しました");
    }
  }

  async function handleEvernoteImport(file: File) {
    setEvernoteImporting(true);
    setEvernoteMessage(null);
    try {
      const summary = await importEvernoteExport(file, evernoteNotebookId || null);
      await init();
      setEvernoteMessage(
        `取り込み完了: ノート${summary.importedNotes}件、添付${summary.importedAttachments}件` +
          (summary.skippedAttachments > 0 ? `（未対応形式・容量超過のためスキップした添付${summary.skippedAttachments}件）` : "") +
          (summary.encryptedNotes > 0 ? `（暗号化されたコンテンツを含むノート${summary.encryptedNotes}件は本文が復号されていません）` : "")
      );
    } catch (e) {
      setEvernoteMessage(e instanceof Error ? e.message : "取り込みに失敗しました");
    } finally {
      setEvernoteImporting(false);
    }
  }

  return (
    <div className="settings-panel">
      <h2>設定</h2>

      <section className="settings-section">
        <h3>クラウド同期</h3>
        <div className="field-row">
          <label className="field field-grow">
            <span>同期先</span>
            <select value={providerId} onChange={(e) => handleProviderChange(e.target.value as SyncProviderId)}>
              {getAllProviders().map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small">
          パスワードやClient Secret（App Secret）は入力しません。{provider.label}側で自分用アプリを登録し、
          以下のURLを戻り先（Redirect URI）として設定してください。
          {providerId === "dropbox" && "（アクセス種類は「App folder」を選ぶと、しおり専用フォルダのみにアクセスが限定されます）"}
        </p>
        <p className="redirect-uri">{redirectUri}</p>

        {auth ? (
          <div className="connection-status">
            <p>
              状態:{" "}
              {connectionOk === null ? "確認中…" : connectionOk ? "接続済み" : "接続を確認できません"}
            </p>
            <button className="btn" onClick={handleDisconnect}>
              切断する
            </button>
          </div>
        ) : (
          <div className="field-row">
            <label className="field field-grow">
              <span>Client ID</span>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder={`${provider.label} Client ID`}
              />
            </label>
            <button className="btn btn-primary" onClick={handleConnect} disabled={!clientId.trim()}>
              接続する
            </button>
          </div>
        )}

        <div className="sync-controls">
          <button className="btn" disabled={!auth || syncStatus === "syncing"} onClick={handleSync}>
            {syncStatus === "syncing" ? "同期中…" : "今すぐ同期"}
          </button>
          {settings?.lastSyncAt && (
            <span className="muted small">前回同期: {new Date(settings.lastSyncAt).toLocaleString("ja-JP")}</span>
          )}
        </div>
        {syncMessage && (
          <p
            className={
              syncStatus === "failed" ? "error-text sync-message" : syncStatus === "partial" ? "warning-text sync-message" : "muted small sync-message"
            }
          >
            {syncMessage}
          </p>
        )}
        <p className="muted small">
          通信に失敗しても端末内のデータは消えません。同期はバックアップの代わりにはならないため、下記の書き出しも定期的にご利用ください。
        </p>
      </section>

      <section className="settings-section">
        <h3>バックアップ（持ち出し）</h3>
        <div className="field-row">
          <button className="btn" onClick={handleExport}>
            全データを書き出す
          </button>
          <label className="btn">
            バックアップを読み込む
            <input
              type="file"
              hidden
              accept="application/json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImport(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {importMessage && <p className="muted small">{importMessage}</p>}
      </section>

      <section className="settings-section">
        <h3>Evernoteからインポート</h3>
        <p className="muted small">
          Evernoteの「.enex」エクスポートファイルを取り込みます。出典URLがあるノートは記事として、
          原文はコメント・メモと分けて取り込まれます。書式の一部（表・下線・暗号化コンテンツなど）は
          簡易的な変換になるか失われる場合があります。
        </p>
        <div className="field-row">
          <label className="field field-grow">
            <span>取り込み先ノートブック</span>
            <select value={evernoteNotebookId} onChange={(e) => setEvernoteNotebookId(e.target.value)}>
              <option value="">未整理</option>
              {notebooks.map((nb) => (
                <option key={nb.id} value={nb.id}>
                  {nb.name}
                </option>
              ))}
            </select>
          </label>
          <label className="btn">
            {evernoteImporting ? "取り込み中…" : ".enexファイルを選ぶ"}
            <input
              type="file"
              hidden
              accept=".enex,application/xml,text/xml"
              disabled={evernoteImporting}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleEvernoteImport(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {evernoteMessage && <p className="muted small">{evernoteMessage}</p>}
      </section>

      <section className="settings-section">
        <h3>このアプリについて</h3>
        <p className="muted small">
          しおり（仮称）は個人用の記事保存・メモアプリです。詳細な仕様と実装状況はリポジトリのREADMEを参照してください。
        </p>
      </section>
    </div>
  );
}
