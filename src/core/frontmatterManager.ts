// 설교 노트의 YAML frontmatter를 읽고 쓰는 순수 모듈.
// 옵시디언 API에 의존하지 않아 플러그인/CLI/MCP 세 진입점이 모두 재사용한다.
import yaml from "js-yaml";
import { defaultFrontmatter, SermonFrontmatter } from "../types";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface ParsedSermonNote {
  frontmatter: SermonFrontmatter;
  body: string;
}

export function parseSermonNote(content: string): ParsedSermonNote {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) {
    return { frontmatter: defaultFrontmatter(), body: content };
  }

  // JSON_SCHEMA를 써서 "2026-07-05" 같은 날짜 형식 문자열이 JS Date로 암시적 변환되는 것을 막는다
  // (기본 스키마는 YAML 1.1 타임스탬프 태그를 적용해 date를 "2026-07-05T00:00:00.000Z"로 바꿔버린다).
  const raw = yaml.load(match[1]!, { schema: yaml.JSON_SCHEMA });
  const parsed = raw && typeof raw === "object" ? (raw as Partial<SermonFrontmatter>) : {};
  const frontmatter = mergeWithDefaults(parsed);
  const body = content.slice(match[0].length);
  return { frontmatter, body };
}

export function serializeSermonNote(frontmatter: SermonFrontmatter, body: string): string {
  const yamlText = yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    schema: yaml.JSON_SCHEMA,
  });
  return `---\n${yamlText}---\n${body}`;
}

// 특정 필드만 갱신하고 나머지 frontmatter는 그대로 보존한다(멱등성 원칙).
export function applyFrontmatterPatch(
  content: string,
  patch: (fm: SermonFrontmatter) => SermonFrontmatter,
): string {
  const { frontmatter, body } = parseSermonNote(content);
  const updated = patch(frontmatter);
  return serializeSermonNote(updated, body);
}

function mergeWithDefaults(parsed: Partial<SermonFrontmatter>): SermonFrontmatter {
  const base = defaultFrontmatter();
  return {
    ...base,
    ...parsed,
    outputs: { ...base.outputs, ...(parsed.outputs || {}) },
    notebooklm: { ...base.notebooklm, ...(parsed.notebooklm || {}) },
    gdrive: { ...base.gdrive, ...(parsed.gdrive || {}) },
  };
}
