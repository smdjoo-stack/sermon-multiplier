// 산출물 생성 콘솔(메인 모달) — 화면 구성 2번.
// 노트 제목/본문구절/날짜 표시 후 7가지 산출물 + 통합 랜딩페이지를 리스트로 나열한다.
import { App, Modal, Notice, TFile } from "obsidian";
import type SermonMultiplierPlugin from "../main";
import { parseSermonNote } from "../core/frontmatterManager";
import { listSlideStylePresets } from "../core/slideStyles";
import { getSlideStylesDir } from "./services";
import { DriveBackedOutput, EmbedSizeModal } from "./EmbedSizeModal";
import { ALL_GENERATABLE_OUTPUTS, OUTPUT_LABELS, OutputKind, OutputRunState, SermonFrontmatter } from "../types";

const DRIVE_BACKED_OUTPUTS = new Set<OutputKind>(["infographic", "slides", "video", "audio"]);

type RowStatus = "waiting" | "generating" | "complete" | "error";

interface RowRefs {
  badge: HTMLElement;
  button: HTMLButtonElement;
}

export class ConsoleModal extends Modal {
  private plugin: SermonMultiplierPlugin;
  private file: TFile;
  private frontmatter: SermonFrontmatter | null = null;
  private rows = new Map<OutputKind, RowRefs>();
  private styleIds: Partial<Record<"infographic" | "slides", string | null>> = {};
  private styleTexts: Partial<Record<"infographic" | "slides", string | null>> = {};
  private logEl!: HTMLElement;
  // 행(산출물)별로 진행 상태를 따로 추적한다 — 하나로 합쳐두면 요약본이 도는 동안
  // 큐티/성경공부 버튼을 눌러도 무시되는 버그가 생긴다. "전체 생성"은 "__all__" 키를 쓴다.
  private runningButtons = new Set<OutputKind | "__all__">();

  constructor(app: App, plugin: SermonMultiplierPlugin, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.file = file;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    // 폭 제약은 contentEl이 아니라 실제 다이얼로그 바깥 틀(modalEl)에 걸어야
    // 내용이 앱 창 밖으로 넘쳐 잘리는 문제가 생기지 않는다.
    this.modalEl.addClass("sermon-multiplier-modal");

    const raw = await this.app.vault.read(this.file);
    const { frontmatter } = parseSermonNote(raw);
    this.frontmatter = frontmatter;
    this.styleIds.infographic = frontmatter.outputs.infographic_style;
    this.styleIds.slides = frontmatter.outputs.slides_style;

    contentEl.createEl("h2", { text: frontmatter.title || this.file.basename, cls: "sermon-multiplier-title" });
    contentEl.createDiv({
      text: [frontmatter.scripture, frontmatter.date].filter(Boolean).join(" · "),
      cls: "sermon-multiplier-subtitle",
    });

    if (this.plugin.isRunning(this.file)) {
      contentEl.createDiv({
        text: "⏳ 이 노트는 이미 백그라운드에서 생성 중입니다. 완료되면 알림이 뜹니다.",
        cls: "sermon-multiplier-subtitle",
      });
    }

    for (const kind of ALL_GENERATABLE_OUTPUTS) {
      if (kind === "infographic" || kind === "slides") {
        await this.renderStyleControls(contentEl, kind);
      }
      this.renderRow(contentEl, kind);
    }
    this.renderLandingRow(contentEl);

    this.logEl = contentEl.createDiv({ cls: "sermon-multiplier-log" });
    contentEl.createDiv({
      text: "이 창을 닫아도 진행 중인 생성 작업은 계속됩니다 — 완료되면 알림이 뜨고 노트에 자동으로 반영됩니다.",
      cls: "setting-item-description",
    });

    const footer = contentEl.createDiv({ cls: "sermon-multiplier-footer" });
    const closeBtn = footer.createEl("button", { text: "닫기" });
    closeBtn.addEventListener("click", () => this.close());
    const runAllBtn = footer.createEl("button", { text: "전체 생성", cls: "mod-cta" });
    runAllBtn.addEventListener("click", () => void this.runAll(runAllBtn));
  }

  // 비주얼 스타일 프리셋 드롭다운 + 직접 입력란. 슬라이드뿐 아니라 인포그래픽에도 같은 프리셋을 적용할 수 있다.
  // 직접 입력란에 텍스트가 있으면 프리셋 선택보다 우선 적용된다.
  private async renderStyleControls(container: HTMLElement, kind: "infographic" | "slides"): Promise<void> {
    const wrap = container.createDiv({ cls: "sermon-multiplier-style-controls" });
    wrap.createSpan({ text: `${OUTPUT_LABELS[kind]} 스타일`, cls: "sermon-multiplier-style-label" });

    const select = wrap.createEl("select");
    select.createEl("option", { text: "프리셋 없음", value: "" });
    try {
      const presets = await listSlideStylePresets(getSlideStylesDir(this.plugin));
      for (const preset of presets) {
        const option = select.createEl("option", { text: preset.title, value: preset.id });
        if (preset.id === this.styleIds[kind]) option.selected = true;
      }
    } catch (error) {
      console.error("비주얼 스타일 목록 로드 실패:", error);
    }
    select.addEventListener("change", () => {
      this.styleIds[kind] = select.value || null;
    });

    const textInput = wrap.createEl("input", {
      type: "text",
      placeholder: "또는 스타일 프롬프트 직접 입력 (프리셋보다 우선)",
      cls: "sermon-multiplier-style-text",
    });
    textInput.addEventListener("change", () => {
      this.styleTexts[kind] = textInput.value.trim() || null;
    });
  }

