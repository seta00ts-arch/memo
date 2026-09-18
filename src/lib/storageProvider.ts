// 同期先クラウドストレージの共通インターフェース。pCloud・Dropboxなど複数のプロバイダを
// 同じ形で扱えるようにし、sync.tsはこのインターフェースだけを見て同期処理を行う。

export interface StoredAuth {
  accessToken: string;
  // 各プロバイダの実装（PCloudAuth・DropboxAuth）はこれより多くのフィールドを持つ。
}

export interface RemoteEntry {
  name: string;
  isfolder: boolean;
}

export interface StorageProvider {
  id: "pcloud" | "dropbox";
  /** 画面表示用の名前 */
  label: string;
  buildAuthorizeUrl(clientId: string, redirectUri: string): string;
  /** OAuthリダイレクト後のURLフラグメントからトークンを取り出し、セッションに保存する */
  captureAuthFromLocation(): StoredAuth | null;
  getStoredAuth(): StoredAuth | null;
  clearAuth(): void;
  verifyAuth(auth: StoredAuth): Promise<boolean>;
  /** 専用フォルダ（アプリフォルダ）を確保し、以降のパスの起点を返す */
  ensureAppFolder(auth: StoredAuth): Promise<string>;
  createFolderIfNotExists(auth: StoredAuth, path: string): Promise<void>;
  listFolder(auth: StoredAuth, path: string): Promise<RemoteEntry[]>;
  uploadJson(auth: StoredAuth, folderPath: string, filename: string, data: unknown): Promise<void>;
  uploadBlob(auth: StoredAuth, folderPath: string, filename: string, blob: Blob): Promise<void>;
  downloadJson<T>(auth: StoredAuth, path: string): Promise<T>;
  downloadBlob(auth: StoredAuth, path: string): Promise<Blob>;
}
