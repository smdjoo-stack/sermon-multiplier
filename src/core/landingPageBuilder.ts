// 통합 랜딩페이지 생성기 (산출물 8, 설계문서 7장).
// seeds/landing-page-template.html(모바일 카드형 + 색상별 버튼 리스트)에 실데이터를 바인딩한다.
// 옵시디언 API에 의존하지 않는 순수 정적 HTML(단일 파일, 인라인 CSS/JS)을 만든다.
// Drive 산출물(슬라이드/영상/음성)은 "열기 ↗" 외부 링크 버튼으로, 로컬 텍스트 산출물
// (요약/큐티/성경공부)은 클릭하면 펼쳐지는 <details> 아코디언 버튼으로 표시한다.
import { DriveUploadResult, OutputKind, SermonFrontmatter } from "../types";
import { driveFilePreviewUrl } from "./gdriveClient";
import { splitByH2 } from "./markdown";

export interface LandingPageData {
  frontmatter: SermonFrontmatter;
  noteFileName: string;
  infographic: DriveUploadResult | null;
  slides: DriveUploadResult | null;
  video: DriveUploadResult | null;
  audio: DriveUploadResult | null;
  summaryMarkdown: string | null;
  qtMarkdown: string | null;
  bibleStudyMarkdown: string | null;
}

const ACCENT: Record<OutputKind, string> = {
  infographic: "accent-summary",
  summary: "accent-summary",
  slides: "accent-slides",
  video: "accent-video",
  audio: "accent-audio",
  qt: "accent-qt",
  bible_study: "accent-study",
  landing_page: "accent-summary",
};

export function buildLandingPage(template: string, data: LandingPageData): string {
  const { frontmatter } = data;

  let html = template
    .replaceAll("{{TITLE}}", escapeHtml(frontmatter.title || "(제목 없음)"))
    .replaceAll("{{SCRIPTURE}}", escapeHtml(frontmatter.scripture || ""))
    .replaceAll("{{DATE}}", escapeHtml(frontmatter.date || ""))
    .replaceAll("{{SERIES}}", escapeHtml(frontmatter.series || "설교"))
    .replaceAll("{{NOTE_FILENAME}}", escapeHtml(data.noteFileName))
    .replaceAll("{{GENERATED_AT}}", escapeHtml(new Date().toISOString().slice(0, 16).replace("T", " ")));

  html = replaceMarker(html, "INFOGRAPHIC_CONTENT", buildInfographic(data.infographic));
  html = replaceMarker(html, "OUTPUT_LIST", buildOutputList(data));

  return html;
}

function replaceMarker(html: string, marker: string, content: string): string {
  const pattern = new RegExp(`<!--${marker}-->[\\s\\S]*?<!--/${marker}-->`);
  return html.replace(pattern, content);
}

function buildInfographic(result: DriveUploadResult | null): string {
  if (!result) return emptyState("인포그래픽이 아직 생성되지 않았습니다.");
  const previewUrl = driveFilePreviewUrl(result.fileId);
  return `<a href="${result.webViewLink}" target="_blank" rel="noreferrer">
<img class="infographic-img" src="https://drive.google.com/thumbnail?id=${result.fileId}&sz=w1000" alt="인포그래픽" onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('iframe'),{src:'${previewUrl}',className:'infographic-img',style:'height:360px;border:0;'}));">
</a>`;
}

function buildOutputList(data: LandingPageData): string {
  return [
    accordionButton("summary", "📝 설교문 요약 보기", data.summaryMarkdown, (md) => {
      const sections = splitByH2(md);
      return sections.length
        ? sections.map((s) => renderMarkdownFragment(s.body)).join("\n")
        : renderMarkdownFragment(md);
    }),
    linkButton("slides", "🖥️ 슬라이드 자료", data.slides),
    linkButton("video", "🎬 영상 자료 보기", data.video),
    linkButton("audio", "🎧 음성 자료 듣기", data.audio),
    accordionButton("qt", "🙏 개인 큐티 자료", data.qtMarkdown, (md) => {
      const sections = splitByH2(md);
      if (!sections.length) return renderMarkdownFragment(md);
      return sections
        .map((s) => `<h3>${escapeHtml(s.title)}</h3>${renderMarkdownFragment(s.body)}`)
        .join("\n");
    }),
    accordionButton("bible_study", "📖 성경 공부 자료", data.bibleStudyMarkdown, (md) => {
      const sections = splitByH2(md);
      if (!sections.length) return renderMarkdownFragment(md);
      return sections
        .map((s) => `<h3>${escapeHtml(s.title)}</h3>${renderMarkdownFragment(s.body)}`)
        .join("\n");
    }),
  ].join("\n");
}

function linkButton(kind: OutputKind, label: string, result: DriveUploadResult | null): string {
  if (!result) {
    return `<div class="output-btn ${ACCENT[kind]} is-empty"><span>${label}</span><span class="open">미생성</span></div>`;
  }
  return `<a class="output-btn ${ACCENT[kind]}" href="${result.webViewLink}" target="_blank" rel="noreferrer"><span>${label}</span><span class="open">열기 ↗</span></a>`;
}

function accordionButton(
  kind: OutputKind,
  label: string,
  markdown: string | null,
  render: (markdown: string) => string,
): string {
  if (!markdown) {
    return `<div class="output-btn ${ACCENT[kind]} is-empty"><span>${label}</span><span class="open">미생성</span></div>`;
  }
  return `<details class="output-btn ${ACCENT[kind]}"><summary><span>${label}</span><span class="open">펼치기 ▾</span></summary><div class="accordion-body">${render(markdown)}</div></details>`;
}

function emptyState(message: string): string {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

// 최소 마크다운 -> HTML 변환기: 문단/목록/굵게만 지원한다(랜딩페이지 카드에 필요한 만큼만).
function renderMarkdownFragment(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let listItems: string[] = [];
  let listTag: "ul" | "ol" | null = null;

  const flushList = () => {
    if (!listTag) return;
    html.push(`<${listTag}>${listItems.map((item) => `<li>${item}</li>`).join("")}</${listTag}>`);
    listItems = [];
    listTag = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (unordered) {
      if (listTag !== "ul") {
        flushList();
        listTag = "ul";
      }
      listItems.push(renderInline(unordered[1]!));
      continue;
    }
    if (ordered) {
      if (listTag !== "ol") {
        flushList();
        listTag = "ol";
      }
      listItems.push(renderInline(ordered[1]!));
      continue;
    }
    flushList();
    html.push(`<p>${renderInline(line)}</p>`);
  }
  flushList();
  return html.join("\n");
}

function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
