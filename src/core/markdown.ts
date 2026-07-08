// "## 제목" 단위로 마크다운을 분할하는 공유 유틸.
// 큐티 1/2일차 파일 분리(pipeline.ts)와 랜딩페이지 섹션 렌더링(landingPageBuilder.ts)이 함께 쓴다.
export interface MarkdownSection {
  title: string;
  body: string;
}

export function splitByH2(markdown: string): MarkdownSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      if (current) sections.push(current);
      current = { title: heading[1]!.trim(), body: "" };
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) sections.push(current);
  return sections;
}
