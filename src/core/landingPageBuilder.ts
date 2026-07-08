// 통합 랜딩페이지 생성기 (산출물 8, 설계문서 7장).
// seeds/landing-page-template.html(프로토타입을 템플릿화한 것)에 실데이터를 바인딩한다.
// 옵시디언 API에 의존하지 않는 순수 정적 HTML(단일 파일, 인라인 CSS/JS)을 만든다.
import { DriveUploadResult, SermonFrontmatter } from "../types";
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

export function buildLandingPage(template: string, data: LandingPageData): string {
  const { frontmatter } = data;

  let html = template
    .replaceAll("{{TITLE}}", escapeHtml(frontmatter.title || "(제목 없음)"))
    .replaceAll("{{SCRIPTURE}}", escapeHtml(frontmatter.scripture || ""))
    .replaceAll("{{DATE}}", escapeHtml(frontmatter.date || ""))
    .replaceAll("{{SERIES}}", escapeHtml(frontmatter.series || "설교"))
    .replaceAll("{{NOTE_FILENAME}}", escapeHtml(data.noteFileName))
    .replaceAll("{{GENERATED_AT}}", escapeHtml(new Date().toISOString().slice(0, 16).replace("T", " ")));

  html = replaceMarker(html, "INFOGRAPHIC_CONTENT", buildMediaOrEmpty(data.infographic, "image", "인포그래픽"));
  html = replaceMarker(html, "SUMMARY_CONTENT", buildSummarySection(data.summaryMarkdown));
  html = replaceMarker(html, "SLIDES_CONTENT", buildSlidesSection(data.slides));
  html = replaceMarker(html, "VIDEO_CONTENT", buildVideoSection(data.video));
  html = replaceMarker(html, "AUDIO_CONTENT", buildAudioSection(data.audio));
  html = replaceMarker(html, "QT_CONTENT", buildQtSection(data.qtMarkdown));
  html = replaceMarker(html, "STUDY_CONTENT", buildStudySection(data.bibleStudyMarkdown));

  return html;
}

function replaceMarker(html: string, marker: string, content: string): string {
  const pattern = new RegExp(`<!--${marker}-->[\\s\\S]*?<!--/${marker}-->`);
  return html.replace(pattern, content);
}

function buildMediaOrEmpty(result: DriveUploadResult | null, _kind: string, label: string): string {
  if (!result) return emptyState(`${label}이(가) 아직 생성되지 않았습니다.`);
  return `<div class="infographic-box" style="aspect-ratio:auto;padding:0;overflow:hidden;">
<iframe src="${driveFilePreviewUrl(result.fileId)}" width="100%" height="420" style="border:0;border-radius:14px;"></iframe>
</div>
<div class="actions">
<a class="btn primary" href="${result.webViewLink}" target="_blank" rel="noreferrer">원본 이미지 열기</a>
</div>`;
}

function buildSummarySection(markdown: string | null): string {
  if (!markdown) return emptyState("설교문 요약본이 아직 생성되지 않았습니다.");
  const sections = splitByH2(markdown);
  const body = sections.length ? sections.map((s) => renderMarkdownFragment(s.body)).join("\n") : renderMarkdownFragment(markdown);
  return `<div class="card summary-text">${body}</div>`;
}

function buildSlidesSection(result: DriveUploadResult | null): string {
  if (!result) return emptyState("슬라이드가 아직 생성되지 않았습니다.");
  return `<div class="slide-frame">
<iframe src="${driveFilePreviewUrl(result.fileId)}"></iframe>
</div>
<div class="actions">
<a class="btn primary" href="${result.webViewLink}" target="_blank" rel="noreferrer">전체화면으로 보기</a>
</div>`;
}

function buildVideoSection(result: DriveUploadResult | null): string {
  if (!result) return emptyState("영상자료가 아직 생성되지 않았습니다.");
  return `<div class="frame-16-9">
<iframe src="${driveFilePreviewUrl(result.fileId)}" allow="autoplay; encrypted-media" allowfullscreen></iframe>
</div>`;
}

function buildAudioSection(result: DriveUploadResult | null): string {
  if (!result) return emptyState("음성자료가 아직 생성되지 않았습니다.");
  return `<div class="audio-player">
<iframe src="${driveFilePreviewUrl(result.fileId)}" allow="autoplay; encrypted-media"></iframe>
</div>`;
}

function buildQtSection(markdown: string | null): string {
  if (!markdown) return emptyState("개인 큐티자료가 아직 생성되지 않았습니다.");
  const sections = splitByH2(markdown);
  const day1 = sections[0] ? renderMarkdownFragment(sections[0].body) : renderMarkdownFragment(markdown);
  const day2 = sections[1] ? renderMarkdownFragment(sections[1].body) : "";

  return `<div class="card">
<div class="qt-tabs">
<button class="active" onclick="showDay(1,this)">${escapeHtml(sections[0]?.title || "1일차")}</button>
${sections[1] ? `<button onclick="showDay(2,this)">${escapeHtml(sections[1].title)}</button>` : ""}
</div>
<div class="qt-day active" id="qt-day-1">${day1}</div>
${sections[1] ? `<div class="qt-day" id="qt-day-2">${day2}</div>` : ""}
</div>`;
}

function buildStudySection(markdown: string | null): string {
  if (!markdown) return emptyState("성경공부자료가 아직 생성되지 않았습니다.");
  const sections = splitByH2(markdown);
  if (!sections.length) return `<div class="card">${renderMarkdownFragment(markdown)}</div>`;
  const blocks = sections
    .map((s) => `<div class="study-block"><h3>${escapeHtml(s.title)}</h3>${renderMarkdownFragment(s.body)}</div>`)
    .join("\n");
  return `<div class="card">${blocks}</div>`;
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
      listItems.push(renderInline(unordered[1]));
      continue;
    }
    if (ordered) {
      if (listTag !== "ol") {
        flushList();
        listTag = "ol";
      }
      listItems.push(renderInline(ordered[1]));
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
