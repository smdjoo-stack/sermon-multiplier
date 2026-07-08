// 설정 화면 — 화면 구성 3번: Google Drive / NotebookLM / AI Provider / 프롬프트 템플릿 4개 탭.
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type SermonMultiplierPlugin from "../main";
import { buildDriveUploader } from "./services";
import { runNotebookLmLogin, testNotebookLmConnection } from "../core/notebooklmClient";
import { isAiCliAvailable, resolveAiCommand } from "../core/aiCliClient";
import { AiProviderId, DEFAULT_AI_CLI_TIMEOUT_SECONDS } from "../types";

const TABS = ["drive", "notebooklm", "ai", "prompts"] as const;
type TabId = (typeof TABS)[number];

const TAB_LABELS: Record<TabId, string> = {
  drive: "Google Drive",
  notebooklm: "NotebookLM",
  ai: "AI Provider",
  prompts: "프롬프트 템플릿",
};

export class SermonMultiplierSettingTab extends PluginSettingTab {
  plugin: SermonMultiplierPlugin;
  private activeTab: TabId = "drive";

  constructor(app: App, plugin: SermonMultiplierPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const tabBar = containerEl.createDiv({ cls: "sermon-multiplier-tabbar" });
    for (const tab of TABS) {
      const btn = tabBar.createEl("button", { text: TAB_LABELS[tab] });
      if (tab === this.activeTab) btn.addClass("mod-cta");
      btn.addEventListener("click", () => {
        this.activeTab = tab;
        this.display();
      });
    }

    const body = containerEl.createDiv();
    if (this.activeTab === "drive") this.renderDriveTab(body);
    else if (this.activeTab === "notebooklm") this.renderNotebookLmTab(body);
    else if (this.activeTab === "ai") this.renderAiTab(body);
    else this.renderPromptsTab(body);
  }

