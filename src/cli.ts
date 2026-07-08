#!/usr/bin/env node
// 독립 CLI + MCP 서버 진입점 (설계문서 2장 "3중 인터페이스 구조").
//   node bin/sermon-multiplier.mjs run --note "설교/.../설교노트.md" --vault "/path/to/Vault" --outputs all
//   node bin/sermon-multiplier.mjs mcp
import { exec } from "node:child_process";
import { platform } from "node:process";
import { generateLandingPage, PipelineContext, reembedOutput, runPipeline } from "./core/pipeline";
import { loadDriveSecrets, saveDriveSecrets } from "./core/secretsStore";
import { createDriveUploader } from "./core/gdriveClient";
import { ensureSlideStylesSeeded, listSlideStylePresets } from "./core/slideStyles";
import { AiProviderId, ALL_GENERATABLE_OUTPUTS, DEFAULT_SETTINGS, OutputKind, OutputRunState, SermonMultiplierSettings } from "./types";
import { join } from "node:path";

const args = process.argv.slice(2);

try {
  const command = args.shift();
  if (command === "run") {
    await runCommand(args);
  } else if (command === "mcp") {
    await mcpCommand();
  } else {
    throw new Error(
      "사용법: sermon-multiplier <run|mcp>\n" +
        "  run --vault <Vault경로> --note <노트 상대경로> [--outputs all|infographic,slides,...]\n" +
        "      [--slide-style <id>] [--infographic-style <id>]\n" +
        "      [--ai-provider <claude|gemini|codex|grok|antigravity|custom>] [--ai-command <명령>]\n" +
        "  mcp",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function runCommand(tokens: string[]): Promise<void> {
  const options = parseArgs(tokens);
  const vaultPath = requireOption(options, "vault");
  const notePath = requireOption(options, "note");
  const outputs = parseOutputs(options.outputs || "all");
  const styleIds = {
    slides: options["slide-style"] || null,
    infographic: options["infographic-style"] || null,
  };

  const ctx = await buildPipelineContext(vaultPath, notePath);
  if (options["ai-provider"]) ctx.settings.aiProvider = options["ai-provider"] as AiProviderId;
  if (options["ai-command"]) ctx.settings.aiCommand = options["ai-command"];
  const { results } = await runPipeline(ctx, { outputs, styleIds });
  printResults(results);
}

async function mcpCommand(): Promise<void> {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) await handleJsonRpc(line);
      newline = buffer.indexOf("\n");
    }
  }
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string };
}

async function handleJsonRpc(line: string): Promise<void> {
  let message: JsonRpcRequest;
  try {
    message = JSON.parse(line) as JsonRpcRequest;
  } catch {
    return;
  }
  if (typeof message.id !== "number") return;
  const id = message.id;

  try {
    if (message.method === "initialize") {
      send(id, {
        protocolVersion: message.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "sermon-multiplier", version: "0.1.0" },
      });
    } else if (message.method === "tools/list") {
      send(id, { tools: tools() });
    } else if (message.method === "tools/call") {
      send(id, await callTool(message.params));
    } else if (message.method === "ping") {
      send(id, {});
    } else {
      sendError(id, -32601, `알 수 없는 메서드: ${message.method}`);
    }
  } catch (error) {
    sendError(id, -32000, error instanceof Error ? error.message : String(error));
  }
}

function stringArg(args: Record<string, unknown>, key: string, fallback = ""): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

