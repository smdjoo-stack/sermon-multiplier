// 슬라이드 비주얼 스타일 프리셋을 Vault/.sermon-multiplier/slide-styles/*.md 에서 읽고 쓴다.
// 프리셋은 "상세 가이드형"과 "단문 지시형"을 구분하지 않고, 파일 내용을 그대로 프롬프트에 삽입한다.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SlideStylePreset } from "../types";

export async function listSlideStylePresets(slideStylesDir: string): Promise<SlideStylePreset[]> {
  let entries: string[] = [];
  try {
    entries = (await readdir(slideStylesDir)).filter((name) => name.endsWith(".md")).sort();
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const presets: SlideStylePreset[] = [];
  for (const fileName of entries) {
    const filePath = join(slideStylesDir, fileName);
    const body = await readFile(filePath, "utf8");
    presets.push({
      id: fileName.replace(/\.md$/, ""),
      fileName,
      title: extractTitle(body) || fileName,
      body,
    });
  }
  return presets;
}

export async function getSlideStylePreset(
  slideStylesDir: string,
  id: string,
): Promise<SlideStylePreset | null> {
  const presets = await listSlideStylePresets(slideStylesDir);
  return presets.find((preset) => preset.id === id) || null;
}

// 최초 실행 시 Vault에 프리셋 폴더가 없으면 seeds/slide-styles의 기본 3종을 복사해 넣는다.
export async function ensureSlideStylesSeeded(slideStylesDir: string, seedsDir: string): Promise<void> {
  const existing = await listSlideStylePresets(slideStylesDir);
  if (existing.length > 0) return;

  await mkdir(slideStylesDir, { recursive: true });
  let seedFiles: string[] = [];
  try {
    seedFiles = (await readdir(seedsDir)).filter((name) => name.endsWith(".md"));
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }

  for (const fileName of seedFiles) {
    const content = await readFile(join(seedsDir, fileName), "utf8");
    await writeFile(join(slideStylesDir, fileName), content, "utf8");
  }
}

function extractTitle(body: string): string | null {
  const headingMatch = body.match(/^##\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  const firstLine = body.split(/\r?\n/).find((line) => line.trim().length > 0);
  return firstLine ? firstLine.trim().slice(0, 60) : null;
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}
