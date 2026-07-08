// Google OAuth (PKCE) 플로우. obsidian-embedder의 구현을 포팅하되,
// 브라우저를 여는 방법(Electron shell 또는 CLI opener)을 주입받아 옵시디언/CLI 양쪽에서 재사용한다.
import * as http from "node:http";
import * as url from "node:url";
import { OAuthTokens } from "../types";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectPort: number;
  openUrl: (targetUrl: string) => Promise<void> | void;
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/userinfo.email"];
const OAUTH_TIMEOUT_MS = 120000;

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export class GoogleOAuthFlow {
  private config: OAuthConfig;
  private server: http.Server | null = null;

  constructor(config: OAuthConfig) {
    this.config = config;
  }

  async startOAuthFlow(): Promise<OAuthTokens> {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const redirectUri = `http://localhost:${this.config.redirectPort}/callback`;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleCallback(req, res, codeVerifier, redirectUri, resolve, reject);
      });

      this.server.listen(this.config.redirectPort, () => {
        console.debug(`OAuth 콜백 서버가 포트 ${this.config.redirectPort}에서 대기 중입니다.`);
      });

      this.server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          reject(new Error(`포트 ${this.config.redirectPort}가 이미 사용 중입니다. 다른 프로그램을 종료한 뒤 다시 시도하세요.`));
        } else {
          reject(err);
        }
      });

      const authUrl = buildAuthUrl(this.config, redirectUri, codeChallenge);
      void this.config.openUrl(authUrl);

      setTimeout(() => {
        if (this.server) {
          this.cleanup();
          reject(new Error("OAuth 인증이 시간 초과되었습니다. 다시 시도하세요."));
        }
      }, OAUTH_TIMEOUT_MS);
    });
  }

  private async handleCallback(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    codeVerifier: string,
    redirectUri: string,
    resolve: (tokens: OAuthTokens) => void,
    reject: (error: Error) => void,
  ): Promise<void> {
    const parsedUrl = url.parse(req.url || "", true);
    if (parsedUrl.pathname !== "/callback") return;

    const code = parsedUrl.query.code as string | undefined;
    const error = parsedUrl.query.error as string | undefined;

    if (error) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(resultHtml(false, error));
      this.cleanup();
      reject(new Error(`OAuth 오류: ${error}`));
      return;
    }

    if (!code) return;

    try {
      const tokens = await this.exchangeCodeForTokens(code, codeVerifier, redirectUri);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(resultHtml(true));
      this.cleanup();
      resolve(tokens);
    } catch (tokenError) {
      const message = tokenError instanceof Error ? tokenError.message : String(tokenError);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(resultHtml(false, message));
      this.cleanup();
      reject(tokenError instanceof Error ? tokenError : new Error(message));
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });

    if (!response.ok) throw new Error(`토큰 갱신 실패: ${response.status}`);
    const data = (await response.json()) as GoogleTokenResponse;
    return {
      accessToken: data.access_token,
      refreshToken,
      expiresIn: data.expires_in,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  isTokenExpired(expiresAt: number): boolean {
    const bufferMs = 5 * 60 * 1000;
    return Date.now() >= expiresAt - bufferMs;
  }

  private async exchangeCodeForTokens(code: string, codeVerifier: string, redirectUri: string): Promise<OAuthTokens> {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }).toString(),
    });

    if (!response.ok) throw new Error(`토큰 교환 실패: ${response.status}`);
    const data = (await response.json()) as GoogleTokenResponse;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || "",
      expiresIn: data.expires_in,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  private cleanup(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

function buildAuthUrl(config: OAuthConfig, redirectUri: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return base64UrlEncode(new Uint8Array(hash));
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.length; i++) binary += String.fromCharCode(buffer[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function resultHtml(success: boolean, detail?: string): string {
  const title = success ? "연결 완료" : "연결 실패";
  const message = success
    ? "Google Drive 연결이 완료되었습니다. 이 창을 닫고 옵시디언으로 돌아가세요."
    : `Google Drive 연결에 실패했습니다: ${escapeHtml(detail || "알 수 없는 오류")}`;
  const color = success ? "#34a853" : "#ea4335";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:${color};}
.box{background:#fff;padding:40px 60px;border-radius:16px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.2);}</style>
</head><body><div class="box"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
