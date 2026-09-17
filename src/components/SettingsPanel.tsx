import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";
import {
  buildAuthorizeUrl,
  getStoredAuth,
  clearAuth,
  verifyAuth,
  type PCloudAuth,
} from "../lib/pcloud";
import { syncAll, type SyncResult } from "../lib/sync";
import { exportFullBackup, importFullBackup, downloadBlob } from "../lib/backup";

const redirectUri = `${window.location.origin}${window.location.pathname}`;

export default function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const init = useStore((s) => s.init);

  const [clientId, setClientId] = useState(settings?.pcloudClientId ?? "");
  const [auth, setAuth] = useState<PCloudAuth | null>(getStoredAuth());
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "done" | "failed">("idle");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  useEffect(() => {
    if (auth) {
      verifyAuth(auth).then(setConnectionOk);
    }
  }, [auth]);

  async function handleConnect() {
    if (!clientId.trim()) return;
    await updateSettings({ pcloudClientId: clientId.trim() });
    window.location.href = buildAuthorizeUrl(clientId.trim(), redirectUri);
  }

  function handleDisconnect() {
    clearAuth();
    setAuth(null);
    setConnectionOk(null);
  }

  async function handleSync() {
    setSyncStatus("syncing");
    setSyncMessage(null);
    try {
      const result: SyncResult = await syncAll();
      setSyncStatus("done");
      setSyncMessage(
        `アップロード ノート${result.uploadedNotes}件/履歴${result.uploadedHistory}件/添付${result.uploadedAttachments}件/ノートブック${result.uploadedNotebooks}件/削除${result.uploadedDeletions}件、` +
          `ダウンロード ノート${result.downloadedNotes}件/添付${result.downloadedAttachments}件/ノートブック${result.downloadedNotebooks}件/削除${result.downloadedDeletions}件` +
          (result.conflicts > 0 ? `（うち競合${result.conflicts}件は両方の版を保持しました）` : "")
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

  return (
    <div className="settings-panel">
      <h2>設定</h2>

      <section className="settings-section">
        <h3>pCloud接続</h3>
        <p className="muted small">
          パスワードやClient Secretは入力しません。pCloud側で自分用アプリを登録し、以下のURLを戻り先（Redirect
          URI）として設定してください。
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
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="pCloud Client ID" />
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
        {syncMessage && <p className={syncStatus === "failed" ? "error-text" : "muted small"}>{syncMessage}</p>}
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
        <h3>このアプリについて</h3>
        <p className="muted small">
          しおり（仮称）は個人用の記事保存・メモアプリです。詳細な仕様と実装状況はリポジトリのREADMEを参照してください。
        </p>
      </section>
    </div>
  );
}
