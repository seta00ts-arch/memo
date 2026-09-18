// Dropbox同期モジュール。pCloud（pcloud.ts）と同じ方針・同じインターフェース（StorageProvider）で実装する:
// - パスワード・App Secretはアプリに入力させない。ブラウザ内で完結するOAuth（response_type=token、
//   インプリシットフロー）を採用する。
// - 接続情報（access_token）はブラウザのセッション（sessionStorage）にのみ保持する。
// - Dropbox側のアプリを「App folder」アクセスタイプで登録する前提。その場合、Dropbox API上の
//   すべてのパスはアプリ専用フォルダ（Dropbox上では /Apps/<アプリ名>/）を起点にした相対パスになるため、
//   pCloudのように自分で"/Shiori"フォルダを作る必要はない（ensureAppFolderは空文字列を返す）。
// - 「App folder」アクセスタイプの個人利用は、Dropbox側のアプリ審査（App Review）が不要なため、
//   pCloudの承認待ちの間の代替として選べるようにしている。
//
// 注意: 実アカウントでの同期動作は本セッションでは未検証。

const AUTHORIZE_BASE = "https://www.dropbox.com/oauth2/authorize";
const API_BASE = "https://api.dropboxapi.com/2";
const CONTENT_BASE = "https://content.dropboxapi.com/2";
const SESSION_KEY = "shiori:dropboxAuth";

export interface DropboxAuth {
  accessToken: string;
  accountId?: string;
}

export function buildAuthorizeUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "token",
    redirect_uri: redirectUri,
    state: "dropbox",
  });
  return `${AUTHORIZE_BASE}?${params.toString()}`;
}

/** OAuthリダイレクト後のURLフラグメントからトークンを取り出し、セッションに保存する */
export function captureAuthFromLocation(): DropboxAuth | null {
  const hash = window.location.hash;
  if (!hash || !hash.includes("access_token") || !hash.includes("state=dropbox")) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const accountId = params.get("account_id") ?? undefined;
  if (!accessToken) return null;
  const auth: DropboxAuth = { accessToken, accountId };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(auth));
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return auth;
}

export function getStoredAuth(): DropboxAuth | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DropboxAuth;
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

// DropboxはAPI引数をヘッダ（Dropbox-API-Arg）で渡すが、HTTPヘッダはASCII外の文字を安全に
// 運べないため、非ASCII文字を\uXXXX形式にエスケープする（Dropbox公式ドキュメントの手法）。
function asciiSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

async function callRpc<T = unknown>(auth: DropboxAuth, endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? null),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Dropbox API通信エラー: ${endpoint} (${res.status}) ${text}`);
  }
  return (await res.json()) as T;
}

export async function verifyAuth(auth: DropboxAuth): Promise<boolean> {
  try {
    await callRpc(auth, "users/get_current_account", null);
    return true;
  } catch {
    return false;
  }
}

export async function createFolderIfNotExists(auth: DropboxAuth, path: string): Promise<void> {
  const res = await fetch(`${API_BASE}/files/create_folder_v2`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path, autorename: false }),
  });
  if (res.ok) return;
  const json = await res.json().catch(() => null);
  const tag = json?.error?.[".tag"];
  const conflictTag = json?.error?.path?.[".tag"];
  if (tag === "path" && conflictTag === "conflict") return; // 既に存在する場合は成功扱い
  const detail = json?.error_summary ?? json?.error?.[".tag"] ?? `HTTPステータス${res.status}`;
  throw new Error(`Dropboxフォルダ作成エラー: ${path} (${detail})`);
}

/** 専用フォルダ（アプリフォルダ）を確保する。App folderアクセスタイプのため起点は空文字列（Dropbox上の /Apps/しおり/ 相当） */
export async function ensureAppFolder(auth: DropboxAuth): Promise<string> {
  await createFolderIfNotExists(auth, "/notes");
  await createFolderIfNotExists(auth, "/history");
  await createFolderIfNotExists(auth, "/attachments");
  await createFolderIfNotExists(auth, "/notebooks");
  await createFolderIfNotExists(auth, "/deleted");
  return "";
}

interface DropboxEntry {
  ".tag": "file" | "folder";
  name: string;
}

export interface RemoteEntry {
  name: string;
  isfolder: boolean;
}

export async function listFolder(auth: DropboxAuth, path: string): Promise<RemoteEntry[]> {
  let json: { entries: DropboxEntry[]; has_more: boolean; cursor?: string };
  try {
    json = await callRpc(auth, "files/list_folder", { path });
  } catch {
    return []; // フォルダがまだ存在しない場合は空扱い
  }
  const entries = [...json.entries];
  let cursor = json.cursor;
  let hasMore = json.has_more;
  while (hasMore && cursor) {
    const more: { entries: DropboxEntry[]; has_more: boolean; cursor?: string } = await callRpc(
      auth,
      "files/list_folder/continue",
      { cursor }
    );
    entries.push(...more.entries);
    hasMore = more.has_more;
    cursor = more.cursor;
  }
  return entries.map((e) => ({ name: e.name, isfolder: e[".tag"] === "folder" }));
}

export async function uploadJson(auth: DropboxAuth, folderPath: string, filename: string, data: unknown): Promise<void> {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  await uploadBlob(auth, folderPath, filename, blob);
}

export async function uploadBlob(auth: DropboxAuth, folderPath: string, filename: string, blob: Blob): Promise<void> {
  const path = `${folderPath}/${filename}`;
  const res = await fetch(`${CONTENT_BASE}/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": asciiSafeJson({ path, mode: "overwrite", mute: true }),
    },
    body: blob,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`アップロード失敗: ${filename} ${text}`);
  }
}

export async function downloadJson<T>(auth: DropboxAuth, path: string): Promise<T> {
  const res = await downloadRaw(auth, path);
  return (await res.json()) as T;
}

export async function downloadBlob(auth: DropboxAuth, path: string): Promise<Blob> {
  const res = await downloadRaw(auth, path);
  return await res.blob();
}

async function downloadRaw(auth: DropboxAuth, path: string): Promise<Response> {
  const res = await fetch(`${CONTENT_BASE}/files/download`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Dropbox-API-Arg": asciiSafeJson({ path }),
    },
  });
  if (!res.ok) throw new Error(`ダウンロード失敗: ${path}`);
  return res;
}

import type { StorageProvider } from "./storageProvider";

export const dropboxProvider: StorageProvider = {
  id: "dropbox",
  label: "Dropbox",
  buildAuthorizeUrl,
  captureAuthFromLocation,
  getStoredAuth,
  clearAuth,
  verifyAuth: (auth) => verifyAuth(auth as DropboxAuth),
  ensureAppFolder: (auth) => ensureAppFolder(auth as DropboxAuth),
  createFolderIfNotExists: (auth, path) => createFolderIfNotExists(auth as DropboxAuth, path),
  listFolder: (auth, path) => listFolder(auth as DropboxAuth, path),
  uploadJson: (auth, folderPath, filename, data) => uploadJson(auth as DropboxAuth, folderPath, filename, data),
  uploadBlob: (auth, folderPath, filename, blob) => uploadBlob(auth as DropboxAuth, folderPath, filename, blob),
  downloadJson: (auth, path) => downloadJson(auth as DropboxAuth, path),
  downloadBlob: (auth, path) => downloadBlob(auth as DropboxAuth, path),
};
