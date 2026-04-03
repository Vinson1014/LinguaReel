import { ItemView, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_HIGHLIGHT } from '../constants';
import { t } from '../i18n';
import { parseHighlights } from '../core/HighlightParser';
import {
    getHighlightTranslationMessages,
    getHighlightResearchMessages,
    resolveSourceLang,
} from '../llm/prompts';
import type {
    HighlightTranslationResult,
    HighlightResearchResult,
} from '../llm/prompts';
import type VLLPlugin from '../main';
import type { HighlightColor, HighlightNote } from '../types';

export class HighlightView extends ItemView {

    static readonly type = VIEW_TYPE_HIGHLIGHT;

    private currentFile: TFile | null = null;
    private highlights: HighlightNote[] = [];
    private currentFilter: HighlightColor | 'all' = 'all';
    private searchQuery = '';
    private fileScope: 'current' | 'all' = 'current';

    constructor(leaf: WorkspaceLeaf, private plugin: VLLPlugin) {
        super(leaf);
    }

    getViewType(): string    { return VIEW_TYPE_HIGHLIGHT; }
    getDisplayText(): string { return t('highlight.viewTitle'); }
    getIcon(): string        { return 'highlighter'; }

    async onOpen(): Promise<void> {
        this.contentEl.addClass('vll-highlight-view');
        this.buildShell();
        await this.refresh();
    }

    async onClose(): Promise<void> {
        this.contentEl.empty();
    }

    /** Called from main.ts when active leaf changes */
    async refresh(file?: TFile): Promise<void> {
        if (file) this.currentFile = file;
        const parsed  = await this.loadHighlights();
        this.highlights = await this.mergeWithDb(parsed);
        this.renderList();
    }

    // ─── Shell ──────────────────────────────────────────────────────────────

    private buildShell(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.buildToolbar(contentEl.createDiv({ cls: 'vll-highlight-toolbar' }));
        contentEl.createDiv({ cls: 'vll-highlight-list' });
    }

    private buildToolbar(toolbar: HTMLElement): void {
        // Scope row
        const scopeRow = toolbar.createDiv({ cls: 'vll-scope-row' });
        const scopeOptions: Array<'current' | 'all'> = ['current', 'all'];
        for (const s of scopeOptions) {
            const btn = scopeRow.createEl('button', {
                text: s === 'current' ? t('highlight.currentDoc') : t('highlight.allFiles'),
                cls:  `vll-scope-btn${this.fileScope === s ? ' is-active' : ''}`,
            });
            btn.addEventListener('click', () => {
                this.fileScope = s;
                scopeRow.querySelectorAll('.vll-scope-btn').forEach((b, i) =>
                    b.toggleClass('is-active', scopeOptions[i] === s));
                this.refresh();
            });
        }

        // Search
        const searchInput = toolbar.createEl('input', {
            type:  'text',
            cls:   'vll-search-input',
            placeholder: t('highlight.searchPlaceholder'),
        });
        searchInput.addEventListener('input', () => {
            this.searchQuery = searchInput.value;
            this.renderList();
        });

        // Color filter
        const colorRow = toolbar.createDiv({ cls: 'vll-color-filter-row' });
        const colors: Array<HighlightColor | 'all'> = ['all', 'yellow', 'pink', 'blue', 'green'];
        for (const color of colors) {
            const label = color === 'all'
                ? t('highlight.filterAll')
                : t(`highlight.filter${color.charAt(0).toUpperCase() + color.slice(1)}` as any);
            const btn = colorRow.createEl('button', {
                text: label,
                cls:  `vll-color-btn vll-color-${color}${this.currentFilter === color ? ' is-active' : ''}`,
            });
            btn.addEventListener('click', () => {
                this.currentFilter = color;
                colorRow.querySelectorAll('.vll-color-btn').forEach((b, i) =>
                    b.toggleClass('is-active', colors[i] === color));
                this.renderList();
            });
        }
    }

    // ─── Data ───────────────────────────────────────────────────────────────

    private async loadHighlights(): Promise<HighlightNote[]> {
        if (this.fileScope === 'current') {
            const file = this.currentFile
                ?? this.plugin.app.workspace.getActiveFile();
            if (!file) return [];
            const content = await this.plugin.app.vault.read(file);
            return parseHighlights(content, file.path);
        }

        // All markdown files — read + parse sequentially to avoid memory spike
        const results: HighlightNote[] = [];
        for (const file of this.plugin.app.vault.getMarkdownFiles()) {
            const content = await this.plugin.app.vault.read(file);
            results.push(...parseHighlights(content, file.path));
        }
        return results;
    }

