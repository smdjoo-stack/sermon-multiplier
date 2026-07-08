// NotebookLM 연동 계층 (산출물 1~4: 인포그래픽/슬라이드/영상/음성).
// notebooklm-mcp-cli(jacob-bd)를 stdio MCP 서버로 실행해 raw JSON-RPC로 통신한다.
// 실제 설치된 notebooklm-mcp-cli(v3.0.2)의 tools/list 응답을 직접 조회해 확인한
// 툴 이름/파라미터를 그대로 사용한다(추측 아님):
//   notebook_create, source_add, studio_create, studio_status, download_artifact
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { OutputKind } from "../types";

// 우리 산출물 이름 -> notebooklm-mcp-cli의 artifact_type 값
const ARTIFACT_TYPE: Record<"infographic" | "slides" | "video" | "audio", string> = {
  infographic: "infographic",
  slides: "slide_deck",
  video: "video",
  audio: "audio",
};

const ARTIFACT_FILE: Record<"infographic" | "slides" | "video" | "audio", { ext: string; mime: string }> = {
  infographic: { ext: "png", mime: "image/png" },
  slides: { ext: "pdf", mime: "application/pdf" },
  video: { ext: "mp4", mime: "video/mp4" },
  audio: { ext: "mp3", mime: "audio/mpeg" },
};

export interface McpSession {
  start(): Promise<void>;
  callTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T>;
  stop(): void;
}

interface JsonRpcIncomingMessage {
  jsonrpc?: string;
  id?: number;
  result?: McpToolCallResult;
  error?: { code: number; message: string };
}

interface McpToolCallResult {
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type?: string; text?: string }>;
  [key: string]: unknown;
}

export function createNotebookLmSession(command: string, timeoutMs: number): McpSession {
  let child: ChildProcessWithoutNullStreams | null = null;
  let stdout = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: McpToolCallResult | undefined) => void; reject: (error: Error) => void }
  >();

  function start(): Promise<void> {
    return new Promise((resolve, reject) => {
      child = spawn(command, { shell: process.platform === "win32" ? true : "/bin/zsh", stdio: ["pipe", "pipe", "pipe"] });
      const timer = setTimeout(() => reject(new Error(`NotebookLM MCP 초기화 실패: ${command}`)), 30000);

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
        drainStdout();
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`NotebookLM MCP 실행 실패: ${error.message}`));
      });
      child.on("close", (code) => {
        const error = new Error(`NotebookLM MCP 프로세스 종료(${code}): ${stderr.trim() || command}`);
        for (const waiter of pending.values()) waiter.reject(error);
        pending.clear();
      });

      send("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "sermon-multiplier", version: "0.1.0" },
      })
        .then(() => {
          clearTimeout(timer);
          write({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
          resolve();
        })
        .catch((error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return send("tools/call", { name, arguments: args }).then((result) => normalizeToolResult<T>(result));
  }

  function send(method: string, params: Record<string, unknown>): Promise<McpToolCallResult | undefined> {
    if (!child) return Promise.reject(new Error("NotebookLM MCP 세션이 시작되지 않았습니다."));
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`NotebookLM MCP 응답 시간 초과(${method}): ${stderr.trim() || command}`));
    }, timeoutMs);
    let reject!: (error: Error) => void;
    const promise = new Promise<McpToolCallResult | undefined>((resolve, rejectPromise) => {
      reject = rejectPromise;
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectPromise(error);
        },
      });
    });
    write({ jsonrpc: "2.0", id, method, params });
    return promise;
  }

  function write(message: Record<string, unknown>): void {
    child?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function drainStdout(): void {
    let newline = stdout.indexOf("\n");
    while (newline !== -1) {
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (line) {
        try {
          const message = JSON.parse(line) as JsonRpcIncomingMessage;
          const waiter = message.id === undefined ? undefined : pending.get(message.id);
          if (waiter) {
            pending.delete(message.id!);
            if (message.error) waiter.reject(new Error(message.error.message || JSON.stringify(message.error)));
            else waiter.resolve(message.result);
          }
        } catch {
          stderr += `\n${line}`;
        }
      }
      newline = stdout.indexOf("\n");
    }
  }

  function stop(): void {
    if (child && !child.killed) child.kill("SIGTERM");
  }

  return { start, callTool, stop };
}

