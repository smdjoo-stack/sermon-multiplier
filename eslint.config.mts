import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores, defineConfig } from "eslint/config";

export default defineConfig(
  globalIgnores([
    "node_modules",
    "dist",
    "seeds",
    "bin",
    "esbuild.config.mjs",
    "esbuild.cli.mjs",
    "version-bump.mjs",
    "versions.json",
    "main.js",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
  ]),
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mts", "manifest.json"],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".json"],
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    // src/core/**는 옵시디언 플러그인과 독립 CLI/MCP 서버(순수 Node)가 함께 쓰는 공유 모듈이다.
    // requestUrl과 window.setTimeout은 옵시디언 전용 API라 CLI에서 쓸 수 없으므로,
    // 두 환경 모두에서 동작하는 전역 fetch/setTimeout을 의도적으로 사용한다.
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-globals": "off",
      "obsidianmd/prefer-window-timers": "off",
    },
  },
  {
    // cli.ts는 옵시디언 플러그인 번들에 포함되지 않는 별도 CLI 진입점이라
    // console 출력이 유일한 사용자 인터페이스다.
    files: ["src/cli.ts"],
    rules: {
      "obsidianmd/rule-custom-message": "off",
    },
  },
);
