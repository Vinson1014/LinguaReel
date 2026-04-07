import { ItemView, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { VIEW_TYPE_HOME, VIEW_TYPE_DICT, VIEW_TYPE_HIGHLIGHT, VIEW_TYPE_FLASHCARD, VIEW_TYPE_SHADOWING, EVENT_ANNOTATION_JOB } from '../constants';
import { t } from '../i18n';
import type VLLPlugin from '../main';
import type { AnnotationJob } from '../types';

/**
 * VLL 首頁 — 垂直學習管線（Pipeline）
 *
 * 以由上到下的流程暗示學習步驟：
 * ① 匯入影片 → ② AI 標註 → ③ 跟讀工坊 → ④ 重點筆記 → ⑤ FSRS 閃卡
 * 底部常駐字典入口
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
        this.registerEvent(
            // @ts-ignore — custom workspace event
            this.app.workspace.on(EVENT_ANNOTATION_JOB, () => this.refreshJobs())
        );
    }

    async onClose(): Promise<void> { this.contentEl.empty(); }

    // ─── 主渲染 ─────────────────────────────────────────────────────────────

    async render(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('vll-home-view');

        this.renderHero(contentEl);
        this.renderStatsBar(contentEl);
        this.renderPipeline(contentEl);

        // 標注任務進度區（局部刷新）
        this.jobsEl = contentEl.createDiv({ cls: 'vll-home-jobs' });
        this.refreshJobs();

        this.renderDictBar(contentEl);

        // 非同步載入統計數字
        this.loadStats(contentEl);
    }

    // ─── Hero ───────────────────────────────────────────────────────────────

    private renderHero(el: HTMLElement): void {
        const hero = el.createDiv({ cls: 'vll-home-hero' });

        const titleRow = hero.createDiv({ cls: 'vll-home-hero-title-row' });
        titleRow.createEl('span', { text: 'LinguaReel', cls: 'vll-home-logo' });

        // LLM status chip inline with logo
        const llmOk = this.plugin.llm.isConfigured();
        const chip = titleRow.createDiv({
            cls: `vll-status-chip ${llmOk ? 'vll-chip-ok' : 'vll-chip-warn'}`,
        });
        const dot = chip.createEl('span', { cls: 'vll-status-dot' });
        dot.addClass(llmOk ? 'vll-dot-ok' : 'vll-dot-warn');
        chip.createEl('span', { text: llmOk ? t('home.statusLlmOk') : t('home.statusLlmFail') });
        if (!llmOk) {
            const link = chip.createEl('button', { text: t('home.configure'), cls: 'vll-chip-link' });
            link.addEventListener('click', () => {
                // @ts-ignore — Obsidian 內部 API
                (this.plugin.app as any).setting?.open?.();
                (this.plugin.app as any).setting?.openTabById?.('vll');
            });
        }

        hero.createEl('p', { text: t('home.tagline' as any), cls: 'vll-home-tagline' });
    }

    // ─── Stats Bar ──────────────────────────────────────────────────────────

    private renderStatsBar(el: HTMLElement): void {
        const bar = el.createDiv({ cls: 'vll-home-stats-bar' });

        // vocab stat
        const vocabStat = bar.createDiv({ cls: 'vll-stat-box', attr: { id: 'vll-stat-vocab-box' } });
        const vocabIcon = vocabStat.createDiv({ cls: 'vll-stat-icon' });
        setIcon(vocabIcon, 'book-open');
        vocabStat.createEl('span', { text: '...', cls: 'vll-stat-value', attr: { id: 'vll-stat-vocab-val' } });
        vocabStat.createEl('span', { text: t('home.statsVocab' as any), cls: 'vll-stat-label' });

        // due stat
        const dueStat = bar.createDiv({ cls: 'vll-stat-box', attr: { id: 'vll-stat-due-box' } });
        const dueIcon = dueStat.createDiv({ cls: 'vll-stat-icon' });
        setIcon(dueIcon, 'brain');
        dueStat.createEl('span', { text: '...', cls: 'vll-stat-value', attr: { id: 'vll-stat-due-val' } });
        dueStat.createEl('span', { text: t('home.statsDue' as any), cls: 'vll-stat-label' });

        // LLM chip (compact)
        const llmStat = bar.createDiv({ cls: 'vll-stat-box', attr: { id: 'vll-stat-llm-box' } });
        const llmIcon = llmStat.createDiv({ cls: 'vll-stat-icon' });
        setIcon(llmIcon, 'zap');
        const llmOk = this.plugin.llm.isConfigured();
        llmStat.createEl('span', {
            text: llmOk ? t('home.statusLlmOk') : t('home.statusLlmFail'),
            cls: `vll-stat-value ${llmOk ? '' : 'vll-stat-warn'}`,
            attr: { id: 'vll-stat-llm-val' },
        });
        llmStat.createEl('span', { text: 'LLM', cls: 'vll-stat-label' });
    }

    private async loadStats(el: HTMLElement): Promise<void> {
        try {
            const stats = await this.plugin.vocabStorage.getStats();
            const vocabVal = el.querySelector('#vll-stat-vocab-val') as HTMLElement | null;
            const dueVal = el.querySelector('#vll-stat-due-val') as HTMLElement | null;

            const total = stats.new + stats.learning + stats.review;
            vocabVal?.setText(String(total));

            if (stats.due > 0) {
                dueVal?.setText(String(stats.due));
                dueVal?.addClass('vll-stat-accent');
            } else {
                dueVal?.setText(t('home.noDue'));
            }
        } catch {
            // DB not ready
        }
    }

    // ─── Pipeline 步驟 ──────────────────────────────────────────────────────

    private renderPipeline(el: HTMLElement): void {
        const pipeline = el.createDiv({ cls: 'vll-pipeline' });

        const steps: Array<{
            num: number;
            icon: string;
            titleKey: string;
            descKey: string;
            action: () => void;
            actionLabel: string;
            accent: string;       // CSS accent color class
            isAction?: boolean;   // true = primary CTA button (import/annotate)
        }> = [
            {
                num: 1, icon: 'download', accent: 'vll-step-blue',
                titleKey: 'home.stepImport', descKey: 'home.stepImportDesc',
                action: () => this.plugin.openImportModal(),
                actionLabel: t('home.importVideo'),
                isAction: true,
            },
            {
                num: 2, icon: 'sparkles', accent: 'vll-step-green',
                titleKey: 'home.stepAnnotate', descKey: 'home.stepAnnotateDesc',
                action: () => this.plugin.openAnnotateModal(),
                actionLabel: t('home.annotateNote'),
                isAction: true,
            },
            {
                num: 3, icon: 'film', accent: 'vll-step-purple',
                titleKey: 'home.stepShadow', descKey: 'home.stepShadowDesc',
                action: () => this.plugin.openView(VIEW_TYPE_SHADOWING),
                actionLabel: t('home.open'),
            },
            {
                num: 4, icon: 'highlighter', accent: 'vll-step-orange',
                titleKey: 'home.stepHighlight', descKey: 'home.stepHighlightDesc',
                action: () => this.plugin.openView(VIEW_TYPE_HIGHLIGHT),
                actionLabel: t('home.open'),
            },
            {
                num: 5, icon: 'brain', accent: 'vll-step-pink',
                titleKey: 'home.stepFlashcard', descKey: 'home.stepFlashcardDesc',
                action: () => this.plugin.openView(VIEW_TYPE_FLASHCARD),
                actionLabel: t('home.open'),
            },
        ];

        steps.forEach((step, i) => {
            this.renderStep(pipeline, step, i === steps.length - 1);
        });
    }

    private renderStep(
        container: HTMLElement,
        step: {
            num: number; icon: string; accent: string;
            titleKey: string; descKey: string;
            action: () => void; actionLabel: string;
            isAction?: boolean;
        },
        isLast: boolean,
    ): void {
        const row = container.createDiv({ cls: 'vll-step-row' });

        // ─ 左側時間軸：圓圈 + 連線
        const timeline = row.createDiv({ cls: 'vll-step-timeline' });
        const circle = timeline.createDiv({ cls: `vll-step-circle ${step.accent}` });
        circle.createEl('span', { text: String(step.num), cls: 'vll-step-num' });
        if (!isLast) {
            timeline.createDiv({ cls: 'vll-step-line' });
        }

        // ─ 右側卡片
        const card = row.createDiv({ cls: `vll-step-card ${step.accent}` });

        const cardHeader = card.createDiv({ cls: 'vll-step-card-header' });
        const iconWrap = cardHeader.createDiv({ cls: 'vll-step-card-icon' });
        setIcon(iconWrap, step.icon);
        cardHeader.createEl('span', { text: t(step.titleKey as any), cls: 'vll-step-card-title' });

        card.createEl('p', { text: t(step.descKey as any), cls: 'vll-step-card-desc' });

        const btn = card.createEl('button', {
            text: step.actionLabel,
            cls: step.isAction
                ? 'vll-btn vll-btn-primary vll-step-btn'
                : 'vll-btn vll-step-btn-outline',
        });
        btn.addEventListener('click', (e) => { e.stopPropagation(); step.action(); });
        card.addEventListener('click', () => step.action());
    }

    // ─── 字典常駐入口 ───────────────────────────────────────────────────────

    private renderDictBar(el: HTMLElement): void {
        const bar = el.createDiv({ cls: 'vll-home-dict-bar' });
        const iconWrap = bar.createDiv({ cls: 'vll-home-dict-icon' });
        setIcon(iconWrap, 'search');

        const text = bar.createDiv({ cls: 'vll-home-dict-text' });
        text.createEl('span', { text: t('home.dictEntry' as any), cls: 'vll-home-dict-title' });
        text.createEl('span', { text: t('home.dictEntryDesc' as any), cls: 'vll-home-dict-desc' });

        bar.addEventListener('click', () => this.plugin.openView(VIEW_TYPE_DICT));
    }

    // ─── 標注任務進度（局部刷新）────────────────────────────────────────────

    private refreshJobs(): void {
        this.jobsEl.empty();
        const jobs = this.plugin.annotationJobs;
        if (jobs.length === 0) return;

        this.jobsEl.createEl('h4', {
            text: t('home.jobs.title'),
            cls: 'vll-home-section-title',
        });

        for (const job of jobs) {
            this.renderJobCard(this.jobsEl, job);
        }
    }

    private renderJobCard(container: HTMLElement, job: AnnotationJob): void {
        const card = container.createDiv({ cls: `vll-job-card vll-job-${job.status}` });

        const icon: Record<AnnotationJob['status'], string> = {
            running:   '⏳',
            done:      '✅',
            failed:    '❌',
            cancelled: '🚫',
        };
        card.createDiv({ cls: 'vll-job-header' })
            .createEl('span', { text: `${icon[job.status]} ${job.fileName}`, cls: 'vll-job-filename' });

        if (job.status === 'running' && job.total > 0) {
            const pct = Math.round((job.done / job.total) * 100);
            const prog = card.createDiv({ cls: 'vll-job-progress' });
            const bar = prog.createDiv({ cls: 'vll-job-bar' });
            bar.createDiv({ cls: 'vll-job-fill', attr: { style: `width: ${pct}%` } });
            prog.createEl('span', { text: `${job.done} / ${job.total}`, cls: 'vll-job-count' });
        }

        if (job.status === 'running' && job.currentSubtitle) {
            const preview = card.createDiv({ cls: 'vll-job-stream-preview' });
            preview.createEl('span', {
                text: `▸ ${job.currentSubtitle}`,
                cls: 'vll-job-stream-input',
            });
            if (job.currentOutput) {
                const tail = job.currentOutput.length > 120
                    ? '…' + job.currentOutput.slice(-120)
                    : job.currentOutput;
                preview.createEl('code', { text: tail, cls: 'vll-job-stream-output' });
            }
        }

        if (job.status === 'failed' && job.error) {
            card.createEl('p', { text: job.error, cls: 'vll-job-error' });
        }

        const actions = card.createDiv({ cls: 'vll-job-actions' });

        if (job.status === 'running') {
            const cancelBtn = actions.createEl('button', { text: t('common.cancel'), cls: 'vll-btn' });
            cancelBtn.addEventListener('click', () => job.abort?.());
        }

        if (job.status === 'done' && job.resultPath) {
            const openBtn = actions.createEl('button', {
                text: t('home.open'),
                cls: 'vll-btn vll-btn-primary',
            });
            openBtn.addEventListener('click', async () => {
                const f = this.app.vault.getAbstractFileByPath(job.resultPath!);
                if (f instanceof TFile) {
                    const leaf = this.app.workspace.getLeaf(false);
                    await leaf.openFile(f, { state: { mode: 'preview' } });
                }
            });
        }

        if (job.status !== 'running') {
            const dismissBtn = actions.createEl('button', {
                text: '×',
                cls: 'vll-btn vll-job-dismiss',
                attr: { title: t('home.jobs.dismiss') },
            });
            dismissBtn.addEventListener('click', () => {
                this.plugin.annotationJobs = this.plugin.annotationJobs.filter(j => j.id !== job.id);
                this.refreshJobs();
            });
        }
    }
}
