import { App, Modal, TFile, normalizePath } from 'obsidian';
import { t } from '../i18n';
import { SubtitleParser } from '../core/SubtitleParser';
import { AnnotationPipeline } from '../core/AnnotationPipeline';
import { NoteGenerator } from '../core/NoteGenerator';
import { getAnnotationSystemPrompt } from '../llm/prompts';
import type VLLPlugin from '../main';

/**
 * 字幕標註教材生成 Modal
 *
 * 從 ShadowingView 移出，讓跟讀工坊專注於學習體驗。
 * 觸發方式：指令面板 "VLL: Annotate current note" 或 HomeView 快捷按鈕。
 */
export class AnnotateModal extends Modal {

    private abortController: AbortController | null = null;
    private progressEl!: HTMLElement;
    private startBtn!: HTMLButtonElement;

    constructor(
        app: App,
        private plugin: VLLPlugin,
        private file: TFile,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: t('shadowing.annotate') });

        // 顯示目標檔案名稱
        contentEl.createEl('p', {
            text: this.file.basename,
            cls:  'vll-annotate-filename',
        });

        if (!this.plugin.llm.isConfigured()) {
            contentEl.createEl('p', {
                text: t('highlight.llmNotConfigured'),
                cls:  'vll-ai-error',
            });
            return;
        }

        // 進度區（初始隱藏）
        this.progressEl = contentEl.createDiv({ cls: 'vll-annotate-modal-progress' });

        // 按鈕列
        const btnRow = contentEl.createDiv({ cls: 'vll-annotate-modal-btns' });
        this.startBtn = btnRow.createEl('button', {
            text: t('shadowing.annotate'),
            cls:  'mod-cta',
        });
        btnRow.createEl('button', { text: t('common.cancel') })
            .addEventListener('click', () => {
                this.abortController?.abort();
                this.close();
            });

        this.startBtn.addEventListener('click', () => this.runAnnotation());
    }

    onClose(): void {
        this.abortController?.abort();
        this.contentEl.empty();
    }

    // ─── 標註流程 ─────────────────────────────────────────────────────────────

    private async runAnnotation(): Promise<void> {
        this.startBtn.disabled = true;
        this.abortController  = new AbortController();
        this.progressEl.empty();

        const noteContent = await this.plugin.app.vault.read(this.file);
        const entries     = SubtitleParser.parseShadowingNote(noteContent);

        if (entries.length === 0) {
            this.showError(t('shadowing.noSubtitles'));
            this.startBtn.disabled = false;
            return;
        }

        const progressText = this.progressEl.createEl('p', {
            text: t('shadowing.annotating', { done: 0, total: entries.length }),
            cls:  'vll-progress-text',
        });
        const cancelBtn = this.progressEl.createEl('button', {
            text: t('shadowing.annotationCancel'),
            cls:  'vll-btn',
        });
        cancelBtn.addEventListener('click', () => {
            this.abortController?.abort();
            cancelBtn.disabled = true;
        });

        try {
            const header = SubtitleParser.extractNoteHeader(noteContent);
            const systemPrompt = getAnnotationSystemPrompt(
                this.plugin.settings.annotationLanguage,
                this.plugin.settings.annotationSystemPrompt,
            );

            const pipeline = new AnnotationPipeline(this.plugin.llm);
            const result   = await pipeline.run(entries, {
                systemPrompt,
                signal: this.abortController.signal,
                onProgress: (done, total) => {
                    progressText.setText(t('shadowing.annotating', { done, total }));
                },
            });

            const annotatedPath = normalizePath(
                NoteGenerator.annotatedNotePath(this.file.path)
            );
            const existing = this.plugin.app.vault.getAbstractFileByPath(annotatedPath);
            if (existing instanceof TFile) {
                await this.plugin.app.vault.modify(existing, result.toMarkdown(header));
            } else {
                await this.plugin.app.vault.create(annotatedPath, result.toMarkdown(header));
            }

            if (result.warnings.length > 0) {
                console.warn('[VLL] Annotation warnings:', result.warnings);
            }

            // 成功 UI
            this.progressEl.empty();
            this.progressEl.createEl('p', {
                text: t('shadowing.annotationDone', { path: annotatedPath }),
                cls:  'vll-annotation-success',
            });

            const openBtn = this.progressEl.createEl('button', {
                text: t('shadowing.openAnnotated'),
                cls:  'mod-cta',
            });
            openBtn.addEventListener('click', async () => {
                const f = this.plugin.app.vault.getAbstractFileByPath(annotatedPath);
                if (f instanceof TFile) {
                    await this.plugin.app.workspace.getLeaf(false).openFile(f);
                    this.close();
                }
            });

        } catch (e) {
            if (this.abortController?.signal.aborted) {
                this.progressEl.empty();
                this.progressEl.createEl('p', { text: t('shadowing.annotationCancel') });
            } else {
                this.showError(e instanceof Error ? e.message : String(e));
            }
        } finally {
            this.startBtn.disabled = false;
            this.abortController  = null;
        }
    }

    private showError(msg: string): void {
        this.progressEl.createEl('p', { text: msg, cls: 'vll-ai-error' });
    }
}
