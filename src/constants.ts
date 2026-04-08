// ===== View 識別碼 =====

export const VIEW_TYPE_HOME       = 'lingua-reel-home-view';
export const VIEW_TYPE_DICT       = 'lingua-reel-dict-view';
export const VIEW_TYPE_HIGHLIGHT  = 'lingua-reel-highlight-view';
export const VIEW_TYPE_FLASHCARD  = 'lingua-reel-flashcard-view';
export const VIEW_TYPE_SHADOWING  = 'lingua-reel-shadowing-view';

// ===== IndexedDB =====

export const DB_NAME    = 'vll-database';
export const DB_VERSION = 1;

export const STORE_VOCAB      = 'vocab';
export const STORE_FLASHCARDS = 'flashcards';
export const STORE_HIGHLIGHTS = 'highlights';

// ===== 插件基本資訊 =====

export const PLUGIN_ID   = 'lingua-reel';
export const PLUGIN_NAME = 'LinguaReel';

// ===== 事件名稱 =====

/** 查詞觸發事件（payload: string - 查詢的單字） */
export const EVENT_LOOKUP_WORD = 'vll:lookup-word';
/** 生詞本更新事件 */
export const EVENT_VOCAB_UPDATED = 'vll:vocab-updated';
/** 閃卡複習完成事件 */
export const EVENT_REVIEW_DONE = 'vll:review-done';
/** 標注任務狀態更新事件（HomeView 訂閱此事件刷新 jobs section） */
export const EVENT_ANNOTATION_JOB = 'vll:annotation-job-update';

// ===== 語言包 =====

/** Vault 內語言包 .md 檔的存放資料夾（使用者可直接編輯） */
export const LANGUAGE_PACK_FOLDER = 'LinguaReel/language-packs';
