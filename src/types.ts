// 설교 산출물 파이프라인 전역에서 공유하는 타입 정의 (SSOT)

export type OutputStatus = "draft" | "generating" | "partial" | "complete" | "error";

export type OutputKind =
  | "infographic"
  | "slides"
  | "video"
  | "audio"
  | "summary"
  | "qt"
  | "bible_study"
  | "landing_page";

export const NOTEBOOKLM_OUTPUTS: OutputKind[] = ["infographic", "slides", "video", "audio"];
export const LOCAL_AI_OUTPUTS: OutputKind[] = ["summary", "qt", "bible_study"];
export const ALL_GENERATABLE_OUTPUTS: OutputKind[] = [...NOTEBOOKLM_OUTPUTS, ...LOCAL_AI_OUTPUTS];

export interface SermonOutputs {
  infographic: string | null;
  slides: string | null;
  slides_style: string | null;
  video: string | null;
  audio: string | null;
  summary: string | null;
  qt: string | null;
  bible_study: string | null;
  landing_page: string | null;
}

export interface SermonFrontmatter {
  type: "sermon";
  title: string;
  date: string;
  scripture: string;
  series: string;
  status: OutputStatus;
  outputs: SermonOutputs;
  notebooklm: {
    notebook_id: string | null;
  };
  gdrive: {
    folder_id: string | null;
  };
  [key: string]: unknown;
}

export function emptyOutputs(): SermonOutputs {
  return {
    infographic: null,
    slides: null,
    slides_style: null,
    video: null,
    audio: null,
    summary: null,
    qt: null,
    bible_study: null,
    landing_page: null,
  };
}

export function defaultFrontmatter(overrides: Partial<SermonFrontmatter> = {}): SermonFrontmatter {
  return {
    type: "sermon",
    title: "",
    date: "",
    scripture: "",
    series: "",
    status: "draft",
    outputs: emptyOutputs(),
    notebooklm: { notebook_id: null },
    gdrive: { folder_id: null },
    ...overrides,
  };
}

// 산출물 1건의 진행 상태 (콘솔 모달 행 하나에 대응)
export interface OutputRunState {
  kind: OutputKind;
  status: "waiting" | "generating" | "complete" | "error";
  message?: string;
  link?: string | null;
}

export interface DriveUploadResult {
  fileId: string;
  webViewLink: string;
  fileName: string;
  mimeType: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
}

export type SizeCategory = "video" | "audio" | "document" | "image";

export interface SizeOption {
  id: string;
  label: string;
  width: string;
  height: string;
  recommended?: boolean;
}

export type AiProviderId = "claude" | "gemini" | "codex" | "grok" | "antigravity" | "custom";

export interface PromptTemplates {
  summary: string;
  qt: string;
  bible_study: string;
}

export interface SlideStylePreset {
  id: string;
  fileName: string;
  title: string;
  body: string;
}

export interface SermonMultiplierSettings {
  // Google Drive OAuth
  googleClientId: string;
  googleClientSecret: string;
  googleAccessToken: string;
  googleRefreshToken: string;
  tokenExpiresAt: number;
  driveFolderRoot: string;
  autoShareLink: boolean;

  // NotebookLM
  notebooklmMcpCommand: string;
  notebooklmMaxWaitSeconds: number;

  // 로컬 AI CLI
  aiProvider: AiProviderId;
  aiCommand: string;

  // 프롬프트 템플릿 (사용자 수정 가능)
  promptTemplates: PromptTemplates;

  // 임베드 기본값
  defaultVideoSize: string;
  defaultAudioSize: string;
  defaultDocumentSize: string;
}

export const DEFAULT_SETTINGS: SermonMultiplierSettings = {
  googleClientId: "",
  googleClientSecret: "",
  googleAccessToken: "",
  googleRefreshToken: "",
  tokenExpiresAt: 0,
  driveFolderRoot: "설교자료",
  autoShareLink: true,

  notebooklmMcpCommand: "uvx --from notebooklm-mcp-cli notebooklm-mcp",
  notebooklmMaxWaitSeconds: 900,

  aiProvider: "antigravity",
  aiCommand: "",

  promptTemplates: {
    summary: "",
    qt: "",
    bible_study: "",
  },

  defaultVideoSize: "medium",
  defaultAudioSize: "slim",
  defaultDocumentSize: "medium",
};

export const OUTPUT_LABELS: Record<OutputKind, string> = {
  infographic: "인포그래픽",
  slides: "슬라이드",
  video: "영상자료",
  audio: "음성자료",
  summary: "설교문 요약본",
  qt: "개인 큐티자료 (2일)",
  bible_study: "성경공부자료",
  landing_page: "통합 랜딩페이지",
};
