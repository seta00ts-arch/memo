// pCloud同期モジュール。
//
// 仕様書 4章「pCloud保存と同期の設計」に基づく:
// - パスワード・Client Secretはアプリに入力させない。ブラウザ内で完結する
//   OAuth（response_type=token、いわゆるインプリシットフロー）を採用する。
// - 接続情報（access_token等）はブラウザのセッション（sessionStorage）にのみ保持する。
// - 通常の専用フォルダを使用するが、フォルダ限定のAPI権限（フルアクセスと別のスコープ）は使わない。
// - pCloud Cryptoやアプリ独自のE2E暗号化には対応しない（未実装）。
//
// 注意: 実アカウントでの同期動作は本セッションでは未検証。pCloudのダウンロード用リンク
// (getfilelink) がブラウザから直接fetchできない場合がある点は既知の懸念として README に記載する。

const AUTHORIZE_BASE = "https://my.pcloud.com/oauth2/authorize";
const APP_FOLDER_NAME = "Shiori";
const SESSION_KEY = "shiori:pcloudAuth";

export interface PCloudAuth {
  accessToken: string;
  hostname: string; // 例: api.pcloud.com / eapi.pcloud.com
  userId?: string;
}

export function buildAuthorizeUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "token",
    redirect_uri: redirectUri,
    state: "pcloud",
  });
  return `${AUTHORIZE_BASE}?${params.toString()}`;
}

/** OAuthリダイレクト後のURLフラグメントからトークンを取り出し、セッションに保存する */
export function captureAuthFromLocation(): PCloudAuth | null {
  const hash = window.location.hash;
  if (!hash || !hash.includes("access_token") || !hash.includes("state=pcloud")) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const hostname = params.get("hostname") || "api.pcloud.com";
  const userId = params.get("userid") ?? undefined;
  if (!accessToken) return null;
  const auth: PCloudAuth = { accessToken, hostname, userId };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(auth));
  // フラグメントを消してURLをきれいにする
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return auth;
}

export function getStoredAuth(): PCloudAuth | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PCloudAuth;
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

function apiUrl(auth: PCloudAuth, method: string, params: Record<string, string>): string {
  const usp = new URLSearchParams({ ...params, access_token: auth.accessToken });
  return `https://${auth.hostname}/${method}?${usp.toString()}`;
}

async function callApi<T = unknown>(auth: PCloudAuth, method: string, params: Record<string, string> = {}): Promise<T> {
  const res = await fetch(apiUrl(auth, method, params));
  if (!res.ok) {
    throw new Error(`pCloud API通信エラー: ${method} (${res.status})`);
  }
  const json = (await res.json()) as { result: number; error?: string } & T;
  if (json.result && json.result !== 0) {
    throw new Error(`pCloudエラー: ${json.error ?? json.result}`);
  }
  return json;
}

export async function verifyAuth(auth: PCloudAuth): Promise<boolean> {
  try {
    await callApi(auth, "userinfo");
    return true;
  } catch {
    return false;
  }
}

export async function createFolderIfNotExists(auth: PCloudAuth, path: string): Promise<void> {
  await callApi(auth, "createfolderifnotexists", { path });
}

/** 専用フォルダ（アプリフォルダ）を確保する。フルアクセストークンを使うため、フォルダ限定権限ではない */
export async function ensureAppFolder(auth: PCloudAuth): Promise<string> {
  await createFolderIfNotExists(auth, `/${APP_FOLDER_NAME}`);
  await createFolderIfNotExists(auth, `/${APP_FOLDER_NAME}/notes`);
  await createFolderIfNotExists(auth, `/${APP_FOLDER_NAME}/history`);
  await createFolderIfNotExists(auth, `/${APP_FOLDER_NAME}/attachments`);
  await createFolderIfNotExists(auth, `/${APP_FOLDER_NAME}/notebooks`);
  await createFolderIfNotExists(auth, `/${APP_FOLDER_NAME}/deleted`);
  return `/${APP_FOLDER_NAME}`;
}

interface RemoteEntry {
  name: string;
  isfolder: boolean;
  fileid?: number;
}

export async function listFolder(auth: PCloudAuth, path: string): Promise<RemoteEntry[]> {
  const json = await callApi<{ metadata?: { contents?: RemoteEntry[] } }>(auth, "listfolder", { path });
  return json.metadata?.contents ?? [];
}

export async function uploadJson(auth: PCloudAuth, folderPath: string, filename: string, data: unknown): Promise<void> {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  await uploadBlob(auth, folderPath, filename, blob);
}

export async function uploadBlob(auth: PCloudAuth, folderPath: string, filename: string, blob: Blob): Promise<void> {
  const form = new FormData();
  form.append("file", blob, filename);
  const usp = new URLSearchParams({ path: folderPath, access_token: auth.accessToken, nopartial: "1" });
  const res = await fetch(`https://${auth.hostname}/uploadfile?${usp.toString()}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`アップロード失敗: ${filename}`);
  const json = (await res.json()) as { result: number; error?: string };
  if (json.result !== 0) throw new Error(`アップロードエラー: ${json.error ?? json.result}`);
}

export async function downloadJson<T>(auth: PCloudAuth, path: string): Promise<T> {
  const link = await getFileLink(auth, path);
  const res = await fetch(link);
  if (!res.ok) throw new Error(`ダウンロード失敗: ${path}`);
  return (await res.json()) as T;
}

export async function downloadBlob(auth: PCloudAuth, path: string): Promise<Blob> {
  const link = await getFileLink(auth, path);
  const res = await fetch(link);
  if (!res.ok) throw new Error(`ダウンロード失敗: ${path}`);
  return await res.blob();
}

async function getFileLink(auth: PCloudAuth, path: string): Promise<string> {
  const json = await callApi<{ hosts: string[]; path: string }>(auth, "getfilelink", { path });
  const host = json.hosts[0];
  return `https://${host}${json.path}`;
}

export { APP_FOLDER_NAME };
export type { RemoteEntry };

import type { StorageProvider } from "./storageProvider";

export const pcloudProvider: StorageProvider = {
  id: "pcloud",
  label: "pCloud",
  buildAuthorizeUrl,
  captureAuthFromLocation,
  getStoredAuth,
  clearAuth,
  verifyAuth: (auth) => verifyAuth(auth as PCloudAuth),
  ensureAppFolder: (auth) => ensureAppFolder(auth as PCloudAuth),
  createFolderIfNotExists: (auth, path) => createFolderIfNotExists(auth as PCloudAuth, path),
  listFolder: (auth, path) => listFolder(auth as PCloudAuth, path),
  uploadJson: (auth, folderPath, filename, data) => uploadJson(auth as PCloudAuth, folderPath, filename, data),
  uploadBlob: (auth, folderPath, filename, blob) => uploadBlob(auth as PCloudAuth, folderPath, filename, blob),
  downloadJson: (auth, path) => downloadJson(auth as PCloudAuth, path),
  downloadBlob: (auth, path) => downloadBlob(auth as PCloudAuth, path),
};
