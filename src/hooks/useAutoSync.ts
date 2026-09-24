import { useEffect, useRef } from "react";
import { useStore } from "../store/useStore";
import { syncAll, getProvider } from "../lib/sync";

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000; // アプリを開いている間、5分おきに自動同期する
const MIN_INTERVAL_BETWEEN_RUNS_MS = 60 * 1000; // タブ復帰・オンライン復帰が連続しても短時間に何度も同期しない

/** アプリを開いている間だけ有効なバックグラウンド同期。タブを閉じている間・端末が
 * スリープ中は動かない（Service WorkerのPeriodic Background SyncはiOS Safari等で
 * 使えず、押し通知サーバーもないため、Webアプリとして実現できるのはここまで）。 */
export function useAutoSync(): void {
  const syncProvider = useStore((s) => s.settings?.syncProvider);
  const autoSync = useStore((s) => s.settings?.autoSync);
  const lastRunAtRef = useRef(0);

  useEffect(() => {
    if (!syncProvider || autoSync === false) return;
    const provider = getProvider(syncProvider);
    if (!provider.getStoredAuth()) return;

    async function runSync() {
      if (!navigator.onLine) return;
      const now = Date.now();
      if (now - lastRunAtRef.current < MIN_INTERVAL_BETWEEN_RUNS_MS) return;
      lastRunAtRef.current = now;
      try {
        await syncAll(syncProvider!);
      } catch (e) {
        console.warn("自動同期に失敗しました:", e);
      }
    }

    runSync();
    const interval = setInterval(runSync, AUTO_SYNC_INTERVAL_MS);

    function onVisibilityChange() {
      if (document.visibilityState === "visible") runSync();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", runSync);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", runSync);
    };
  }, [syncProvider, autoSync]);
}
