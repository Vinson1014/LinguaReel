import { ItemView, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_DICT } from '../constants';
import { t } from '../i18n';
import type VLLPlugin from '../main';
import { getDictLookupMessages, resolveSourceLang, type DictLookupResult } from '../llm/prompts';
import type { DictSource } from '../types';

/**
 * 查詞側邊欄
 *
 * 使用方式：Ctrl+雙擊文字觸發，或在搜尋框直接輸入。
 * 透過 LLM 取得釋義、詞性、例句、語法筆記。
 * 查詢結果可直接加入生詞本（自動建立 FlashcardEntry）。
 */
export class DictView extends ItemView {

    static readonly type = VIEW_TYPE_DICT;

    private searchInput!:   HTMLInputElement;   // compact 頂部搜尋（搜尋中/有結果時顯示）
    private topSearchWrap!: HTMLElement;
    private resultEl!:      HTMLElement;
    /** 本次查詞的來源筆記（wikilink 格式，例如 [[Note]]）和時間戳，加入生詞本時記錄雙向連結 */
    private lookupSourceFile?: string;
    private lookupTimestamp?:  string;
    private lookupContext?:    string;

    constructor(leaf: WorkspaceLeaf, private plugin: VLLPlugin) {
        super(leaf);
    }

    getViewType(): string    { return VIEW_TYPE_DICT; }
    getDisplayText(): string { return t('dict.viewTitle'); }
    getIcon(): string        { return 'book-open'; }

    async onOpen(): Promise<void> {
        this.buildShell();
    }

    async onClose(): Promise<void> {
        this.contentEl.empty();
    }

    /** 外部呼叫入口（Ctrl+雙擊或 ShadowingView popup 觸發） */
    async lookup(word: string, context?: string, sourceFile?: string, timestamp?: string): Promise<void> {
        this.searchInput.value   = word;
        this.lookupSourceFile    = sourceFile;
        this.lookupTimestamp     = timestamp;
        this.lookupContext       = context;
        await this.runLookup(word, context);
    }

    // ─── UI 骨架 ──────────────────────────────────────────────────────────

