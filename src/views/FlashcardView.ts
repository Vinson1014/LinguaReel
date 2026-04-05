import { ItemView, WorkspaceLeaf } from 'obsidian';
import { fsrs, createEmptyCard, Rating, State, type Card } from 'ts-fsrs';
import { VIEW_TYPE_FLASHCARD } from '../constants';
import { t } from '../i18n';
import type VLLPlugin from '../main';
import type { VocabEntry } from '../types';

// ─── FSRS scheduler (singleton) ──────────────────────────────────────────────
const scheduler = fsrs();

// ─────────────────────────────────────────────────────────────────────────────

export class FlashcardView extends ItemView {

    static readonly type = VIEW_TYPE_FLASHCARD;

    private dueCards:  VocabEntry[] = [];
    private queueIdx   = 0;
    private doneToday  = 0;
    /** 目前等待鍵盤輸入的評分回呼（顯示答案後才設定） */
    private ratingCallback: ((r: Rating) => void) | null = null;

    constructor(leaf: WorkspaceLeaf, private plugin: VLLPlugin) {
        super(leaf);
    }

    getViewType(): string    { return VIEW_TYPE_FLASHCARD; }
    getDisplayText(): string { return t('flashcard.viewTitle'); }
    getIcon(): string        { return 'layers'; }

    async onOpen(): Promise<void> {
        this.contentEl.addClass('vll-flashcard-view');
        // 鍵盤快捷鍵：1=Again 2=Hard 3=Good 4=Easy（顯示答案後才生效）
        this.registerDomEvent(this.contentEl, 'keydown', (e: KeyboardEvent) => {
            if (!this.ratingCallback) return;
            const map: Record<string, Rating> = {
                '1': Rating.Again, '2': Rating.Hard,
                '3': Rating.Good,  '4': Rating.Easy,
            };
            const r = map[e.key];
            if (r !== undefined) {
                e.preventDefault();
                const cb = this.ratingCallback;
                this.ratingCallback = null;
                cb(r);
            }
        });
        await this.loadSession();
    }

    async onClose(): Promise<void> { this.contentEl.empty(); }

    // ─── Session loading ──────────────────────────────────────────────────────

    private async loadSession(): Promise<void> {
        this.dueCards  = await this.plugin.vocabStorage.getDueCards();
        this.queueIdx  = 0;
        this.doneToday = 0;
        this.render();
    }

