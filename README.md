# Sermon Multiplier (sermon-multiplier)

설교 노트 하나(옵시디언 vault 안의 마크다운 파일)를 소스로 삼아 7가지 목회 산출물을 자동 생성하고, 이를 한 페이지에서 볼 수 있는 통합 랜딩페이지까지 만들어주는 옵시디언 플러그인입니다.

- **NotebookLM 산출물** (인포그래픽·슬라이드·영상·음성): Google NotebookLM Studio에서 생성해 Google Drive에 저장하고, 노트에 `/preview` iframe으로 임베드합니다.
- **로컬 AI CLI 산출물** (설교문 요약·큐티 2일치·성경공부자료): 이미 로그인된 로컬 AI CLI(Claude/Gemini/Codex/Grok/Antigravity)에 프롬프트를 넘겨 생성하고, Vault 안에 마크다운으로 저장합니다.
- **통합 랜딩페이지**: 위 7가지를 한 페이지(HTML)로 모아 공유합니다.

세부 설계는 `설교_멀티산출물_옵시디언플러그인_설계문서.md`(상위 폴더)를 참고하세요.

## 3중 인터페이스

- **옵시디언 플러그인**: 리본 아이콘 또는 명령어 팔레트 → "설교 산출물: 콘솔 열기"
- **독립 CLI**: `node bin/sermon-multiplier.mjs run --vault <Vault경로> --note <노트 상대경로> --outputs all`
- **MCP 서버**: `node bin/sermon-multiplier.mjs mcp` — `generate_outputs`, `generate_landing_page`, `reembed_output`, `list_slide_styles` 툴 노출

## 개발 빌드

```bash
npm install
npm run build      # main.js(옵시디언 플러그인) + dist/cli.mjs(CLI/MCP) 빌드
npm run typecheck  # tsc --noEmit
```

옵시디언에서 테스트하려면 `manifest.json`, `main.js`, `styles.css`를 Vault의 `.obsidian/plugins/sermon-multiplier/`에 복사하세요.

## 최초 설정

1. **Google Drive**: [Google Cloud Console](https://console.cloud.google.com)에서 OAuth 클라이언트(Desktop app)를 만들고 Client ID/Secret을 플러그인 설정 → Google Drive 탭에 입력한 뒤 Connect. Client ID/Secret과 토큰은 `data.json`이 아니라 `~/.sermon-multiplier.env`(파일 권한 600)에 저장됩니다.
2. **NotebookLM**: 터미널에서 최초 1회 로그인합니다.
   ```bash
   uvx --from notebooklm-mcp-cli nlm login
   ```
3. **로컬 AI CLI**: `claude`/`gemini`/`codex`/`grok`/`antigravity`(`agy`) 중 이미 로그인된 CLI를 설정에서 선택하세요.

## 리스크

- NotebookLM 자동화는 비공식 경로(서드파티 CLI) 의존 — 실패 시 산출물별로 개별 오류만 표시되고 나머지는 계속 진행됩니다(부분 성공 허용). 실패한 항목은 NotebookLM에서 수동으로 생성한 뒤 지정 폴더에 넣어주세요.
- 플러그인은 데스크톱 전용입니다(`isDesktopOnly: true`).