    /** Merge freshly-parsed highlights with stored DB records (AI results). */
    private async mergeWithDb(parsed: HighlightNote[]): Promise<HighlightNote[]> {
        return Promise.all(parsed.map(async h => {
            const stored = await this.plugin.db.getHighlight(h.id);
            if (!stored) return h;
            return { ...h, aiTranslation: stored.aiTranslation, aiResearch: stored.aiResearch };
        }));
    }

    // ─── Rendering ──────────────────────────────────────────────────────────

    private renderList(): void {
        const list = this.contentEl.querySelector('.vll-highlight-list') as HTMLElement | null;
        if (!list) return;
        list.empty();

        const filtered = this.highlights.filter(h => {
            if (this.currentFilter !== 'all' && h.color !== this.currentFilter) return false;
            if (this.searchQuery && !h.text.toLowerCase().includes(this.searchQuery.toLowerCase())) return false;
            return true;
        });

        if (filtered.length === 0) {
            list.createEl('p', { text: t('highlight.emptyState'), cls: 'vll-empty-state' });
            return;
        }

        for (const note of filtered) {
            this.renderCard(list, note);
        }
    }

    private renderCard(container: HTMLElement, note: HighlightNote): void {
        const card = container.createDiv({
            cls:  `vll-highlight-card vll-color-${note.color}`,
            attr: { 'data-id': note.id },
        });

        // Highlighted text
        card.createEl('p', { text: note.text, cls: 'vll-card-text' });

        // Context (surrounding line, if different from the highlight itself)
        if (note.context) {
            card.createEl('p', { text: `"${note.context}"`, cls: 'vll-card-context' });
        }

        // Source reference
        const fileName = note.sourceFile.split('/').pop() ?? note.sourceFile;
        const src = card.createEl('span', {
            text: `${fileName} · ${t('highlight.line')} ${note.sourceLine + 1}`,
            cls:  'vll-card-source',
        });
        src.addEventListener('click', () => this.navigateToSource(note));

        // Action buttons
        const actions = card.createDiv({ cls: 'vll-card-actions' });
        const translateBtn = actions.createEl('button', { text: t('highlight.translate'),  cls: 'vll-card-btn' });
        const researchBtn  = actions.createEl('button', { text: t('highlight.research'),   cls: 'vll-card-btn' });
        const navigateBtn  = actions.createEl('button', { text: t('highlight.navigateTo'), cls: 'vll-card-btn' });
        const deleteBtn    = actions.createEl('button', { text: t('highlight.delete'),     cls: 'vll-card-btn vll-card-btn-danger' });

        // AI result area
        const aiArea = card.createDiv({ cls: 'vll-card-ai-area' });

        // Pre-populate stored AI results
        if (note.aiTranslation) {
            this.renderTranslation(aiArea, note.aiTranslation);
        }
        if (note.aiResearch) {
            try {
                this.renderResearch(aiArea, JSON.parse(note.aiResearch) as HighlightResearchResult);
            } catch { /* ignore malformed */ }
        }

        // ── Translate ──────────────────────────────────────────────────────
        translateBtn.addEventListener('click', async () => {
            if (!this.plugin.llm.isConfigured()) {
                this.showAiError(aiArea, t('highlight.llmNotConfigured'));
                return;
            }
            translateBtn.setText(t('highlight.translating'));
            translateBtn.disabled = true;
            try {
                const msgs   = getHighlightTranslationMessages(note.text, note.context, this.plugin.settings.outputLanguage, this.plugin.settings.uiLanguage, resolveSourceLang(this.plugin.settings.annotationLanguage));
                const result = await this.plugin.llm.chatJSON<HighlightTranslationResult>(msgs, 'fast');
                const translation = result.translation + (result.note ? `\n${result.note}` : '');
                await this.saveToDb({ ...note, aiTranslation: translation });
                note.aiTranslation = translation;
                aiArea.querySelectorAll('.vll-ai-translation').forEach(el => el.remove());
                this.renderTranslation(aiArea, translation);
            } catch (e) {
                this.showAiError(aiArea, (e as Error).message);
            } finally {
                translateBtn.setText(t('highlight.translate'));
                translateBtn.disabled = false;
            }
        });

        // ── Research ───────────────────────────────────────────────────────
        researchBtn.addEventListener('click', async () => {
            if (!this.plugin.llm.isConfigured()) {
                this.showAiError(aiArea, t('highlight.llmNotConfigured'));
                return;
            }
            researchBtn.setText(t('highlight.researching'));
            researchBtn.disabled = true;
            try {
                const msgs   = getHighlightResearchMessages(note.text, note.context, this.plugin.settings.outputLanguage, this.plugin.settings.uiLanguage, resolveSourceLang(this.plugin.settings.annotationLanguage));
                const result = await this.plugin.llm.chatJSON<HighlightResearchResult>(msgs, 'powerful');
                const json   = JSON.stringify(result);
                await this.saveToDb({ ...note, aiResearch: json });
                note.aiResearch = json;
                aiArea.querySelectorAll('.vll-ai-research').forEach(el => el.remove());
                this.renderResearch(aiArea, result);
            } catch (e) {
                this.showAiError(aiArea, (e as Error).message);
            } finally {
                researchBtn.setText(t('highlight.research'));
                researchBtn.disabled = false;
            }
        });

        // ── Navigate ───────────────────────────────────────────────────────
        navigateBtn.addEventListener('click', () => this.navigateToSource(note));

        // ── Delete ─────────────────────────────────────────────────────────
        deleteBtn.addEventListener('click', async () => {
            await this.plugin.db.deleteHighlight(note.id);
            this.highlights = this.highlights.filter(h => h.id !== note.id);
            card.remove();
        });
    }

