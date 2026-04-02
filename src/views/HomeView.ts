import { ItemView, TFile, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_HOME, VIEW_TYPE_DICT, VIEW_TYPE_HIGHLIGHT, VIEW_TYPE_FLASHCARD, VIEW_TYPE_SHADOWING, EVENT_ANNOTATION_JOB } from '../constants';
import { t } from '../i18n';
import type VLLPlugin from '../main';
import type { AnnotationJob } from '../types';

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

    private jobsEl!: HTMLElement;

    constructor(leaf: WorkspaceLeaf, private plugin: VLLPlugin) {
        super(leaf);
    }

    getViewType(): string    { return VIEW_TYPE_HOME; }
    getDisplayText(): string { return t('home.viewTitle'); }
    getIcon(): string        { return 'layout-dashboard'; }

    async onOpen(): Promise<void> {
        await this.render();
        // 訂閱背景標注任務更新 — ItemView.registerEvent 會在關閉時自動取消訂閱
        this.registerEvent(
            // @ts-ignore — custom workspace event
            this.app.workspace.on(EVENT_ANNOTATION_JOB, () => this.refreshJobs())
        );
    }

    async onClose(): Promise<void> { this.contentEl.empty(); }

    // ─── 渲染 ──────────────────────────────────────────────────────────────

    async render(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('vll-home-view');

        this.renderHeader(contentEl);
        this.renderStatus(contentEl);
        this.renderModuleGrid(contentEl);
        this.renderQuickActions(contentEl);

        // 標注任務進度區（局部刷新，不重繪整頁）
        this.jobsEl = contentEl.createDiv({ cls: 'vll-home-jobs' });
        this.refreshJobs();

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

        const annotateBtn = row.createEl('button', {
            text: t('home.annotateNote'),
            cls:  'vll-btn vll-home-annotate-btn',
        });
        annotateBtn.addEventListener('click', () => this.plugin.openAnnotateModal());
    }

    // ─── 標注任務進度（局部刷新）────────────────────────────────────────────

    private refreshJobs(): void {
        this.jobsEl.empty();
        const jobs = this.plugin.annotationJobs;
        if (jobs.length === 0) return;

        this.jobsEl.createEl('h4', {
            text: t('home.jobs.title'),
            cls:  'vll-home-section-title',
        });

        for (const job of jobs) {
            this.renderJobCard(this.jobsEl, job);
        }
    }

    private renderJobCard(container: HTMLElement, job: AnnotationJob): void {
        const card = container.createDiv({ cls: `vll-job-card vll-job-${job.status}` });

        // 標頭：圖示 + 檔名
        const icon: Record<AnnotationJob['status'], string> = {
            running:   '⏳',
            done:      '✅',
            failed:    '❌',
            cancelled: '🚫',
        };
        card.createDiv({ cls: 'vll-job-header' })
            .createEl('span', { text: `${icon[job.status]} ${job.fileName}`, cls: 'vll-job-filename' });

        // 進度條（僅 running 且 total 已知）
        if (job.status === 'running' && job.total > 0) {
            const pct  = Math.round((job.done / job.total) * 100);
            const prog = card.createDiv({ cls: 'vll-job-progress' });
            const bar  = prog.createDiv({ cls: 'vll-job-bar' });
            bar.createDiv({ cls: 'vll-job-fill', attr: { style: `width: ${pct}%` } });
            prog.createEl('span', { text: `${job.done} / ${job.total}`, cls: 'vll-job-count' });
        }

        // Streaming 預覽（LLM 即時輸出）
        if (job.status === 'running' && job.currentSubtitle) {
            const preview = card.createDiv({ cls: 'vll-job-stream-preview' });
            preview.createEl('span', {
                text: `▸ ${job.currentSubtitle}`,
                cls:  'vll-job-stream-input',
            });
            if (job.currentOutput) {
                // 只顯示最後 120 字元，避免卡片過長
                const tail = job.currentOutput.length > 120
                    ? '…' + job.currentOutput.slice(-120)
                    : job.currentOutput;
                preview.createEl('code', { text: tail, cls: 'vll-job-stream-output' });
            }
        }

        // 錯誤訊息
        if (job.status === 'failed' && job.error) {
            card.createEl('p', { text: job.error, cls: 'vll-job-error' });
        }

        // 操作按鈕
        const actions = card.createDiv({ cls: 'vll-job-actions' });

        if (job.status === 'running') {
            const cancelBtn = actions.createEl('button', { text: t('common.cancel'), cls: 'vll-btn' });
            cancelBtn.addEventListener('click', () => job.abort?.());
        }

        if (job.status === 'done' && job.resultPath) {
            const openBtn = actions.createEl('button', {
                text: t('shadowing.openAnnotated'),
                cls:  'vll-btn vll-btn-primary',
            });
            openBtn.addEventListener('click', async () => {
                const f = this.app.vault.getAbstractFileByPath(job.resultPath!);
                if (f instanceof TFile) {
                    await this.app.workspace.getLeaf(false).openFile(f);
                }
            });
        }

        // 已完成 / 失敗 / 取消 → 顯示關閉按鈕
        if (job.status !== 'running') {
            const dismissBtn = actions.createEl('button', {
                text:  '×',
                cls:   'vll-btn vll-job-dismiss',
                attr:  { title: t('home.jobs.dismiss') },
            });
            dismissBtn.addEventListener('click', () => {
                this.plugin.annotationJobs = this.plugin.annotationJobs.filter(j => j.id !== job.id);
                this.refreshJobs();
            });
        }
    }
}