    // ─── Main render ─────────────────────────────────────────────────────────

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.renderStats(contentEl);
        const card = this.dueCards[this.queueIdx];
        if (!card) { this.renderEmpty(contentEl); return; }
        this.renderCard(contentEl, card);
    }

    // ─── Stats bar ────────────────────────────────────────────────────────────

    private renderStats(container: HTMLElement): void {
        const bar  = container.createDiv({ cls: 'vll-fc-stats' });
        const remaining = this.dueCards.length - this.queueIdx;
        const chips: Array<{ label: string; value: number; warn?: boolean }> = [
            { label: t('flashcard.stats.due'),      value: remaining, warn: remaining > 0 },
            { label: t('flashcard.stats.new'),      value: this.dueCards.filter(c => c.state === State.New).length },
            { label: t('flashcard.stats.learning'), value: this.dueCards.filter(c => c.state === State.Learning || c.state === State.Relearning).length },
            { label: t('flashcard.stats.review'),   value: this.dueCards.filter(c => c.state === State.Review).length },
        ];
        for (const chip of chips) {
            const el = bar.createEl('span', { cls: `vll-chip${chip.warn ? ' vll-chip-warn' : ''}` });
            el.createEl('span', { text: String(chip.value), cls: 'vll-chip-num' });
            el.createEl('span', { text: ' ' + chip.label,   cls: 'vll-chip-label' });
        }
    }

    // ─── Card front ───────────────────────────────────────────────────────────

    private renderCard(container: HTMLElement, vocab: VocabEntry): void {
        const wrap  = container.createDiv({ cls: 'vll-fc-card' });
        const front = wrap.createDiv({ cls: 'vll-fc-front' });

        front.createEl('div', { text: vocab.word, cls: 'vll-fc-word' });
        if (vocab.reading) front.createEl('div', { text: vocab.reading, cls: 'vll-fc-reading' });

        const badge = stateText(vocab.state);
        if (badge) front.createEl('span', { text: badge, cls: 'vll-fc-state-badge' });

        // 例句提示：讓大腦有記憶線索而非純強記
        if (vocab.example) {
            front.createEl('div', { text: vocab.example, cls: 'vll-fc-context-hint' });
        }

        const showBtn = container.createEl('button', {
            text: t('flashcard.showAnswer'),
            cls:  'vll-btn vll-btn-primary vll-fc-show-btn',
        });
        showBtn.addEventListener('click', () => {
            showBtn.remove();
            this.renderBack(container, vocab, wrap);
        });
    }

    // ─── Card back ────────────────────────────────────────────────────────────

    private renderBack(container: HTMLElement, vocab: VocabEntry, cardEl: HTMLElement): void {
        cardEl.addClass('is-flipped');
        const back = cardEl.createDiv({ cls: 'vll-fc-back' });

        // POS badge — 與字典結果一致
        if (vocab.pos) {
            back.createEl('span', { text: vocab.pos, cls: 'vll-dict-pos' });
        }

        // 定義列表 — 與字典結果一致
        if (vocab.definitions.length > 0) {
            const defList = back.createEl('ol', { cls: 'vll-dict-definitions' });
            for (const d of vocab.definitions) defList.createEl('li', { text: d });
        }

        // 例句框 — 與字典結果一致
        if (vocab.example) {
            const exBox = back.createDiv({ cls: 'vll-dict-example' });
            exBox.createEl('div', { text: vocab.example, cls: 'vll-dict-ex-original' });
            if (vocab.exampleTranslation) {
                exBox.createEl('div', { text: vocab.exampleTranslation, cls: 'vll-dict-ex-translation' });
            }
        }

        // 上下文（字典的 notes 樣式）
        if (vocab.context) {
            back.createDiv({ text: vocab.context, cls: 'vll-dict-notes' });
        }

        // 來源
        if (vocab.sourceFile || vocab.timestamp) {
            const src = back.createDiv({ cls: 'vll-fc-source' });
            if (vocab.sourceFile) src.createEl('span', { text: vocab.sourceFile.replace(/^\[\[|\]\]$/g, '') });
            if (vocab.timestamp)  src.createEl('span', { text: ` ${vocab.timestamp}`, cls: 'vll-text-muted' });
        }

        this.renderRatingButtons(container, vocab);
    }

    // ─── Rating buttons ───────────────────────────────────────────────────────

    private renderRatingButtons(container: HTMLElement, vocab: VocabEntry): void {
        const bar     = container.createDiv({ cls: 'vll-fc-rating-bar' });
        const preview = this.previewIntervals(vocab);

        const ratings: Array<{ r: Rating; label: string; cls: string; key: string }> = [
            { r: Rating.Again, label: t('flashcard.again'), cls: 'vll-fc-btn-again', key: '1' },
            { r: Rating.Hard,  label: t('flashcard.hard'),  cls: 'vll-fc-btn-hard',  key: '2' },
            { r: Rating.Good,  label: t('flashcard.good'),  cls: 'vll-fc-btn-good',  key: '3' },
            { r: Rating.Easy,  label: t('flashcard.easy'),  cls: 'vll-fc-btn-easy',  key: '4' },
        ];

        const submit = async (r: Rating) => {
            this.ratingCallback = null;
            bar.querySelectorAll('button').forEach(b => ((b as HTMLButtonElement).disabled = true));
            await this.submitRating(vocab, r);
        };

        // 鍵盤快捷鍵 callback（keydown handler 在 onOpen 已註冊）
        this.ratingCallback = submit;

        // rating bar 需要 focus，keydown 才能冒泡至 contentEl
        bar.setAttribute('tabindex', '-1');
        bar.style.outline = 'none';
        setTimeout(() => bar.focus(), 0);

        for (const { r, label, cls, key } of ratings) {
            const wrap = bar.createDiv({ cls: 'vll-fc-btn-wrap' });
            const hint = preview[r];
            if (hint) wrap.createEl('span', { text: hint, cls: 'vll-fc-interval-hint' });
            const btn = wrap.createEl('button', {
                cls: `vll-btn vll-fc-rating-btn ${cls}`,
                attr: { title: `Press ${key}` },
            });
            btn.createEl('kbd', { text: key, cls: 'vll-fc-rating-key' });
            btn.createEl('span', { text: label });
            btn.addEventListener('click', () => submit(r));
        }
    }

    // ─── FSRS logic ───────────────────────────────────────────────────────────

    private vocabToCard(v: VocabEntry): Card {
        const base = createEmptyCard();
        return {
            ...base,
            due:            new Date(v.due),
            stability:      v.stability,
            difficulty:     v.difficulty,
            elapsed_days:   0,
            scheduled_days: 0,
            reps:           v.reps,
            lapses:         v.lapses,
            state:          v.state as State,
            last_review:    v.lastReview ? new Date(v.lastReview) : base.last_review,
        };
    }

    private previewIntervals(vocab: VocabEntry): Record<Rating, string> {
        const result = scheduler.repeat(this.vocabToCard(vocab), new Date()) as unknown as Record<number, { card: Card }>;
        const out: Partial<Record<Rating, string>> = {};
        for (const r of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
            const next = result[r]?.card;
            if (next) out[r] = fmtInterval(next.due);
        }
        return out as Record<Rating, string>;
    }

    private async submitRating(vocab: VocabEntry, rating: Rating): Promise<void> {
        const now    = new Date();
        const result = scheduler.repeat(this.vocabToCard(vocab), now) as unknown as Record<number, { card: Card }>;
        const next   = result[rating]!.card;

        await this.plugin.vocabStorage.updateSchedule(vocab.word, {
            due:        next.due.getTime(),
            stability:  next.stability,
            difficulty: next.difficulty,
            reps:       next.reps,
            lapses:     next.lapses,
            state:      next.state as number,
            lastReview: now.getTime(),
        });

        this.queueIdx++;
        this.doneToday++;

        // "Again" → 放回隊列末尾
        if (rating === Rating.Again) {
            this.dueCards.push({ ...vocab, state: next.state as number });
        }

        this.render();
    }

    // ─── Empty / done state ───────────────────────────────────────────────────

    private renderEmpty(container: HTMLElement): void {
        const wrap = container.createDiv({ cls: 'vll-fc-empty' });
        wrap.createEl('div', { text: '🎉', cls: 'vll-fc-empty-icon' });
        wrap.createEl('p', { text: t('flashcard.emptyState'), cls: 'vll-fc-empty-text' });
        if (this.doneToday > 0) {
            wrap.createEl('p', { text: `今日已完成 ${this.doneToday} 張`, cls: 'vll-text-muted' });
        }
        this.renderHeatmap(container);
    }

    // ─── Heatmap ──────────────────────────────────────────────────────────────

    private renderHeatmap(container: HTMLElement): void {
        const wrap = container.createDiv({ cls: 'vll-fc-heatmap-wrap' });
        wrap.createEl('h4', { text: t('flashcard.heatmap.title'), cls: 'vll-fc-heatmap-title' });

        this.plugin.vocabStorage.getAll().then(all => {
            const counts = new Map<string, number>();
            for (const e of all) {
                if (!e.lastReview) continue;
                const day = new Date(e.lastReview).toISOString().split('T')[0]!;
                counts.set(day, (counts.get(day) ?? 0) + 1);
            }

            if (counts.size === 0) {
                wrap.createEl('p', { text: t('flashcard.heatmap.noData'), cls: 'vll-text-muted' });
                return;
            }

            const grid  = wrap.createDiv({ cls: 'vll-heatmap-grid' });
            const today = new Date();
            for (let i = 364; i >= 0; i--) {
                const d    = new Date(today);
                d.setDate(today.getDate() - i);
                const key  = d.toISOString().split('T')[0]!;
                const n    = counts.get(key) ?? 0;
                const cell = grid.createDiv({ cls: 'vll-heatmap-cell' });
                cell.setAttribute('title', `${key}: ${n}`);
                if (n > 0) cell.addClass(`vll-heat-${n >= 10 ? 4 : n >= 5 ? 3 : n >= 2 ? 2 : 1}`);
            }
        });
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stateText(state: number): string {
    switch (state) {
        case State.New:        return 'NEW';
        case State.Learning:   return 'LEARNING';
        case State.Review:     return 'REVIEW';
        case State.Relearning: return 'RELEARNING';
        default: return '';
    }
}

function fmtInterval(due: Date): string {
    const mins = Math.round((due.getTime() - Date.now()) / 60000);
    if (mins < 60)  return `${mins}m`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24)   return `${hrs}h`;
    return `${Math.round(hrs / 24)}d`;
}
