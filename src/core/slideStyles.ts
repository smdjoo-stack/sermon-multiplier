// 슬라이드 비주얼 스타일 프리셋을 Vault/.sermon-multiplier/slide-styles/*.md 에서 읽고 쓴다.
// 프리셋은 "상세 가이드형"과 "단문 지시형"을 구분하지 않고, 본문을 그대로 프롬프트에 삽입한다.
// 각 프리셋 파일은 style_id/title을 담은 YAML frontmatter를 가질 수 있다.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { SlideStylePreset } from "../types";
import { DEFAULT_SLIDE_STYLE_SEEDS } from "./seeds";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

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
    const raw = await readFile(filePath, "utf8");
    presets.push(parsePreset(fileName, raw));
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

// 최초 실행 시 Vault에 프리셋 폴더가 없으면 빌드에 내장된 기본 3종을 복사해 넣는다.
export async function ensureSlideStylesSeeded(slideStylesDir: string): Promise<void> {
  const existing = await listSlideStylePresets(slideStylesDir);
  if (existing.length > 0) return;

  await mkdir(slideStylesDir, { recursive: true });
  for (const seed of DEFAULT_SLIDE_STYLE_SEEDS) {
    await writeFile(join(slideStylesDir, seed.fileName), seed.content, "utf8");
  }
}

function parsePreset(fileName: string, raw: string): SlideStylePreset {
  const match = raw.match(FRONTMATTER_PATTERN);
  const fallbackId = fileName.replace(/\.md$/, "");

  if (!match) {
    return { id: fallbackId, fileName, title: extractHeadingTitle(raw) || fallbackId, body: raw };
  }

  const frontmatter = (yaml.load(match[1]!) as { style_id?: string; title?: string }) || {};
  const body = raw.slice(match[0].length);
  return {
    id: frontmatter.style_id || fallbackId,
    fileName,
    title: frontmatter.title || extractHeadingTitle(body) || fallbackId,
    body,
  };
}

function extractHeadingTitle(body: string): string | null {
  const headingMatch = body.match(/^##\s+(.+)$/m);
  if (headingMatch) return headingMatch[1]!.trim();
  const firstLine = body.split(/\r?\n/).find((line) => line.trim().length > 0);
  return firstLine ? firstLine.trim().slice(0, 60) : null;
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}
