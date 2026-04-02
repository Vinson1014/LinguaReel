import { ItemView, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_HOME, VIEW_TYPE_DICT, VIEW_TYPE_HIGHLIGHT, VIEW_TYPE_FLASHCARD, VIEW_TYPE_SHADOWING } from '../constants';
import { t } from '../i18n';
import type VLLPlugin from '../main';

/**
 * VLL 首頁 / Dashboard
 *
 * 唯一的 Ribbon 入口。顯示：
 * - LLM 設定狀態
 * - 生詞本數量 / 今日待複習卡片數
 * - 四大模組導航卡片
 * - 快速匯入影片按鈕
 */
export class HomeView extends ItemView {

    static readonly type = VIEW_TYPE_HOME;

    constructor(leaf: WorkspaceLeaf, private plugin: VLLPlugin) {
        super(leaf);
    }

    getViewType(): string    { return VIEW_TYPE_HOME; }
    getDisplayText(): string { return t('home.viewTitle'); }
    getIcon(): string        { return 'layout-dashboard'; }

    async onOpen(): Promise<void>  { await this.render(); }
    async onClose(): Promise<void> { this.contentEl.empty(); }

    // ─── 渲染 ──────────────────────────────────────────────────────────────

    async render(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('vll-home-view');

        this.renderHeader(contentEl);
        this.renderStatus(contentEl);          // 靜態佔位，非同步填入
        this.renderModuleGrid(contentEl);
        this.renderQuickActions(contentEl);

        // 非同步載入統計數字
        this.loadStats(contentEl);
    }

    // ─── Header ────────────────────────────────────────────────────────────

    private renderHeader(el: HTMLElement): void {
        const header = el.createDiv({ cls: 'vll-home-header' });
        header.createEl('span', { text: 'VLL', cls: 'vll-home-logo' });
        header.createEl('span', { text: 'Video Language Learning', cls: 'vll-home-subtitle' });
    }

    // ─── 狀態列 ────────────────────────────────────────────────────────────

    private renderStatus(el: HTMLElement): void {
        const bar = el.createDiv({ cls: 'vll-home-status-bar', attr: { id: 'vll-status-bar' } });

        // LLM 狀態
        const llmOk = this.plugin.llm.isConfigured();
        const llmChip = bar.createDiv({
            cls: `vll-status-chip ${llmOk ? 'vll-chip-ok' : 'vll-chip-warn'}`,
        });
        llmChip.createEl('span', { text: llmOk ? t('home.statusLlmOk') : t('home.statusLlmFail') });
        if (!llmOk) {
            const link = llmChip.createEl('button', { text: t('home.configure'), cls: 'vll-chip-link' });
            link.addEventListener('click', () => {
                // @ts-ignore — Obsidian 內部 API 開啟設定頁
                (this.plugin.app as any).setting?.open?.();
                (this.plugin.app as any).setting?.openTabById?.('vll');
            });
        }

        // 生詞本 / 待複習（初始佔位）
        bar.createDiv({ cls: 'vll-status-chip vll-chip-neutral', attr: { id: 'vll-stat-vocab' } })
            .setText('...');
        bar.createDiv({ cls: 'vll-status-chip vll-chip-neutral', attr: { id: 'vll-stat-due' } })
            .setText('...');
    }

    private async loadStats(el: HTMLElement): Promise<void> {
        try {
            const stats   = await this.plugin.vocabStorage.getStats();
            const vocabEl = el.querySelector('#vll-stat-vocab') as HTMLElement | null;
            const dueEl   = el.querySelector('#vll-stat-due')   as HTMLElement | null;

            vocabEl?.setText(t('home.vocabCount', { count: stats.new + stats.learning + stats.review }));
            dueEl?.setText(
                stats.due > 0
                    ? t('home.dueCount', { count: stats.due })
                    : t('home.noDue')
            );
            if (stats.due > 0) dueEl?.addClass('vll-chip-warn');
        } catch {
            // 資料庫尚未就緒，靜默失敗
        }
    }

    // ─── 模組卡片 2×2 ──────────────────────────────────────────────────────

    private renderModuleGrid(el: HTMLElement): void {
        const grid = el.createDiv({ cls: 'vll-home-grid' });

        const modules: Array<{
            icon: string;
            titleKey: string;
            descKey: string;
            viewType: string;
            badgeId?: string;
        }> = [
            { icon: 'book-open',   titleKey: 'dict.viewTitle',      descKey: 'home.descDict',      viewType: VIEW_TYPE_DICT },
            { icon: 'highlighter', titleKey: 'highlight.viewTitle', descKey: 'home.descHighlight', viewType: VIEW_TYPE_HIGHLIGHT },
            { icon: 'brain',       titleKey: 'flashcard.viewTitle', descKey: 'home.descFlashcard', viewType: VIEW_TYPE_FLASHCARD, badgeId: 'vll-badge-due' },
            { icon: 'film',        titleKey: 'shadowing.viewTitle', descKey: 'home.descShadowing', viewType: VIEW_TYPE_SHADOWING },
        ];

        for (const mod of modules) {
            this.renderModuleCard(grid, mod);
        }
    }

    private renderModuleCard(
        container: HTMLElement,
        mod: { icon: string; titleKey: string; descKey: string; viewType: string; badgeId?: string },
    ): void {
        const card = container.createDiv({ cls: 'vll-home-card' });

        // 圖示
        const iconWrap = card.createDiv({ cls: 'vll-home-card-icon' });
        // Obsidian setIcon helper
        (this.plugin.app as any).vault; // 確保 app 就緒
        try {
            const { setIcon } = require('obsidian') as typeof import('obsidian');
            setIcon(iconWrap, mod.icon);
        } catch { iconWrap.setText(mod.icon); }

        // 文字
        const body = card.createDiv({ cls: 'vll-home-card-body' });
        body.createEl('span', { text: t(mod.titleKey as any), cls: 'vll-home-card-title' });
        body.createEl('span', { text: t(mod.descKey  as any), cls: 'vll-home-card-desc' });

        // 開啟按鈕
        const btn = card.createEl('button', { text: t('home.open'), cls: 'vll-btn vll-btn-primary vll-home-card-btn' });
        btn.addEventListener('click', () => this.plugin.openView(mod.viewType));

        card.addEventListener('click', (e) => {
            if (e.target !== btn) this.plugin.openView(mod.viewType);
        });
    }

    // ─── 快速動作 ───────────────────────────────────────────────────────────

    private renderQuickActions(el: HTMLElement): void {
        const row = el.createDiv({ cls: 'vll-home-quick-actions' });

        const importBtn = row.createEl('button', {
            text: t('home.importVideo'),
            cls:  'vll-btn vll-home-import-btn',
        });
        importBtn.addEventListener('click', () => this.plugin.openImportModal());
    }
}
