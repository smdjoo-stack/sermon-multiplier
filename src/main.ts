// 옵시디언 플러그인 진입점: 리본 아이콘 + 명령어 팔레트 + 설정 탭 등록.
// 실제 생성 로직은 src/core/pipeline.ts에 있고, 이 파일은 옵시디언 API와의 배선만 담당한다.
import { Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, DriveSecrets, EMPTY_DRIVE_SECRETS, OutputKind, OutputRunState, SermonMultiplierSettings } from "./types";
import { ensureSlideStylesSeeded } from "./core/slideStyles";
import { generateLandingPage, PipelineContext, reembedOutput, runPipeline } from "./core/pipeline";
import { loadDriveSecrets, saveDriveSecrets } from "./core/secretsStore";
import { DriveBackedOutput } from "./obsidian/EmbedSizeModal";
import { buildDriveUploader, getSlideStylesDir, getVaultBasePath } from "./obsidian/services";
import { ConsoleModal } from "./obsidian/ConsoleModal";
import { SermonMultiplierSettingTab } from "./obsidian/SettingsTab";

export default class SermonMultiplierPlugin extends Plugin {
  settings!: SermonMultiplierSettings;
  secrets: DriveSecrets = EMPTY_DRIVE_SECRETS;
  // 노트 경로 기준으로 실행 중인 파이프라인을 추적한다. runOutputs는 콘솔 모달의 생명주기와
  // 무관하게 계속 진행되므로(모달을 닫아도 취소되지 않음), 모달을 다시 열었을 때 같은 노트에
  // 중복 실행을 시작하지 않도록 막는 용도다.
  private runningNotePaths = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.loadSecrets();

    try {
      await ensureSlideStylesSeeded(getSlideStylesDir(this));
    } catch (error) {
      console.error("슬라이드 스타일 프리셋 시딩 실패:", error);
    }

    this.addRibbonIcon("wand-2", "설교 산출물: 콘솔 열기", () => {
      this.openConsoleForActiveFile();
    });

    this.addCommand({
      id: "open-console",
      name: "설교 산출물: 콘솔 열기",
      callback: () => this.openConsoleForActiveFile(),
    });

    const kinds: { id: string; kind: OutputKind; name: string }[] = [
      { id: "regen-infographic", kind: "infographic", name: "인포그래픽만 재생성" },
      { id: "regen-slides", kind: "slides", name: "슬라이드만 재생성" },
      { id: "regen-video", kind: "video", name: "영상자료만 재생성" },
      { id: "regen-audio", kind: "audio", name: "음성자료만 재생성" },
      { id: "regen-summary", kind: "summary", name: "설교문 요약본만 재생성" },
      { id: "regen-qt", kind: "qt", name: "큐티자료만 재생성" },
      { id: "regen-bible-study", kind: "bible_study", name: "성경공부자료만 재생성" },
    ];
    for (const { id, kind, name } of kinds) {
      this.addCommand({
        id,
        name: `설교 산출물: ${name}`,
        callback: () => {
          const file = this.app.workspace.getActiveFile();
          if (!file) {
            new Notice("먼저 설교 노트를 열어주세요.");
            return;
          }
          void this.runOutputs(file, [kind]).then((results) => this.notifyResults(results));
        },
      });
    }

    this.addCommand({
      id: "generate-landing-page",
      name: "설교 산출물: 랜딩페이지 생성/갱신",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice("먼저 설교 노트를 열어주세요.");
          return;
        }
        void this.runLandingPage(file);
      },
    });

    this.addSettingTab(new SermonMultiplierSettingTab(this.app, this));
  }

  onunload(): void {
    console.debug("sermon-multiplier unloaded");
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<SermonMultiplierSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      promptTemplates: { ...DEFAULT_SETTINGS.promptTemplates, ...(saved?.promptTemplates || {}) },
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async loadSecrets(): Promise<void> {
    this.secrets = await loadDriveSecrets();
  }

  async saveSecrets(patch: Partial<DriveSecrets>): Promise<void> {
    this.secrets = await saveDriveSecrets(patch);
  }

  openConsoleForActiveFile(): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("먼저 설교 노트를 열어주세요.");
      return;
    }
    this.openConsole(file);
  }

  openConsole(file: TFile): void {
    new ConsoleModal(this.app, this, file).open();
  }

  // ConsoleModal/명령어가 공통으로 쓰는 파이프라인 컨텍스트 빌더.
  buildPipelineContext(file: TFile, onProgress?: (state: OutputRunState) => void): PipelineContext {
    const vaultPath = getVaultBasePath(this);
    return {
      vaultPath,
      notePath: file.path,
      settings: this.settings,
      driveUploader: buildDriveUploader(this.secrets, async (tokens) => {
        await this.saveSecrets({
          googleAccessToken: tokens.accessToken,
          googleRefreshToken: tokens.refreshToken,
          tokenExpiresAt: tokens.expiresAt,
        });
      }),
      slideStylesDir: getSlideStylesDir(this),
      onProgress,
    };
  }

  isRunning(file: TFile): boolean {
    return this.runningNotePaths.has(file.path);
  }

  async runOutputs(
    file: TFile,
    outputs: OutputKind[],
    styleOptions?: {
      styleIds?: Partial<Record<"infographic" | "slides", string | null>>;
      styleTexts?: Partial<Record<"infographic" | "slides", string | null>>;
    },
    onProgress?: (state: OutputRunState) => void,
  ): Promise<OutputRunState[]> {
    if (this.runningNotePaths.has(file.path)) {
      new Notice("⏳ 이 노트는 이미 산출물을 생성하는 중입니다. 완료될 때까지 기다려주세요.");
      return [];
    }
    this.runningNotePaths.add(file.path);
    try {
      const ctx = this.buildPipelineContext(file, onProgress);
      const { results } = await runPipeline(ctx, { outputs, ...styleOptions });
      return results;
    } finally {
      this.runningNotePaths.delete(file.path);
    }
  }

  async runLandingPage(file: TFile): Promise<void> {
    try {
      const result = await generateLandingPage({ vaultPath: getVaultBasePath(this), notePath: file.path });
      new Notice(`✅ 랜딩페이지가 생성되었습니다: ${result.relativePath}`);
    } catch (error) {
      new Notice(`❌ 랜딩페이지 생성 실패: ${describeError(error)}`);
    }
  }

  async reembedOutput(file: TFile, kind: DriveBackedOutput, sizeId: string): Promise<void> {
    await reembedOutput({ vaultPath: getVaultBasePath(this), notePath: file.path }, kind, sizeId);
  }

  private notifyResults(results: OutputRunState[]): void {
    if (results.length === 0) return; // 이미 실행 중이었던 경우 — runOutputs가 자체 안내를 띄운다.
    const failed = results.filter((r) => r.status === "error");
    if (failed.length === 0) {
      new Notice("✅ 생성이 완료되었습니다.");
    } else {
      new Notice(`⚠️ ${failed.length}건 실패: ${failed.map((f) => f.message).join(", ")}`);
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
