import en, { type Translations } from './locales/en';
import zhTW from './locales/zh-TW';
import zhCN from './locales/zh-CN';
import type { UILanguage } from '../types';

// ===== 語言映射 =====

const locales: Record<string, Translations> = {
    en,
    'zh-TW': zhTW,
    'zh-CN': zhCN,
};

// ===== 偵測 Obsidian 當前語言 =====

/**
 * 讀取 Obsidian localStorage 的語言設定，
 * 回傳 'en' | 'zh-TW' | 'zh-CN'（不符合則 fallback 到 en）
 */
function detectObsidianLang(): string {
    const raw = window.localStorage.getItem('language') ?? 'en';
    // Obsidian 使用 'zh' 代表簡體，'zh-TW' 代表繁體
    if (raw === 'zh' || raw === 'zh-Hans' || raw === 'zh-CN') return 'zh-CN';
    if (raw === 'zh-TW' || raw === 'zh-Hant')                 return 'zh-TW';
    return 'en';
}

// ===== 全域 i18n 狀態 =====

let currentLocale: Translations = en;

/**
 * 根據插件設定的 uiLanguage 初始化 i18n。
 * 在 plugin.onload() 中呼叫一次。
 */
export function initI18n(uiLanguage: UILanguage): void {
    const lang = uiLanguage === 'auto' ? detectObsidianLang() : uiLanguage;
    currentLocale = locales[lang] ?? en;
}

/**
 * 取得翻譯字串，支援簡單的 {placeholder} 替換。
 *
 * 用法：
 *   t('dict.viewTitle')
 *   t('importModal.success', { path: '/Shadowing/video.md' })
 */
export function t(
    key: string,
    vars?: Record<string, string | number>
): string {
    const parts = key.split('.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let node: any = currentLocale;

    for (const part of parts) {
        if (node == null || typeof node !== 'object') {
            // key 不存在，fallback 到英文
            node = en;
            for (const p of parts) node = node?.[p];
            break;
        }
        node = node[part];
    }

    if (typeof node !== 'string') {
        // 最終 fallback：直接回傳 key
        return key;
    }

    if (!vars) return node;

    // 替換 {placeholder}
    return node.replace(/\{(\w+)\}/g, (_, name) =>
        vars[name] !== undefined ? String(vars[name]) : `{${name}}`
    );
}

/** 取得當前有效的語言代碼（用於 UI 顯示） */
export function getCurrentLang(): string {
    return Object.entries(locales).find(([, v]) => v === currentLocale)?.[0] ?? 'en';
}