async function callTool(params: { name?: string; arguments?: Record<string, unknown> } = {}): Promise<unknown> {
  const name = params.name;
  const args = params.arguments || {};

  if (name === "generate_outputs") {
    const vaultPath = stringArg(args, "vaultDir");
    const ctx = await buildPipelineContext(vaultPath, stringArg(args, "notePath"));
    const outputs = parseOutputs(stringArg(args, "outputs", "all"));
    const { results } = await runPipeline(ctx, {
      outputs,
      styleIds: {
        slides: stringArg(args, "slideStyleId") || null,
        infographic: stringArg(args, "infographicStyleId") || null,
      },
    });
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }

  if (name === "generate_landing_page") {
    const result = await generateLandingPage({
      vaultPath: stringArg(args, "vaultDir"),
      notePath: stringArg(args, "notePath"),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "reembed_output") {
    await reembedOutput(
      { vaultPath: stringArg(args, "vaultDir"), notePath: stringArg(args, "notePath") },
      stringArg(args, "kind") as "infographic" | "slides" | "video" | "audio",
      stringArg(args, "sizeId", "medium"),
    );
    return { content: [{ type: "text", text: "임베드 크기를 변경했습니다." }] };
  }

  if (name === "list_slide_styles") {
    const presets = await listSlideStylePresets(join(stringArg(args, "vaultDir"), ".sermon-multiplier", "slide-styles"));
    return { content: [{ type: "text", text: JSON.stringify(presets.map((p) => ({ id: p.id, title: p.title })), null, 2) }] };
  }

  throw new Error(`알 수 없는 툴: ${name}`);
}

function tools() {
  return [
    {
      name: "generate_outputs",
      description: "설교 노트 하나로 산출물을 생성한다(NotebookLM 인포그래픽/슬라이드/영상/음성 + 로컬 AI 요약/큐티/성경공부).",
      inputSchema: {
        type: "object",
        required: ["vaultDir", "notePath"],
        properties: {
          vaultDir: { type: "string", description: "옵시디언 Vault 절대경로" },
          notePath: { type: "string", description: "Vault 루트 기준 설교 노트 상대경로" },
          outputs: { type: "string", description: "all 또는 콤마로 구분된 산출물 목록" },
          slideStyleId: { type: "string" },
          infographicStyleId: { type: "string" },
        },
      },
    },
    {
      name: "generate_landing_page",
      description: "이미 생성된 산출물을 모아 통합 랜딩페이지(.html)를 생성/갱신한다.",
      inputSchema: {
        type: "object",
        required: ["vaultDir", "notePath"],
        properties: { vaultDir: { type: "string" }, notePath: { type: "string" } },
      },
    },
    {
      name: "reembed_output",
      description: "이미 업로드된 Drive 산출물의 임베드 크기만 재생성 없이 바꾼다.",
      inputSchema: {
        type: "object",
        required: ["vaultDir", "notePath", "kind", "sizeId"],
        properties: {
          vaultDir: { type: "string" },
          notePath: { type: "string" },
          kind: { type: "string", enum: ["infographic", "slides", "video", "audio"] },
          sizeId: { type: "string" },
        },
      },
    },
    {
      name: "list_slide_styles",
      description: "Vault에 등록된 슬라이드 비주얼 스타일 프리셋 목록을 반환한다.",
      inputSchema: {
        type: "object",
        required: ["vaultDir"],
        properties: { vaultDir: { type: "string" } },
      },
    },
  ];
}

async function buildPipelineContext(vaultPath: string, notePathOverride?: string): Promise<PipelineContext> {
  const slideStylesDir = join(vaultPath, ".sermon-multiplier", "slide-styles");
  await ensureSlideStylesSeeded(slideStylesDir);

  const secrets = await loadDriveSecrets();
  const settings: SermonMultiplierSettings = { ...DEFAULT_SETTINGS };

  return {
    vaultPath,
    notePath: notePathOverride ?? "",
    settings,
    driveUploader: createDriveUploader(secrets, openUrlCli, async (tokens) => {
      await saveDriveSecrets({
        googleAccessToken: tokens.accessToken,
        googleRefreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
      });
    }),
    slideStylesDir,
  };
}

function openUrlCli(url: string): void {
  const opener = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  console.log(`브라우저에서 다음 주소를 열어 Google 로그인을 완료하세요:\n${url}`);
  exec(`${opener} "${url}"`, () => {
    // 자동으로 열리지 않아도 위 안내 문구로 수동 진행 가능하므로 실패를 무시한다.
  });
}

function parseOutputs(value: string): OutputKind[] {
  if (value === "all") return ALL_GENERATABLE_OUTPUTS;
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v): v is OutputKind => (ALL_GENERATABLE_OUTPUTS as string[]).includes(v));
}

function printResults(results: OutputRunState[]): void {
  for (const result of results) {
    const mark = result.status === "complete" ? "✅" : result.status === "error" ? "❌" : "…";
    console.log(`${mark} ${result.kind}: ${result.status}${result.message ? ` — ${result.message}` : ""}`);
  }
}

function send(id: number, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function sendError(id: number, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function parseArgs(tokens: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token || !token.startsWith("--")) throw new Error(`예상치 못한 인자: ${token}`);
    const key = token.slice(2);
    const value = tokens[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token}의 값이 필요합니다.`);
    options[key] = value;
    i += 1;
  }
  return options;
}

function requireOption(options: Record<string, string>, key: string): string {
  const value = options[key];
  if (!value) throw new Error(`--${key} 옵션이 필요합니다.`);
  return value;
}
