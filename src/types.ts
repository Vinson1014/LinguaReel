// ===================================================
//  VLL - Video Language Learning
//  全域型別定義
// ===================================================

// ===== 字幕 / 影片（繼承自 eme-video-importer） =====

export interface SubtitleEntry {
    start: number;
    end:   number;
    text:  string;
}

export interface VideoInfo {
    title:     string;
    source:    string;
    duration?: number;
    type:      'youtube' | 'local';
}

export interface ImportResult {
    success:        boolean;
    notePath?:      string;
    subtitleCount?: number;
    errorMessage?:  string;
}

// ===== 外部工具偵測 =====

export interface ToolStatus {
    available: boolean;
    version?:  string;
    path?:     string;
}

export interface EnvironmentStatus {
    ytdlp:   ToolStatus;
    whisper: ToolStatus;
    maxTier: 0 | 1 | 2;
}

// ===== 生詞本（Markdown-first，每個字一個 .md 檔） =====

/**
 * VocabEntry 同時包含詞彙資訊和 FSRS 排程資料。
 * 所有欄位均對應到 .md 檔的 YAML frontmatter。
 */
export interface VocabEntry {
    // ── 詞彙 ──────────────────────────────
    word:        string;
    reading?:    string;
    pos?:        string;
    definitions: string[];
    example?:    string;
    /** 來源筆記的 wikilink，例如 "[[Note Name]]" */
    sourceFile?: string;
    /** 在影片中的時間戳，例如 "03:57" */
    timestamp?:  string;
    /** 查詞當下的例句脈絡 */
    context?:    string;
    tags:        string[];
    /** 建立時間（ms） */
    createdAt:   number;

    // ── FSRS 排程（存在 frontmatter，Obsidian Sync 可同步） ──
    /** 下次複習時間（ms） */
    due:          number;
    stability:    number;
    difficulty:   number;
    reps:         number;
    lapses:       number;
    /** 0=New 1=Learning 2=Review 3=Relearning */
    state:        number;
    /** 上次複習時間（ms），尚未複習則為 undefined */
    lastReview?:  number;

    // ── Runtime only（不存在 frontmatter） ──
    /** Vault 相對路徑 */
    filePath:     string;
}

// ===== 字幕標註（Annotation Pipeline） =====

export interface ShadowingEntry {
    timestamp: string;
    text:      string;
}

export interface AnnotationItem {
    original:          string;
    key:               string;
    explanation:       string;
    translation_word?: string;
}

export interface SubtitleAnnotation {
    translation:  string;
    annotations:  AnnotationItem[];
}

export interface AnnotatedEntry {
    timestamp:   string;
    text:        string;
    translation: string;
    annotations: AnnotationItem[];
}

// ===== 高亮筆記 =====

export type HighlightColor = 'yellow' | 'pink' | 'blue' | 'green';

export interface HighlightNote {
    id:             string;
    text:           string;
    context?:       string;
    color:          HighlightColor;
    sourceFile:     string;
    sourceLine:     number;
    tags:           string[];
    aiTranslation?: string;
    aiResearch?:    string;
    createdAt:      number;
    updatedAt:      number;
}

// ===== 設定 =====

export type DictSource    = 'none' | 'jisho' | 'weblio' | 'youdao' | 'google';
export type UILanguage    = 'auto' | 'en' | 'zh-TW' | 'zh-CN';
export type WhisperModel  = 'tiny' | 'base' | 'small' | 'medium' | 'large' | 'large-v2' | 'large-v3';
export type WhisperDevice = 'cpu' | 'cuda' | 'auto';

export interface VLLSettings {
    // ── 一般 ──────────────────────────────────────
    uiLanguage: UILanguage;

    // ── 字典 ──────────────────────────────────────
    dictSource:    DictSource;
    localDictPath: string;
    /** 生詞 .md 檔存放資料夾（例如 Vocabulary） */
    vocabFolder:   string;

    // ── LLM ───────────────────────────────────────
    llmBaseUrl:             string;
    llmApiKey:              string;
    llmModelFast:           string;
    llmModelPowerful:       string;
    annotationLanguage:     string;
    annotationSystemPrompt: string;

    // ── 跟讀 / 影片 ───────────────────────────────
    shadowingOutputFolder: string;
    defaultSubtitleLang:   string;
    subtitleMergeGap:      number;
    maxLineLength:         number;

    // ── 外部工具 ──────────────────────────────────
    ytdlpPath:     string;
    whisperPath:   string;
    whisperModel:  WhisperModel;
    whisperDevice: WhisperDevice;
}