  private renderDriveTab(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    const secrets = this.plugin.secrets;
    const uploader = buildDriveUploader(secrets, async () => {});
    const connected = uploader?.isConnected() ?? false;

    new Setting(containerEl).setName("연결 상태").setHeading();
    containerEl.createDiv({ text: connected ? "✅ Google Drive에 연결되어 있습니다." : "❌ 연결되어 있지 않습니다." });
    containerEl.createEl("p", {
      text: "Client ID/secret과 토큰은 옵시디언 data.json이 아니라 ~/.sermon-multiplier.env(파일 권한 600)에 저장됩니다.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("Google Cloud Console에서 발급한 OAuth 클라이언트 ID (desktop app)")
      .addText((text) =>
        text
          .setPlaceholder("xxx.apps.googleusercontent.com")
          .setValue(secrets.googleClientId)
          .onChange(async (value) => {
            await this.plugin.saveSecrets({ googleClientId: value.trim() });
          }),
      );

    new Setting(containerEl)
      .setName("Client secret")
      .setDesc("GOCSPX-로 시작하는 값입니다.")
      .addText((text) =>
        text
          .setPlaceholder("GOCSPX-...")
          .setValue(secrets.googleClientSecret)
          .onChange(async (value) => {
            await this.plugin.saveSecrets({ googleClientSecret: value.trim() });
          }),
      );

    new Setting(containerEl)
      .setName("업로드 폴더 루트")
      .setDesc('설교별 하위 폴더가 이 아래에 자동 생성됩니다. 예: "설교자료/2026-07-05_물위를걷다"')
      .addText((text) =>
        text.setValue(settings.driveFolderRoot).onChange(async (value) => {
          settings.driveFolderRoot = value.trim() || "설교자료";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(connected ? "연결 해제" : "연결하기")
      .addButton((button) =>
        button
          .setButtonText(connected ? "Disconnect" : "Connect")
          .setCta()
          .onClick(async () => {
            if (connected) {
              await this.plugin.saveSecrets({ googleAccessToken: "", googleRefreshToken: "", tokenExpiresAt: 0 });
              this.display();
              return;
            }
            const flow = buildDriveUploader(secrets, async () => {});
            if (!flow) {
              new Notice("먼저 client ID/secret을 입력하세요.");
              return;
            }
            try {
              const tokens = await flow.connect();
              await this.plugin.saveSecrets({
                googleAccessToken: tokens.accessToken,
                googleRefreshToken: tokens.refreshToken,
                tokenExpiresAt: tokens.expiresAt,
              });
              new Notice("✅ Google Drive 연결 완료!");
              this.display();
            } catch (error) {
              new Notice(`❌ 연결 실패: ${error instanceof Error ? error.message : String(error)}`);
            }
          }),
      );

    this.renderDriveHelp(containerEl);
  }

  private renderDriveHelp(containerEl: HTMLElement): void {
    const details = containerEl.createEl("details");
    details.createEl("summary", { text: "📋 Google Drive 연결 방법 (처음이신가요?)" });

    const list = details.createEl("ol");

    const li1 = list.createEl("li");
    li1.createEl("a", {
      text: "Google Cloud Console",
      href: "https://console.cloud.google.com/",
      attr: { target: "_blank", rel: "noopener" },
    });
    li1.appendText("에서 새 프로젝트를 만듭니다.");

    const li2 = list.createEl("li");
    li2.createEl("a", {
      text: "API 및 서비스 → 라이브러리",
      href: "https://console.cloud.google.com/apis/library",
      attr: { target: "_blank", rel: "noopener" },
    });
    li2.appendText('에서 "Google Drive API"를 검색해 사용 설정합니다.');

    const li3 = list.createEl("li");
    li3.createEl("a", {
      text: "OAuth 동의 화면",
      href: "https://console.cloud.google.com/apis/credentials/consent",
      attr: { target: "_blank", rel: "noopener" },
    });
    li3.appendText(" 설정에서 User type은 External을 선택하고, 테스트 사용자에 본인 Google 계정을 반드시 추가합니다.");
    li3.createDiv({
      text: '테스트 사용자로 등록하지 않으면 연결 시 "액세스 차단됨" 오류가 납니다.',
      cls: "setting-item-description",
    });

    const li3b = list.createEl("li");
    li3b.appendText("같은 OAuth 동의 화면의 ");
    li3b.createEl("strong", { text: "데이터 액세스(Data access)" });
    li3b.appendText(' 메뉴 → ');
    li3b.createEl("strong", { text: "범위 추가 또는 삭제(Add or remove scopes)" });
    li3b.appendText(' → "drive.file"로 검색해 ');
    li3b.createEl("code", { text: ".../auth/drive.file" });
    li3b.appendText("를 체크하고 업데이트·저장합니다.");
    li3b.createDiv({
      text: '이 단계를 건너뛰면 로그인은 되지만 실제 업로드에서 "403" 오류가 납니다.',
      cls: "setting-item-description",
    });

    const li4 = list.createEl("li");
    li4.createEl("a", {
      text: "사용자 인증 정보",
      href: "https://console.cloud.google.com/apis/credentials",
      attr: { target: "_blank", rel: "noopener" },
    });
    li4.appendText(' 페이지에서 "+ 사용자 인증 정보 만들기 → OAuth 클라이언트 ID"를 선택하고, 애플리케이션 유형은 반드시 ');
    li4.createEl("strong", { text: "데스크톱 앱(Desktop app)" });
    li4.appendText("으로 만듭니다.");

    list.createEl("li", {
      text: "생성 완료 화면에 뜨는 클라이언트 ID와 클라이언트 보안 비밀(GOCSPX-로 시작)을 위 입력칸에 붙여넣고 Connect를 누릅니다.",
    });
    list.createEl("li", {
      text: '"Google에서 확인하지 않은 앱" 경고가 뜨면 고급 → (앱 이름)로 이동(안전하지 않음)을 클릭합니다 — 본인이 만든 앱이라 안전합니다.',
    });
  }

  private renderNotebookLmTab(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;

    new Setting(containerEl).setName("로그인").setHeading();
    const statusEl = containerEl.createDiv({ text: "아직 확인하지 않았습니다. \"연결 테스트\"를 눌러 확인하세요." });

    new Setting(containerEl)
      .setName("Google 계정 로그인")
      .setDesc("터미널 없이 바로 로그인합니다. 버튼을 누르면 브라우저가 열립니다 — 로그인을 마칠 때까지 최대 5분 기다립니다.")
      .addButton((button) =>
        button.setButtonText("로그인").onClick(async () => {
          button.setDisabled(true).setButtonText("로그인 중...");
          statusEl.setText("브라우저에서 Google 로그인을 완료해주세요...");
          try {
            await runNotebookLmLogin();
            new Notice("✅ NotebookLM 로그인 완료!");
            statusEl.setText("로그인이 완료되었습니다. \"연결 테스트\"로 다시 확인해보세요.");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`❌ 로그인 실패: ${message}`);
            statusEl.setText(`❌ ${message}`);
          } finally {
            button.setDisabled(false).setButtonText("로그인");
          }
        }),
      )
      .addButton((button) =>
        button.setButtonText("연결 테스트").onClick(async () => {
          button.setDisabled(true).setButtonText("확인 중...");
          statusEl.setText("연결 확인 중...");
          const result = await testNotebookLmConnection(settings.notebooklmMcpCommand);
          statusEl.setText(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`);
          button.setDisabled(false).setButtonText("연결 테스트");
        }),
      );

    containerEl.createEl("p", {
      text: "터미널을 직접 쓰고 싶다면: uvx --from notebooklm-mcp-cli nlm login",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("MCP 서버 실행 명령")
      .setDesc("notebooklm-mcp-cli를 stdio MCP 서버로 실행하는 명령")
      .addText((text) =>
        text.setValue(settings.notebooklmMcpCommand).onChange(async (value) => {
          settings.notebooklmMcpCommand = value.trim() || "uvx --from notebooklm-mcp-cli notebooklm-mcp";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("최대 대기 시간 (초)")
      .setDesc("아티팩트 생성 완료를 기다리는 최대 시간. 기본 900초(15분).")
      .addText((text) =>
        text.setValue(String(settings.notebooklmMaxWaitSeconds)).onChange(async (value) => {
          const parsed = Number(value);
          settings.notebooklmMaxWaitSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 900;
          await this.plugin.saveSettings();
        }),
      );
  }

  private renderAiTab(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    const providers: AiProviderId[] = ["antigravity", "claude", "gemini", "codex", "grok", "custom"];

    new Setting(containerEl)
      .setName("AI provider")
      .setDesc("설교문 요약/큐티/성경공부자료를 생성할 로컬 CLI. 이미 로그인된 CLI를 그대로 사용합니다.")
      .addDropdown((dropdown) => {
        for (const provider of providers) dropdown.addOption(provider, provider);
        dropdown.setValue(settings.aiProvider).onChange(async (value) => {
          settings.aiProvider = value as AiProviderId;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("사용자 지정 명령 (선택)")
      .setDesc('비워두면 provider별 기본 명령을 자동 탐색합니다. custom provider를 쓰려면 필수입니다. 예: "my-cli -p"')
      .addText((text) =>
        text.setValue(settings.aiCommand).onChange(async (value) => {
          settings.aiCommand = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("타임아웃 (초)")
      .setDesc("AI CLI 응답을 기다리는 최대 시간. 큐티(2일치)·성경공부자료처럼 긴 결과물은 기본 3분보다 오래 걸릴 수 있어 넉넉하게 잡는 것을 권장합니다.")
      .addText((text) =>
        text.setValue(String(settings.aiCliTimeoutSeconds)).onChange(async (value) => {
          const parsed = Number(value);
          settings.aiCliTimeoutSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AI_CLI_TIMEOUT_SECONDS;
          await this.plugin.saveSettings();
        }),
      );

    const statusEl = containerEl.createDiv({ text: "아직 확인하지 않았습니다." });
    new Setting(containerEl)
      .setName("설치 확인")
      .setDesc("PATH에서 CLI 실행 파일을 찾을 수 있는지만 확인합니다(실제 호출/비용 없음). 로그인 여부는 콘솔에서 직접 생성해봐야 확인됩니다.")
      .addButton((button) =>
        button.setButtonText("설치 확인").onClick(async () => {
          button.setDisabled(true).setButtonText("확인 중...");
          try {
            const available = await isAiCliAvailable(settings.aiProvider);
            if (!available) {
              statusEl.setText(`❌ ${settings.aiProvider} 실행 파일을 PATH에서 찾지 못했습니다.`);
            } else {
              const command = await resolveAiCommand(settings.aiProvider, settings.aiCommand);
              statusEl.setText(`✅ 실행 파일을 찾았습니다: ${command}`);
            }
          } catch (error) {
            statusEl.setText(`❌ ${error instanceof Error ? error.message : String(error)}`);
          } finally {
            button.setDisabled(false).setButtonText("설치 확인");
          }
        }),
      );
  }

  private renderPromptsTab(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: "비워두면 기본 프롬프트를 사용합니다. {{TITLE}}, {{SCRIPTURE}}, {{DATE}}, {{BODY}} 자리표시자를 쓸 수 있습니다.",
    });

    this.renderPromptField(containerEl, "설교문 요약본", "summary");
    this.renderPromptField(containerEl, "개인 큐티자료 (2일)", "qt");
    this.renderPromptField(containerEl, "성경공부자료", "bible_study");
  }

  private renderPromptField(containerEl: HTMLElement, label: string, key: "summary" | "qt" | "bible_study"): void {
    const settings = this.plugin.settings;
    new Setting(containerEl).setName(label).setHeading();
    const textarea = containerEl.createEl("textarea", { cls: "sermon-multiplier-prompt-textarea" });
    textarea.rows = 6;
    textarea.value = settings.promptTemplates[key];
    textarea.addEventListener("change", () => {
      void (async () => {
        settings.promptTemplates = { ...settings.promptTemplates, [key]: textarea.value };
        await this.plugin.saveSettings();
      })();
    });
  }
}
