// esbuild가 --loader:.html=text, .md=text 로 문자열 임포트를 번들에 내장한다.
// 커뮤니티 플러그인 배포판은 main.js/manifest.json/styles.css만 설치되므로,
// seeds/ 폴더 내용은 런타임 fs 읽기가 아니라 빌드 시점에 문자열로 박아 넣어야 한다.
declare module "*.html" {
  const content: string;
  export default content;
}

declare module "*.md" {
  const content: string;
  export default content;
}
