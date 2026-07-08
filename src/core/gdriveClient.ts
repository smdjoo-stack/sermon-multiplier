// Google Drive 저장 계층 (산출물 1~4의 미디어 파일 업로드).
// obsidian-embedder의 업로드 로직을 포팅하되, 브라우저 File 객체 대신
// 로컬 파일 경로(fs)를 입력으로 받는다 — NotebookLM에서 다운로드한 파일을 그대로 올리기 위함.
import { readFile } from "node:fs/promises";
import { GoogleOAuthFlow, OAuthConfig } from "./googleOAuthFlow";
import { DriveSecrets, DriveUploadResult, OAuthTokens } from "../types";

const API_URL = "https://www.googleapis.com/drive/v3";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3";
export const DEFAULT_OAUTH_REDIRECT_PORT = 8787;

interface DriveFileResponse {
  id: string;
  webViewLink?: string;
}

interface DriveFileListResponse {
  files?: Array<{ id: string }>;
}

interface DriveErrorResponse {
  error?: { code?: number; message?: string; status?: string };
}

// 응답 상태 코드만으로는 원인을 알 수 없으므로(예: 403은 API 미활성화/권한부족/할당량초과 모두 가능),
// Google이 보낸 실제 에러 메시지를 최대한 그대로 노출한다.
async function describeDriveError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as DriveErrorResponse;
    if (body.error?.message) return `${response.status} ${body.error.message}`;
  } catch {
    // 응답 본문이 JSON이 아니면 상태 코드만 사용한다.
  }
  return String(response.status);
}

export interface GoogleDriveConfig {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  onTokenRefresh?: (tokens: OAuthTokens) => Promise<void> | void;
}

export class GoogleDriveUploader {
  private config: GoogleDriveConfig;
  private oauthFlow: GoogleOAuthFlow;

  constructor(config: GoogleDriveConfig, oauthConfig: Omit<OAuthConfig, "clientId" | "clientSecret">) {
    this.config = config;
    this.oauthFlow = new GoogleOAuthFlow({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      ...oauthConfig,
    });
  }

  async connect(): Promise<OAuthTokens> {
    return this.oauthFlow.startOAuthFlow();
  }

  isConnected(): boolean {
    return Boolean(this.config.accessToken && this.config.refreshToken);
  }

  private async ensureValidToken(): Promise<string> {
    if (this.config.tokenExpiresAt && this.config.refreshToken && this.oauthFlow.isTokenExpired(this.config.tokenExpiresAt)) {
      const refreshed = await this.oauthFlow.refreshAccessToken(this.config.refreshToken);
      this.config.accessToken = refreshed.accessToken;
      this.config.tokenExpiresAt = refreshed.expiresAt;
      if (this.config.onTokenRefresh) await this.config.onTokenRefresh(refreshed);
    }
    if (!this.config.accessToken) {
      throw new Error("Google Drive에 연결되어 있지 않습니다. 설정에서 먼저 연결하세요.");
    }
    return this.config.accessToken;
  }

  // folderPath 예: "설교자료/2026-07-05_물위를걷다" — 중간 폴더가 없으면 자동 생성한다.
  async uploadFile(filePath: string, fileName: string, mimeType: string, folderPath: string): Promise<DriveUploadResult> {
    const accessToken = await this.ensureValidToken();
    const folderId = await this.ensureFolder(folderPath);
    const fileBuffer = await readFile(filePath);
    const base64Content = fileBuffer.toString("base64");

    const boundary = "-------sermon-multiplier-boundary";
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    const metadata = { name: fileName, mimeType, parents: [folderId] };
    const multipartBody =
      delimiter +
      "Content-Type: application/json\r\n\r\n" +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${mimeType}\r\n` +
      "Content-Transfer-Encoding: base64\r\n\r\n" +
      base64Content +
      closeDelimiter;

    const uploadResponse = await fetch(`${UPLOAD_URL}/files?uploadType=multipart&fields=id,webViewLink,name,mimeType`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    if (!uploadResponse.ok) throw new Error(`Google Drive 업로드 실패: ${await describeDriveError(uploadResponse)}`);
    const fileData = (await uploadResponse.json()) as DriveFileResponse;
    const fileId = fileData.id;

    await this.makeFilePublic(fileId);
    const fileInfo = await this.getFileInfo(fileId);

    return {
      fileId,
      webViewLink: fileInfo.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
      fileName,
      mimeType,
    };
  }

  private async makeFilePublic(fileId: string): Promise<void> {
    try {
      const accessToken = await this.ensureValidToken();
      await fetch(`${API_URL}/files/${fileId}/permissions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      });
    } catch (error) {
      console.error("공개 권한 설정 실패(업로드 자체는 성공):", error);
    }
  }

  private async getFileInfo(fileId: string): Promise<{ webViewLink?: string }> {
    const accessToken = await this.ensureValidToken();
    const response = await fetch(`${API_URL}/files/${fileId}?fields=webViewLink`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return {};
    return (await response.json()) as DriveFileResponse;
  }

  private async ensureFolder(folderPath: string): Promise<string> {
    const parts = folderPath.split("/").filter((part) => part.length > 0);
    let parentId = "root";
    for (const folderName of parts) {
      const existingId = await this.findFolder(folderName, parentId);
      parentId = existingId || (await this.createFolder(folderName, parentId));
    }
    return parentId;
  }

  private async findFolder(name: string, parentId: string): Promise<string | null> {
    const accessToken = await this.ensureValidToken();
    const query = `name='${escapeDriveQueryValue(name)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const response = await fetch(`${API_URL}/files?q=${encodeURIComponent(query)}&fields=files(id)`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as DriveFileListResponse;
    return data.files?.[0]?.id || null;
  }

  private async createFolder(name: string, parentId: string): Promise<string> {
    const accessToken = await this.ensureValidToken();
    const response = await fetch(`${API_URL}/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
    });
    if (!response.ok) throw new Error(`Drive 폴더 생성 실패: ${await describeDriveError(response)}`);
    const data = (await response.json()) as DriveFileResponse;
    return data.id;
  }

  async testConnection(): Promise<boolean> {
    try {
      const accessToken = await this.ensureValidToken();
      const response = await fetch(`${API_URL}/about?fields=user`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// 플러그인/CLI/MCP가 공통으로 쓰는 팩토리. openUrl은 실행 환경마다 다르다
// (옵시디언은 electron shell.openExternal, CLI는 시스템 기본 브라우저 오픈 명령).
export function createDriveUploader(
  secrets: DriveSecrets,
  openUrl: (url: string) => Promise<void> | void,
  onTokenRefresh: (tokens: OAuthTokens) => Promise<void> | void,
): GoogleDriveUploader | null {
  if (!secrets.googleClientId || !secrets.googleClientSecret) return null;
  return new GoogleDriveUploader(
    {
      clientId: secrets.googleClientId,
      clientSecret: secrets.googleClientSecret,
      accessToken: secrets.googleAccessToken,
      refreshToken: secrets.googleRefreshToken,
      tokenExpiresAt: secrets.tokenExpiresAt,
      onTokenRefresh,
    },
    { redirectPort: DEFAULT_OAUTH_REDIRECT_PORT, openUrl },
  );
}

function escapeDriveQueryValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

export function driveFilePreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

// webViewLink(예: https://drive.google.com/file/d/FILE_ID/view)에서 fileId만 추출한다.
export function extractDriveFileId(webViewLink: string): string | null {
  const match = webViewLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1]! : null;
}
