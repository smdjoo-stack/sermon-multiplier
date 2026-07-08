// 임베드 역기록 계층 (설계문서 6장).
// 전 파일 유형(이미지 포함)을 Drive `/preview` iframe으로 통일한다 — obsidian-embedder가
// 겪은 25MB 이상 파일의 "처리 중" 오류/바이러스 검사 리다이렉트 문제를 피하기 위함.
// 로컬 AI CLI 산출물(요약/큐티/성경공부)은 Drive가 아니라 Vault 파일이므로 위키링크로 남긴다.
import { DriveUploadResult, OUTPUT_LABELS, OutputKind, SizeCategory, SizeOption } from "../types";
import { driveFilePreviewUrl } from "./gdriveClient";

export const SIZE_PRESETS: Record<SizeCategory, SizeOption[]> = {
  video: [
    { id: "compact", label: "Compact", width: "60%", height: "280px" },
    { id: "medium", label: "Medium", width: "80%", height: "400px", recommended: true },
    { id: "large", label: "Large", width: "100%", height: "500px" },
    { id: "fullwidth", label: "Full width", width: "100%", height: "600px" },
  ],
  document: [
    { id: "compact", label: "Compact", width: "70%", height: "400px" },
    { id: "medium", label: "Medium", width: "100%", height: "500px", recommended: true },
    { id: "large", label: "Large", width: "100%", height: "650px" },
    { id: "fullwidth", label: "Full width", width: "100%", height: "800px" },
  ],
  image: [
    { id: "compact", label: "Compact", width: "400px", height: "300px" },
    { id: "medium", label: "Medium", width: "600px", height: "450px", recommended: true },
    { id: "large", label: "Large", width: "100%", height: "600px" },
    { id: "fullwidth", label: "Full width", width: "100%", height: "800px" },
  ],
  audio: [
    { id: "slim", label: "Slim", width: "100%", height: "100px", recommended: true },
    { id: "standard", label: "Standard", width: "100%", height: "120px" },
  ],
};

const CATEGORY_BY_OUTPUT: Partial<Record<OutputKind, SizeCategory>> = {
  infographic: "image",
  slides: "document",
  video: "video",
  audio: "audio",
};

export function categoryForOutput(kind: OutputKind): SizeCategory {
  return CATEGORY_BY_OUTPUT[kind] || "document";
}

export function getSizePresets(category: SizeCategory): SizeOption[] {
  return SIZE_PRESETS[category];
}

export function getRecommendedSize(category: SizeCategory): SizeOption {
  const presets = SIZE_PRESETS[category];
  return presets.find((preset) => preset.recommended) || presets[0]!;
}

export function getSizeById(category: SizeCategory, sizeId: string): SizeOption {
  return SIZE_PRESETS[category].find((preset) => preset.id === sizeId) || getRecommendedSize(category);
}

export function generateDriveEmbed(result: DriveUploadResult, size: SizeOption): string {
  const previewUrl = driveFilePreviewUrl(result.fileId);
  return `<iframe src="${previewUrl}" width="${size.width}" height="${size.height}" allow="autoplay" style="border-radius:8px;border:1px solid var(--background-modifier-border);"></iframe>`;
}

export function generateWikilink(vaultFileBaseName: string): string {
  return `[[${vaultFileBaseName}]]`;
}

const SECTION_HEADING = "## 산출물";

// "## 산출물" 섹션 안에서 kind에 해당하는 "### <라벨>" 하위 섹션만 갱신하고 나머지는 보존한다.
export function upsertOutputSection(body: string, kind: OutputKind, markup: string): string {
  const label = OUTPUT_LABELS[kind];
  const subheading = `### ${label}`;
  const sectionRange = findSectionRange(body, SECTION_HEADING);

  if (!sectionRange) {
    const appended = `${body.trimEnd()}\n\n${SECTION_HEADING}\n\n${subheading}\n\n${markup}\n`;
    return appended;
  }

  const { start, end } = sectionRange;
  const sectionBody = body.slice(start, end);
  const updatedSectionBody = upsertSubsection(sectionBody, subheading, markup);
  return body.slice(0, start) + updatedSectionBody + body.slice(end);
}

function findSectionRange(body: string, heading: string): { start: number; end: number } | null {
  const headingPattern = new RegExp(`^${escapeRegExp(heading)}\\s*$`, "m");
  const match = headingPattern.exec(body);
  if (!match) return null;

  const start = match.index;
  const afterHeading = start + match[0].length;
  const rest = body.slice(afterHeading);
  const nextTopHeading = rest.search(/\n## (?!#)/);
  const end = nextTopHeading === -1 ? body.length : afterHeading + nextTopHeading + 1;
  return { start, end };
}

function upsertSubsection(sectionBody: string, subheading: string, markup: string): string {
  const pattern = new RegExp(`(^|\\n)${escapeRegExp(subheading)}\\n\\n[\\s\\S]*?(?=\\n### |$)`);
  const replacement = `$1${subheading}\n\n${markup}\n`;
  if (pattern.test(sectionBody)) {
    return sectionBody.replace(pattern, replacement);
  }
  return `${sectionBody.trimEnd()}\n\n${subheading}\n\n${markup}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