function normalizeToolResult<T>(result: McpToolCallResult | undefined): T {
  if (result?.structuredContent && Object.keys(result.structuredContent).length) {
    return result.structuredContent as T;
  }
  const text = Array.isArray(result?.content)
    ? result.content
        .map((item) => (item?.type === "text" ? item.text || "" : ""))
        .join("\n")
        .trim()
    : "";
  if (text) {
    try {
      return JSON.parse(text) as T;
    } catch {
      return { status: "success", text } as T;
    }
  }
  return (result || {}) as T;
}

export interface NotebookLmArtifactRequest {
  kind: "infographic" | "slides" | "video" | "audio";
  styleText?: string; // studio_create의 focus_prompt로 전달되는 비주얼 스타일 프리셋 본문(슬라이드/인포그래픽 공통)
}

export interface NotebookLmArtifactResult {
  kind: OutputKind;
  status: "complete" | "error";
  localFilePath?: string;
  mimeType?: string;
  error?: string;
}

export interface GenerateNotebookLmOutputsParams {
  session: McpSession;
  notebookId: string | null; // null이면 새로 생성
  notebookTitle: string;
  sourceTitle: string;
  sourceText: string;
  requests: NotebookLmArtifactRequest[];
  downloadDir: string;
  maxWaitSeconds: number;
}

export interface GenerateNotebookLmOutputsResult {
  notebookId: string;
  results: NotebookLmArtifactResult[];
}

export async function generateNotebookLmOutputs(
  params: GenerateNotebookLmOutputsParams,
): Promise<GenerateNotebookLmOutputsResult> {
  const { session, requests, downloadDir, maxWaitSeconds } = params;
  await mkdir(downloadDir, { recursive: true });

  const notebookId = params.notebookId || (await createNotebook(session, params.notebookTitle));
  await addSermonSource(session, notebookId, params.sourceTitle, params.sourceText);

  const artifactIds: Partial<Record<string, string>> = {};
  const results: NotebookLmArtifactResult[] = [];

  // ③ 4개(또는 요청된 개수) 아티팩트 생성 툴을 순차 호출한다(NotebookLM 세션 동시성 취약 때문에 병렬 실행하지 않음).
  for (const request of requests) {
    try {
      const artifactType = ARTIFACT_TYPE[request.kind];
      // language를 지정하지 않으면 NOTEBOOKLM_HL 환경변수 또는 영어(en)로 기본 생성되므로 명시한다.
      const options: Record<string, unknown> = {
        notebook_id: notebookId,
        artifact_type: artifactType,
        confirm: true,
        language: "ko",
      };
      if (request.styleText) {
        options.focus_prompt = request.styleText;
      }
      const created = await session.callTool<{ artifact_id?: string; status?: string; error?: string }>(
        "studio_create",
        options,
      );
      if (created.status === "error") throw new Error(created.error || "studio_create 실패");
      if (created.artifact_id) artifactIds[request.kind] = created.artifact_id;
    } catch (error) {
      results.push({ kind: request.kind, status: "error", error: describeError(error) });
    }
  }

  // ④ 완료까지 폴링(기본 타임아웃 15분)
  const pending = requests.filter((r) => !results.some((res) => res.kind === r.kind));
  const finalArtifacts = await pollUntilComplete(session, notebookId, pending.map((r) => r.kind), maxWaitSeconds);

  // ⑤ 완성 파일을 로컬 다운로드 폴더로 내려받는다.
  for (const request of pending) {
    const artifact = finalArtifacts.find((a) => a.type === ARTIFACT_TYPE[request.kind]);
    if (!artifact || artifact.status !== "completed") {
      results.push({
        kind: request.kind,
        status: "error",
        error: artifact ? `NotebookLM 생성 실패 (status=${artifact.status})` : "제한 시간 내에 완료되지 않았습니다.",
      });
      continue;
    }
    try {
      const file = ARTIFACT_FILE[request.kind];
      const outputPath = `${downloadDir}/${request.kind}.${file.ext}`;
      await session.callTool("download_artifact", {
        notebook_id: notebookId,
        artifact_type: ARTIFACT_TYPE[request.kind],
        output_path: outputPath,
        artifact_id: artifact.artifact_id,
      });
      results.push({ kind: request.kind, status: "complete", localFilePath: outputPath, mimeType: file.mime });
    } catch (error) {
      results.push({ kind: request.kind, status: "error", error: describeError(error) });
    }
  }

  return { notebookId, results };
}

