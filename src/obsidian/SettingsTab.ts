// 설정 화면 — 화면 구성 3번: Google Drive / NotebookLM / AI Provider / 프롬프트 템플릿 4개 탭.
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type SermonMultiplierPlugin from "../main";
import { buildDriveUploader } from "./services";
import { AiProviderId } from "../types";

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
  }

  private renderNotebookLmTab(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;

    containerEl.createEl("p", {
      text: "최초 1회, 터미널에서 로그인이 필요합니다: uvx --from notebooklm-mcp-cli nlm login",
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
