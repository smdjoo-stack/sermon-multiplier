// 빌드 시점에 esbuild text-loader로 번들에 내장되는 시드 콘텐츠.
// 커뮤니티 플러그인 배포판은 main.js 외의 별도 폴더(seeds/)를 설치하지 않으므로,
// 런타임 fs 읽기 대신 문자열 상수로 박아 넣는다.
import landingPageTemplate from "../../seeds/landing-page-template.html";
import slideStyle01 from "../../seeds/slide-styles/01_tilt-shift-miniature.md";
import slideStyle02 from "../../seeds/slide-styles/02_claymation.md";
import slideStyle03 from "../../seeds/slide-styles/03_handwritten-notebook.md";

export const LANDING_PAGE_TEMPLATE: string = landingPageTemplate;

export interface SeedSlideStyle {
  fileName: string;
  content: string;
}

export const DEFAULT_SLIDE_STYLE_SEEDS: SeedSlideStyle[] = [
  { fileName: "01_tilt-shift-miniature.md", content: slideStyle01 },
  { fileName: "02_claymation.md", content: slideStyle02 },
  { fileName: "03_handwritten-notebook.md", content: slideStyle03 },
];
