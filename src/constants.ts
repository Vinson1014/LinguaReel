// ===== View 識別碼 =====

export const VIEW_TYPE_HOME       = 'vll-home-view';
export const VIEW_TYPE_DICT       = 'vll-dict-view';
export const VIEW_TYPE_HIGHLIGHT  = 'vll-highlight-view';
export const VIEW_TYPE_FLASHCARD  = 'vll-flashcard-view';
export const VIEW_TYPE_SHADOWING  = 'vll-shadowing-view';

// ===== IndexedDB =====

export const DB_NAME    = 'vll-database';
export const DB_VERSION = 1;

export const STORE_VOCAB      = 'vocab';
export const STORE_FLASHCARDS = 'flashcards';
export const STORE_HIGHLIGHTS = 'highlights';

// ===== 插件基本資訊 =====

export const PLUGIN_ID   = 'vll';
export const PLUGIN_NAME = 'VLL - Video Language Learning';

// ===== 事件名稱 =====

/** 查詞觸發事件（payload: string - 查詢的單字） */
export const EVENT_LOOKUP_WORD = 'vll:lookup-word';
/** 生詞本更新事件 */
export const EVENT_VOCAB_UPDATED = 'vll:vocab-updated';
/** 閃卡複習完成事件 */
export const EVENT_REVIEW_DONE = 'vll:review-done';
/** 標注任務狀態更新事件（HomeView 訂閱此事件刷新 jobs section） */
export const EVENT_ANNOTATION_JOB = 'vll:annotation-job-update';
