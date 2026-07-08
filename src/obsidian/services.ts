// 옵시디언 전용 배선(wiring): Vault 절대경로 조회, Google Drive 업로더 구성(Electron shell로 브라우저 열기).
import { FileSystemAdapter, Plugin } from "obsidian";
import { shell } from "electron";
import { join } from "node:path";
import { createDriveUploader, GoogleDriveUploader } from "../core/gdriveClient";
import { DriveSecrets, OAuthTokens } from "../types";

export function getVaultBasePath(plugin: Plugin): string {
  const adapter = plugin.app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) return adapter.getBasePath();
  throw new Error("이 플러그인은 데스크톱 옵시디언에서만 동작합니다.");
}

export function getSlideStylesDir(plugin: Plugin): string {
  return join(getVaultBasePath(plugin), ".sermon-multiplier", "slide-styles");
}

export function buildDriveUploader(
  secrets: DriveSecrets,
  onTokenRefresh: (tokens: OAuthTokens) => Promise<void>,
): GoogleDriveUploader | null {
  return createDriveUploader(secrets, (url) => shell.openExternal(url), onTokenRefresh);
}
