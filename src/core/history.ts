// 실행 이력 기록: Vault/.sermon-multiplier/history/<슬러그>.json
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OutputRunState } from "../types";

export interface RunHistoryRecord {
  notePath: string;
  startedAt: string;
  finishedAt: string;
  results: OutputRunState[];
}

export async function writeRunHistory(historyDir: string, slug: string, record: RunHistoryRecord): Promise<void> {
  await mkdir(historyDir, { recursive: true });
  const filePath = join(historyDir, `${slug}.json`);
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export function slugifyNotePath(notePath: string): string {
  return notePath
    .replace(/\.md$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "sermon";
}