  private renderRow(container: HTMLElement, kind: OutputKind): void {
    const row = container.createDiv({ cls: "sermon-multiplier-row" });
    const label = row.createDiv({ cls: "sermon-multiplier-row-label" });
    label.createSpan({ text: OUTPUT_LABELS[kind] });

    const link = this.frontmatter?.outputs[kind] ?? null;
    const badge = label.createSpan({ cls: "sermon-multiplier-badge" });

    const actions = row.createDiv({ cls: "sermon-multiplier-row-actions" });
    if (DRIVE_BACKED_OUTPUTS.has(kind)) {
      const sizeBtn = actions.createEl("button", { text: "크기" });
      sizeBtn.disabled = !link;
      sizeBtn.addEventListener("click", () => this.openEmbedSizeModal(kind as DriveBackedOutput));
    }
    const button = actions.createEl("button", { text: link ? "재생성" : "생성" });
    button.addEventListener("click", () => void this.runSingle(kind, button));

    this.rows.set(kind, { badge, button });
    this.setRowStatus(kind, link ? "complete" : "waiting");
  }

  private openEmbedSizeModal(kind: DriveBackedOutput): void {
    new EmbedSizeModal(this.app, kind, async (sizeId) => {
      await this.plugin.reembedOutput(this.file, kind, sizeId);
      new Notice(`✅ ${OUTPUT_LABELS[kind]} 임베드 크기를 변경했습니다.`);
    }).open();
  }

  private renderLandingRow(container: HTMLElement): void {
    const row = container.createDiv({ cls: "sermon-multiplier-row is-landing" });
    const label = row.createDiv({ cls: "sermon-multiplier-row-label" });
    label.createSpan({ text: OUTPUT_LABELS.landing_page });

    const hasAnyOutput = ALL_GENERATABLE_OUTPUTS.some((kind) => Boolean(this.frontmatter?.outputs[kind]));
    const badge = label.createSpan({ cls: "sermon-multiplier-badge" });

    const actions = row.createDiv({ cls: "sermon-multiplier-row-actions" });
    const button = actions.createEl("button", { text: "생성/갱신" });
    button.disabled = !hasAnyOutput;
    button.title = hasAnyOutput ? "" : "산출물을 1개 이상 먼저 생성하세요.";
    button.addEventListener("click", () => void this.runLandingPage(button));

    this.rows.set("landing_page", { badge, button });
    this.setRowStatus("landing_page", this.frontmatter?.outputs.landing_page ? "complete" : "waiting");
  }

  private setRowStatus(kind: OutputKind, status: RowStatus, message?: string): void {
    const refs = this.rows.get(kind);
    const labels: Record<RowStatus, string> = {
      waiting: "대기",
      generating: "생성 중",
      complete: "완료",
      error: "오류",
    };
    if (refs) {
      refs.badge.className = `sermon-multiplier-badge status-${status}`;
      refs.badge.textContent = labels[status];
      if (kind === "landing_page") refs.button.disabled = status === "generating";
    }
    if (message) this.appendLog(`[${OUTPUT_LABELS[kind]}] ${message}`);
  }

  private appendLog(message: string): void {
    if (!this.logEl) return;
    const line = this.logEl.createDiv();
    line.textContent = message;
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private onProgress = (state: OutputRunState): void => {
    this.setRowStatus(state.kind, state.status, state.message);
    if (state.status === "complete") {
      const landingRefs = this.rows.get("landing_page");
      if (landingRefs) landingRefs.button.disabled = false;
    }
  };

  private async runSingle(kind: OutputKind, button: HTMLButtonElement): Promise<void> {
    if (this.runningButtons.has(kind)) return;
    this.runningButtons.add(kind);
    button.disabled = true;
    try {
      const results = await this.plugin.runOutputs(
        this.file,
        [kind],
        { styleIds: this.styleIds, styleTexts: this.styleTexts },
        this.onProgress,
      );
      const failed = results.find((r) => r.kind === kind && r.status === "error");
      if (failed) new Notice(`❌ ${OUTPUT_LABELS[kind]} 생성 실패: ${failed.message}`);
      else new Notice(`✅ ${OUTPUT_LABELS[kind]} 생성 완료`);
    } finally {
      button.disabled = false;
      this.runningButtons.delete(kind);
    }
  }

  private async runAll(button: HTMLButtonElement): Promise<void> {
    if (this.runningButtons.has("__all__")) return;
    this.runningButtons.add("__all__");
    button.disabled = true;
    try {
      const results = await this.plugin.runOutputs(
        this.file,
        ALL_GENERATABLE_OUTPUTS,
        { styleIds: this.styleIds, styleTexts: this.styleTexts },
        this.onProgress,
      );
      const failedCount = results.filter((r) => r.status === "error").length;
      if (failedCount === 0) new Notice("✅ 전체 생성이 완료되었습니다.");
      else new Notice(`⚠️ ${failedCount}건은 실패했습니다. 로그를 확인하세요.`);
    } finally {
      button.disabled = false;
      this.runningButtons.delete("__all__");
    }
  }

  private async runLandingPage(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    this.setRowStatus("landing_page", "generating");
    try {
      await this.plugin.runLandingPage(this.file);
      this.setRowStatus("landing_page", "complete", "생성 완료");
    } catch (error) {
      this.setRowStatus("landing_page", "error", error instanceof Error ? error.message : String(error));
    } finally {
      button.disabled = false;
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