    private buildShell(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('vll-dict-view');

        // ── 頂部 compact 搜尋列（.is-searching 時才顯示）──
        this.topSearchWrap = contentEl.createDiv({ cls: 'vll-dict-search-wrap' });
        const topRowWrap = this.topSearchWrap.createDiv({ cls: 'vll-dict-search-row-wrap' });
        const topBox     = topRowWrap.createDiv({ cls: 'vll-dict-search-row' });
        this.searchInput = topBox.createEl('input', {
            type: 'text',
            cls:  'vll-dict-search-input',
            placeholder: t('dict.searchPlaceholder'),
        });
        const topBtn = topRowWrap.createEl('button', { cls: 'vll-dict-search-btn' });
        try {
            const { setIcon } = require('obsidian') as typeof import('obsidian');
            setIcon(topBtn, 'search');
        } catch { topBtn.setText('⌕'); }

        const doSearch = () => {
            const w = this.searchInput.value.trim();
            if (w) this.lookup(w);
        };
        topBtn.addEventListener('click', doSearch);
        this.searchInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') doSearch();
        });

        // ── 結果區（空狀態時 hero 填滿此區）──
        this.resultEl = contentEl.createDiv({ cls: 'vll-dict-result' });
        this.renderEmpty();
    }

    // ─── 狀態渲染 ─────────────────────────────────────────────────────────

    /** 切換到空狀態（hero 全版）或搜尋中狀態 */
    private setSearchingMode(on: boolean): void {
        this.contentEl.toggleClass('is-searching', on);
    }

    private renderEmpty(): void {
        this.setSearchingMode(false);
        this.resultEl.empty();

        // ── Hero：全頁置中，書本 icon + 標題 + 置中搜尋欄 ──
        const hero = this.resultEl.createDiv({ cls: 'vll-dict-hero' });
        const iconEl = hero.createDiv({ cls: 'vll-dict-hero-icon' });
        try {
            const { setIcon } = require('obsidian') as typeof import('obsidian');
            setIcon(iconEl, 'book-open');
        } catch { iconEl.setText('📖'); }

        hero.createEl('div', { text: t('dict.viewTitle'), cls: 'vll-dict-hero-title' });
        hero.createEl('div', { text: t('dict.emptyState'), cls: 'vll-dict-hero-tagline' });

        // 置中搜尋列（input + button 並排，button 在 border 外）
        const heroRow   = hero.createDiv({ cls: 'vll-dict-hero-row' });
        const heroBox   = heroRow.createDiv({ cls: 'vll-dict-hero-search' });
        const heroInput = heroBox.createEl('input', {
            type: 'text',
            cls:  'vll-dict-hero-input',
            placeholder: t('dict.searchPlaceholder'),
        });
        const heroBtn = heroRow.createEl('button', { cls: 'vll-dict-hero-btn' });
        try {
            const { setIcon } = require('obsidian') as typeof import('obsidian');
            setIcon(heroBtn, 'search');
        } catch { heroBtn.setText('⌕'); }

        const doHeroSearch = () => {
            const w = heroInput.value.trim();
            if (!w) return;
            this.searchInput.value = w;   // 同步頂部搜尋欄
            this.lookup(w);
        };
        heroBtn.addEventListener('click', doHeroSearch);
        heroInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') doHeroSearch();
        });
        setTimeout(() => heroInput.focus(), 50);
    }

    private renderLoading(word: string): void {
        this.setSearchingMode(true);
        this.resultEl.empty();
        const wrap = this.resultEl.createDiv({ cls: 'vll-dict-loading' });
        wrap.createEl('div', { cls: 'vll-spinner' });
        wrap.createEl('span', { text: `${t('common.loading')} "${word}"` });
    }

    private renderError(message: string): void {
        this.setSearchingMode(true);
        this.resultEl.empty();
        const wrap = this.resultEl.createDiv({ cls: 'vll-dict-error' });
        wrap.createEl('span', { cls: 'vll-error-icon', text: '⚠ ' });
        wrap.createEl('span', { text: message });
    }

    private renderResult(word: string, data: DictLookupResult): void {
        this.setSearchingMode(true);
        this.resultEl.empty();
        const card = this.resultEl.createDiv({ cls: 'vll-dict-card' });

        // ── 標題區：單字 / 讀音 / 詞性 ──
        const header = card.createDiv({ cls: 'vll-dict-header' });
        header.createEl('div', { text: word, cls: 'vll-dict-word' });
        if (data.reading) {
            header.createEl('div', { text: data.reading, cls: 'vll-dict-reading' });
        }
        if (data.pos) {
            header.createEl('span', { text: data.pos, cls: 'vll-dict-pos' });
        }

        // ── 釋義 ──
        const defList = card.createEl('ol', { cls: 'vll-dict-definitions' });
        for (const def of data.definitions) {
            defList.createEl('li', { text: def });
        }

        // ── 例句 ──
        if (data.example?.original) {
            const exBox = card.createDiv({ cls: 'vll-dict-example' });
            exBox.createEl('div', { text: data.example.original,    cls: 'vll-dict-ex-original' });
            if (data.example.translation) {
                exBox.createEl('div', { text: data.example.translation, cls: 'vll-dict-ex-translation' });
            }
        }

        // ── 語法筆記 ──
        if (data.notes) {
            card.createDiv({ text: data.notes, cls: 'vll-dict-notes' });
        }

        // ── 操作按鈕 ──
        this.renderActions(card, word, data);
    }

    private renderActions(container: HTMLElement, word: string, data: DictLookupResult): void {
        const actions = container.createDiv({ cls: 'vll-dict-actions' });

        // 外部參考字典連結
        const extUrl = dictRefUrl(this.plugin.settings.dictSource, word);
        if (extUrl) {
            const srcLabel = this.plugin.settings.dictSource.charAt(0).toUpperCase()
                           + this.plugin.settings.dictSource.slice(1);
            const extBtn = actions.createEl('button', {
                text: t('dict.viewExternal', { source: srcLabel }),
                cls:  'vll-btn vll-dict-ext-btn',
            });
            extBtn.addEventListener('click', () => window.open(extUrl, '_blank'));
        }

        const addBtn = actions.createEl('button', {
            text: t('dict.addToVocab'),
            cls:  'vll-btn vll-btn-primary',
        });

        addBtn.addEventListener('click', async () => {
            const existing = await this.plugin.vocabStorage.getByWord(word);
            if (existing) {
                addBtn.textContent = t('dict.alreadyAdded');
                addBtn.disabled = true;
                return;
            }
            const now = Date.now();
            await this.plugin.vocabStorage.add({
                word,
                reading:             data.reading  || undefined,
                pos:                 data.pos      || undefined,
                definitions:         data.definitions,
                example:             data.example?.original    || undefined,
                exampleTranslation:  data.example?.translation || undefined,
                context:             this.lookupContext,
                sourceFile:          this.lookupSourceFile,
                timestamp:           this.lookupTimestamp,
                tags:        [],
                createdAt:   now,
                // FSRS initial state
                due:         now,
                stability:   0,
                difficulty:  0,
                reps:        0,
                lapses:      0,
                state:       0,
                filePath:    this.plugin.vocabStorage.filePath(word),
            });
            addBtn.textContent = t('dict.addedToVocab');
            addBtn.disabled = true;
        });
    }

    // ─── 查詞邏輯 ─────────────────────────────────────────────────────────

    private async runLookup(word: string, context?: string): Promise<void> {
        if (!this.plugin.llm.isConfigured()) {
            this.renderError(
                'LLM not configured. Please set API Base URL and Fast Model in settings.'
            );
            return;
        }

        this.renderLoading(word);

        try {
            const messages = getDictLookupMessages(
                word,
                context,
                this.plugin.settings.outputLanguage,
                this.plugin.settings.uiLanguage,
                resolveSourceLang(this.plugin.settings.annotationLanguage),
            );
            const result = await this.plugin.llm.chatJSON<DictLookupResult>(messages);
            if (!Array.isArray(result.definitions)) result.definitions = [];
            this.renderResult(word, result);
        } catch (e) {
            this.renderError(e instanceof Error ? e.message : String(e));
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dictRefUrl(source: DictSource, word: string): string | null {
    const q = encodeURIComponent(word);
    switch (source) {
        case 'jisho':   return `https://jisho.org/search/${q}`;
        case 'weblio':  return `https://www.weblio.jp/content/${q}`;
        case 'youdao':  return `https://dict.youdao.com/w/${q}`;
        case 'google':  return `https://translate.google.com/?sl=auto&tl=zh-TW&text=${q}&op=translate`;
        default:        return null;
    }
}
