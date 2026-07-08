// 임베드 크기 선택 모달 — 화면 구성 4번.
// 이미 Drive에 업로드된 산출물의 임베드 크기만 바꾼다(재생성 없음).
import { App, Modal, Notice } from "obsidian";
import { categoryForOutput, getSizePresets } from "../core/embedWriter";

export type DriveBackedOutput = "infographic" | "slides" | "video" | "audio";

export class EmbedSizeModal extends Modal {
  private kind: DriveBackedOutput;
  private onSelect: (sizeId: string) => Promise<void>;

  constructor(app: App, kind: DriveBackedOutput, onSelect: (sizeId: string) => Promise<void>) {
    super(app);
    this.kind = kind;
    this.onSelect = onSelect;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "임베드 크기 선택" });

    const grid = contentEl.createDiv({ cls: "sermon-multiplier-size-grid" });
    const presets = getSizePresets(categoryForOutput(this.kind));
    for (const preset of presets) {
      const option = grid.createDiv({ cls: "sermon-multiplier-size-option" });
      if (preset.recommended) option.addClass("is-selected");
      option.createDiv({ text: preset.label });
      option.createDiv({ text: `${preset.width} × ${preset.height}` });
      option.addEventListener("click", () => {
        void this.onSelect(preset.id)
          .then(() => this.close())
          .catch((error) => {
            new Notice(`❌ 적용 실패: ${error instanceof Error ? error.message : String(error)}`);
          });
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
