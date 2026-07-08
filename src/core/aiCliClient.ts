// 로컬 AI CLI 연동 계층 (산출물 5~7: 설교문 요약/큐티/성경공부자료).
// API 키를 저장하지 않고, 이미 로그인된 로컬 CLI에 프롬프트를 stdin으로 흘려보낸다.
// reallygood-research의 PATH 자동탐색 + spawn 패턴을 그대로 포팅했다.
import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { AiProviderId, DEFAULT_AI_CLI_TIMEOUT_SECONDS } from "../types";

interface AiCliProviderConfig {
  names: string[];
  args: string;
}

const AI_CLI_PROVIDERS: Record<Exclude<AiProviderId, "custom">, AiCliProviderConfig> = {
  codex: { names: commandNames("codex"), args: "exec -" },
  claude: { names: commandNames("claude"), args: "-p" },
  gemini: { names: commandNames("gemini"), args: "-p" },
  grok: { names: commandNames("grok"), args: process.platform === "win32" ? "-p" : '-p "$(cat)"' },
  antigravity: {
    names:
      process.platform === "win32"
        ? ["agy.exe", "agy.cmd", "agy.ps1", "agy", "antigravity.exe", "antigravity.cmd", "antigravity.ps1", "antigravity"]
        : ["agy", "antigravity"],
    // agy의 -p/--print는 값이 필요한 플래그라 stdin만으로는 "flag needs an argument: -p" 오류가 난다.
    // grok과 같은 방식으로 stdin을 $(cat)으로 읽어 인자로 넘긴다.
    args: process.platform === "win32" ? "-p" : '-p "$(cat)"',
  },
};

export async function resolveAiCommand(provider: AiProviderId, aiCommand: string): Promise<string> {
  if (provider === "custom") {
    if (!aiCommand.trim()) {
      throw new Error("aiProvider가 custom이면 aiCommand를 반드시 지정해야 합니다.");
    }
    return aiCommand;
  }
  if (aiCommand.trim()) return aiCommand;

  const config = AI_CLI_PROVIDERS[provider];
  const executable = (await findExecutable(config.names)) || config.names[0]!;
  return `${quoteShell(executable)} ${config.args}`;
}

export async function isAiCliAvailable(provider: AiProviderId): Promise<boolean> {
  if (provider === "custom") return true;
  const config = AI_CLI_PROVIDERS[provider];
  return (await findExecutable(config.names)) !== null;
}

export function runAiCommand(
  command: string,
  prompt: string,
  timeoutSeconds: number = DEFAULT_AI_CLI_TIMEOUT_SECONDS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: shellPath(),
      stdio: ["pipe", "pipe", "pipe"],
      env: shellEnv(),
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`AI CLI 실행이 시간 초과되었습니다(${timeoutSeconds}초): ${command}`));
    }, timeoutSeconds * 1000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`AI CLI 실행 실패 (종료 코드 ${code}): ${stderr.trim() || stdout.trim() || command}`));
    });

    child.stdin.end(prompt);
  });
}

async function findExecutable(names: string[]): Promise<string | null> {
  const paths = (await mergePath(process.env.PATH)).split(delimiter).filter(Boolean);
  for (const entry of paths) {
    for (const name of names) {
      const candidate = join(entry, name);
      try {
        if ((await stat(candidate)).isFile()) return candidate;
      } catch {
        // 후보 경로에 없으면 다음 후보를 계속 탐색한다.
      }
    }
  }
  return null;
}

function shellEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: mergePathSync(process.env.PATH) };
}

function mergePathSync(pathValue: string | undefined): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return uniquePathEntries([
    ...String(pathValue || "").split(delimiter),
    ...commonCliPathEntries(home),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".cargo", "bin"),
  ]).join(delimiter);
}

async function mergePath(pathValue: string | undefined): Promise<string> {
  return uniquePathEntries([...mergePathSync(pathValue).split(delimiter), ...(await listNodeVersionBins())]).join(
    delimiter,
  );
}

async function listNodeVersionBins(): Promise<string[]> {
  const root = join(process.env.HOME || "", ".nvm", "versions", "node");
  try {
    return (await readdir(root)).map((entry) => join(root, entry, "bin"));
  } catch {
    return [];
  }
}

function uniquePathEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const entry of entries) {
    const normalized = String(entry || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    paths.push(normalized);
  }
  return paths;
}

function shellPath(): string | boolean {
  if (process.platform === "win32") return true;
  return "/bin/zsh";
}

function quoteShell(value: string): string {
  if (process.platform === "win32") return `"${value.replaceAll('"', '\\"')}"`;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandNames(base: string): string[] {
  return process.platform === "win32" ? [`${base}.exe`, `${base}.cmd`, `${base}.ps1`, base] : [base];
}

function commonCliPathEntries(home: string): string[] {
  if (process.platform !== "win32") return [];
  const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
  return [
    join(appData, "npm"),
    join(localAppData, "Programs", "Codex"),
    join(localAppData, "Programs", "Claude"),
    join(localAppData, "Programs", "Gemini"),
    join(localAppData, "grok"),
    join(localAppData, "agy", "bin"),
    join(localAppData, "antigravity-cli"),
  ];
}