async function createNotebook(session: McpSession, title: string): Promise<string> {
  const result = await session.callTool<{ notebook_id?: string; id?: string }>("notebook_create", { title });
  const notebookId = result.notebook_id || result.id;
  if (!notebookId) throw new Error("notebook_create가 notebook_id를 반환하지 않았습니다.");
  return notebookId;
}

async function addSermonSource(session: McpSession, notebookId: string, title: string, text: string): Promise<void> {
  await session.callTool("source_add", {
    notebook_id: notebookId,
    source_type: "text",
    text,
    title,
    wait: true,
    wait_timeout: 120,
  });
}

interface StudioArtifact {
  artifact_id: string;
  type: string;
  status: string;
}

async function pollUntilComplete(
  session: McpSession,
  notebookId: string,
  kinds: OutputKind[],
  maxWaitSeconds: number,
): Promise<StudioArtifact[]> {
  const wantedTypes = new Set(kinds.map((k) => ARTIFACT_TYPE[k as "infographic" | "slides" | "video" | "audio"]));
  if (wantedTypes.size === 0) return [];

  const deadline = Date.now() + maxWaitSeconds * 1000;
  let last: StudioArtifact[] = [];
  while (Date.now() < deadline) {
    const status = await session.callTool<{ artifacts?: StudioArtifact[] }>("studio_status", {
      notebook_id: notebookId,
      action: "status",
    });
    last = status.artifacts || [];
    const relevant = last.filter((a) => wantedTypes.has(a.type));
    const allDone = relevant.length >= wantedTypes.size && relevant.every((a) => a.status !== "in_progress");
    if (allDone) return relevant;
    await delay(15000);
  }
  return last.filter((a) => wantedTypes.has(a.type));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 브라우저 로그인 상호작용을 기다려야 하므로 넉넉하게 5분

// 터미널 없이 설정 화면의 "로그인" 버튼에서 바로 실행한다.
// nlm login은 자체적으로 브라우저를 띄우고 로컬 콜백을 기다리는 방식이라
// stdin 입력 없이도 완료되지만, 사용자가 브라우저에서 로그인을 마칠 때까지 오래 걸릴 수 있다.
export function runNotebookLmLogin(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("uvx", ["--from", "notebooklm-mcp-cli", "nlm", "login"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("로그인이 시간 초과되었습니다(5분). 다시 시도해주세요."));
    }, LOGIN_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`nlm login 실행 실패: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(output.trim() || `로그인 실패 (종료 코드 ${code})`));
    });
  });
}

export interface NotebookLmConnectionStatus {
  ok: boolean;
  message: string;
}

// notebook_list를 가볍게 호출해 로그인 세션이 살아있는지 확인한다.
export async function testNotebookLmConnection(command: string): Promise<NotebookLmConnectionStatus> {
  const session = createNotebookLmSession(command, 30000);
  try {
    await session.start();
    const result = await session.callTool<{ status?: string; error?: string }>("notebook_list", { max_results: 1 });
    if (result.status === "error") {
      return { ok: false, message: result.error || "인증이 필요합니다. 로그인 버튼을 눌러주세요." };
    }
    return { ok: true, message: "NotebookLM에 정상적으로 연결되어 있습니다." };
  } catch (error) {
    return { ok: false, message: describeError(error) };
  } finally {
    session.stop();
  }
}
