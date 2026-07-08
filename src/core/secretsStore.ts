// Google OAuth 비밀정보 저장소 (설계문서 5장).
// 옵시디언 data.json이 아니라 Vault 밖 ~/.sermon-multiplier.env(파일 권한 600)에 저장한다 —
// iCloud/Git 등 Vault 동기화로 인한 유출 사고를 막기 위함(reallygood-research와 동일한 방식).
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DriveSecrets, EMPTY_DRIVE_SECRETS } from "../types";

export function defaultSecretsFile(): string {
  const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
  return join(home, ".sermon-multiplier.env");
}

export async function loadDriveSecrets(secretsFile: string = defaultSecretsFile()): Promise<DriveSecrets> {
  const values = await readEnvFile(secretsFile);
  return {
    googleClientId: values.GOOGLE_CLIENT_ID || EMPTY_DRIVE_SECRETS.googleClientId,
    googleClientSecret: values.GOOGLE_CLIENT_SECRET || EMPTY_DRIVE_SECRETS.googleClientSecret,
    googleAccessToken: values.GOOGLE_ACCESS_TOKEN || EMPTY_DRIVE_SECRETS.googleAccessToken,
    googleRefreshToken: values.GOOGLE_REFRESH_TOKEN || EMPTY_DRIVE_SECRETS.googleRefreshToken,
    tokenExpiresAt: Number(values.GOOGLE_TOKEN_EXPIRES_AT || 0),
  };
}

export async function saveDriveSecrets(
  patch: Partial<DriveSecrets>,
  secretsFile: string = defaultSecretsFile(),
): Promise<DriveSecrets> {
  const merged = { ...(await loadDriveSecrets(secretsFile)), ...patch };
  const lines = [
    `GOOGLE_CLIENT_ID=${quoteEnv(merged.googleClientId)}`,
    `GOOGLE_CLIENT_SECRET=${quoteEnv(merged.googleClientSecret)}`,
    `GOOGLE_ACCESS_TOKEN=${quoteEnv(merged.googleAccessToken)}`,
    `GOOGLE_REFRESH_TOKEN=${quoteEnv(merged.googleRefreshToken)}`,
    `GOOGLE_TOKEN_EXPIRES_AT=${quoteEnv(String(merged.tokenExpiresAt))}`,
  ];
  await mkdir(dirname(secretsFile), { recursive: true });
  await writeFile(secretsFile, `${lines.join("\n")}\n`, "utf8");
  await chmod(secretsFile, 0o600);
  return merged;
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  let body = "";
  try {
    body = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }

  const values: Record<string, string> = {};
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    values[trimmed.slice(0, index).trim()] = unquoteEnv(trimmed.slice(index + 1).trim());
  }
  return values;
}

function quoteEnv(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function unquoteEnv(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
  return value;
}
