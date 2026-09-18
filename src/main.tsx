import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { captureAuthFromLocation as capturePCloudAuth } from "./lib/pcloud";
import { captureAuthFromLocation as captureDropboxAuth } from "./lib/dropbox";

// OAuthリダイレクト後、URLフラグメントのstateパラメータでどちらのプロバイダからの
// コールバックかを判別する。一致しない方は何もしない（captureAuthFromLocation内でstateを確認する）。
capturePCloudAuth();
captureDropboxAuth();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