    // ─── AI result renderers ─────────────────────────────────────────────────

    private renderTranslation(container: HTMLElement, stored: string): void {
        const lines = stored.split('\n');
        const div   = container.createDiv({ cls: 'vll-ai-translation' });
        const row   = div.createDiv({ cls: 'vll-ai-row' });
        row.createEl('span', { text: t('highlight.translation') + ': ', cls: 'vll-ai-label' });
        row.createEl('span', { text: lines[0] ?? '' });
        if (lines[1]) {
            div.createEl('div', { text: lines[1], cls: 'vll-ai-note' });
        }
    }

    private renderResearch(container: HTMLElement, r: HighlightResearchResult): void {
        const div    = container.createDiv({ cls: 'vll-ai-research' });
        const header = div.createEl('button', {
            cls:  'vll-ai-research-toggle',
            text: `▶ ${t('highlight.researchResult')}`,
        });
        const body   = div.createDiv({ cls: 'vll-ai-research-body vll-hidden' });

        header.addEventListener('click', () => {
            const isHidden = body.hasClass('vll-hidden');
            body.toggleClass('vll-hidden', !isHidden);
            header.setText(`${isHidden ? '▼' : '▶'} ${t('highlight.researchResult')}`);
        });

        // Translation
        this.researchRow(body, t('highlight.translation'), r.translation);

        // Explanation
        this.researchRow(body, t('highlight.explanation'), r.explanation);

        // Examples
        if (r.examples?.length) {
            const row = body.createDiv({ cls: 'vll-research-item' });
            row.createEl('span', { text: t('highlight.examples') + ':', cls: 'vll-ai-label' });
            const ol = row.createEl('ol', { cls: 'vll-research-examples' });
            for (const ex of r.examples) {
                const li = ol.createEl('li');
                li.createEl('span', { text: ex.original });
                li.createEl('br');
                li.createEl('em', { text: ex.translation });
            }
        }

        // Related words
        if (r.related?.length) {
            const row = body.createDiv({ cls: 'vll-research-item' });
            row.createEl('span', { text: t('highlight.related') + ': ', cls: 'vll-ai-label' });
            for (const word of r.related) {
                row.createEl('span', { text: word, cls: 'vll-research-tag' });
            }
        }

        // Cultural notes
        if (r.cultural) {
            const row = body.createDiv({ cls: 'vll-research-item vll-research-cultural' });
            row.createEl('em', { text: r.cultural });
        }
    }

    private researchRow(container: HTMLElement, label: string, value: string): void {
        const row = container.createDiv({ cls: 'vll-research-item' });
        row.createEl('span', { text: label + ': ', cls: 'vll-ai-label' });
        row.createEl('span', { text: value });
    }

    private showAiError(container: HTMLElement, message: string): void {
        container.querySelectorAll('.vll-ai-error').forEach(el => el.remove());
        container.createEl('p', { text: message, cls: 'vll-ai-error' });
    }

    private async saveToDb(note: HighlightNote): Promise<void> {
        await this.plugin.db.putHighlight({ ...note, updatedAt: Date.now() });
    }

    // ─── Navigation ─────────────────────────────────────────────────────────

    private async navigateToSource(note: HighlightNote): Promise<void> {
        const abstract = this.plugin.app.vault.getAbstractFileByPath(note.sourceFile);
        if (!(abstract instanceof TFile)) return;

        const leaf = this.plugin.app.workspace.getLeaf(false);
        await leaf.openFile(abstract);

        const view = leaf.view;
        if (view instanceof MarkdownView && view.editor) {
            const pos = { line: note.sourceLine, ch: 0 };
            view.editor.setCursor(pos);
            view.editor.scrollIntoView({ from: pos, to: pos }, true);
        }
    }
}
