// 로컬 AI CLI(설교문 요약/큐티/성경공부)에 넘길 기본 프롬프트 템플릿.
// 사용자가 설정 화면의 "프롬프트 템플릿" 탭에서 직접 수정할 수 있으며,
// 여기 정의된 값은 그 초기값(seed)이다.
import { PromptTemplates, SermonFrontmatter } from "../types";

export const DEFAULT_PROMPT_TEMPLATES: PromptTemplates = {
  summary: [
    "당신은 설교 요약을 돕는 조교입니다. 아래 설교 본문을 A4 1장 분량(약 800~1000자)으로 요약하세요.",
    "핵심 대지(3개 이내)와 각 대지의 적용점을 중심으로 정리하고, 원문의 신학적 의미를 왜곡하지 마세요.",
    "",
    "제목: {{TITLE}}",
    "본문 구절: {{SCRIPTURE}}",
    "설교 날짜: {{DATE}}",
    "",
    "=== 설교 본문 ===",
    "{{BODY}}",
    "=== 설교 본문 끝 ===",
    "",
    "출력 형식: 마크다운. '## 핵심 요약' 아래 대지별 소제목과 적용점을 정리하세요.",
  ].join("\n"),

  qt: [
    "당신은 개인 큐티(QT) 자료를 만드는 조교입니다. 아래 설교를 바탕으로 2일치 큐티 자료를 작성하세요.",
    "각 일차는 '본문 읽기 안내 → 묵상 질문 3개 → 적용 → 기도문' 순서로 구성합니다.",
    "묵상 질문은 스스로 생각하고 답을 적을 수 있는 열린 질문으로 작성하세요.",
    "",
    "제목: {{TITLE}}",
    "본문 구절: {{SCRIPTURE}}",
    "설교 날짜: {{DATE}}",
    "",
    "=== 설교 본문 ===",
    "{{BODY}}",
    "=== 설교 본문 끝 ===",
    "",
    "출력 형식: 마크다운. '## 1일차', '## 2일차' 두 섹션으로 나누세요.",
  ].join("\n"),

  bible_study: [
    "당신은 소그룹 성경공부 교재를 만드는 조교입니다. 아래 설교를 바탕으로 40~60분 모임 기준 성경공부자료를 작성하세요.",
    "순서: 아이스브레이킹 → 본문 관찰 → 본문 해석 → 삶 적용 나눔 → 마무리 기도.",
    "각 순서마다 리더가 그대로 읽고 진행할 수 있도록 구체적인 질문과 진행 안내를 포함하세요.",
    "",
    "제목: {{TITLE}}",
    "본문 구절: {{SCRIPTURE}}",
    "설교 날짜: {{DATE}}",
    "",
    "=== 설교 본문 ===",
    "{{BODY}}",
    "=== 설교 본문 끝 ===",
    "",
    "출력 형식: 마크다운. 위 5단계를 '##' 소제목으로 구분하세요.",
  ].join("\n"),
};

export function renderPrompt(template: string, frontmatter: SermonFrontmatter, body: string): string {
  return template
    .replaceAll("{{TITLE}}", frontmatter.title || "(제목 없음)")
    .replaceAll("{{SCRIPTURE}}", frontmatter.scripture || "(본문 구절 없음)")
    .replaceAll("{{DATE}}", frontmatter.date || "(날짜 없음)")
    .replaceAll("{{BODY}}", body.trim());
}

export function resolvePromptTemplate(
  kind: "summary" | "qt" | "bible_study",
  overrides: PromptTemplates,
): string {
  const override = overrides[kind]?.trim();
  return override ? override : DEFAULT_PROMPT_TEMPLATES[kind];
}
