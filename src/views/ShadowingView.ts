import { ItemView, TFile, WorkspaceLeaf, normalizePath } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { VIEW_TYPE_SHADOWING } from '../constants';
import { t } from '../i18n';
import type VLLPlugin from '../main';
import type { ShadowingEntry } from '../types';
import { SubtitleParser } from '../core/SubtitleParser';
import { NoteGenerator } from '../core/NoteGenerator';
import { YtDlpRunner } from '../core/YtDlpRunner';

// ─── YouTube IFrame API minimal types ────────────────────────────────────────

declare global {
    interface Window {
        YT?: {
            Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayer;
            PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
        };
        onYouTubeIframeAPIReady?: () => void;
    }
}
interface YTPlayer {
    getCurrentTime(): number;
    getPlayerState(): number;
    playVideo(): void;
    pauseVideo(): void;
    seekTo(s: number, allowSeekAhead: boolean): void;
    setPlaybackRate(r: number): void;
    destroy(): void;
}
interface YTPlayerOptions {
    videoId: string;
    playerVars?: Record<string, unknown>;
    events?: { onReady?: () => void; onError?: (e: { data: number }) => void };
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface SubtitleBlock {
    index:     number;
    startSec:  number;
    endSec:    number;
    text:      string;
    timestamp: string;
}

/** Parsed data from the corresponding annotated note (if it exists). */
interface AnnotatedData {
    /** Original text as HTML (bold markers converted to <strong>) */
    originalHtml: string;
    /** Full annotation HTML (translation div + lesson divs from AnnotationFormatter) */
    annotationHtml: string;
}

type PlaybackSpeed = 0.8 | 1.0 | 1.25;
type ShadowingMode = 'shadowing' | 'dictation';

// ─────────────────────────────────────────────────────────────────────────────

export class ShadowingView extends ItemView {

    static readonly type = VIEW_TYPE_SHADOWING;

    // Video
    private videoEl:  HTMLVideoElement | null = null;
    private ytPlayer: YTPlayer | null         = null;
    private ytTimer:  number  | null          = null;

    // Subtitle state
    private blocks:       SubtitleBlock[]            = [];
    private annotatedMap: Map<string, AnnotatedData> = new Map();
    private activeIndex   = -1;
    private speed: PlaybackSpeed = 1.0;
    private mode: ShadowingMode  = 'shadowing';

    // Note state
    private currentFile:     TFile | null    = null;
    private entries:         ShadowingEntry[] = [];
    /** 從筆記 frontmatter 讀取的 ai_summary，查詞時注入 context */
    private noteSummary?:    string;
    /** Header 中的「開啟標注版」按鈕（有標注版時才啟用） */
    private openAnnotatedBtn: HTMLButtonElement | null = null;

    // UI refs
    private playPauseBtn!:    HTMLButtonElement;
    private speedBtns:        HTMLButtonElement[] = [];
    private blocksContainer!: HTMLElement;
    private blockEls:         HTMLElement[]       = [];
    private selectionPopup:   HTMLElement | null  = null;

    // Dictation state — persists across renderBlocks() calls
    private dictationAttempts: Map<number, string> = new Map();

    constructor(leaf: WorkspaceLeaf, private plugin: VLLPlugin) {
        super(leaf);
    }

    getViewType(): string    { return VIEW_TYPE_SHADOWING; }
    getDisplayText(): string { return t('shadowing.viewTitle'); }
    getIcon(): string        { return 'film'; }

    async onOpen(): Promise<void> {
        this.contentEl.addClass('vll-shadowing-view');
        // Issue 4: auto-load whatever note is currently open
        const file = this.plugin.app.workspace.getActiveFile();
        if (file) await this.loadNote(file);
        else      this.renderEmpty();
    }

    async onClose(): Promise<void> {
        this.hideSelectionPopup();
        this.destroyPlayer();
        this.contentEl.empty();
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    async loadNote(file: TFile): Promise<void> {
        if (this.currentFile?.path === file.path) return;
        this.destroyPlayer();

        const content   = await this.plugin.app.vault.read(file);
        const entries   = SubtitleParser.parseShadowingNote(content);

        // EME approach: prefer ![[video.ext]] wikilink resolution over raw path
        const source    = this.resolveVideoSource(content, file);

        this.currentFile  = file;
        this.entries      = entries;
        this.blocks       = this.buildBlocks(entries);
        this.activeIndex  = -1;
        this.annotatedMap = await this.loadAnnotatedData(file);
        // 讀取 ai_summary（標注時生成並存在 frontmatter），供查詞時注入
        this.noteSummary  = this.plugin.app.metadataCache
            .getFileCache(file)?.frontmatter?.['ai_summary'] as string | undefined;

        this.renderNoteView(file, source);

        // 更新「開啟標注版」按鈕狀態
        if (this.openAnnotatedBtn && !file.path.endsWith(' - annotated.md')) {
            const annotatedPath = normalizePath(NoteGenerator.annotatedNotePath(file.path));
            const annotatedFile = this.plugin.app.vault.getAbstractFileByPath(annotatedPath);
            const hasAnnotated  = annotatedFile instanceof TFile;
            this.openAnnotatedBtn.disabled = !hasAnnotated;
            if (hasAnnotated) {
                this.openAnnotatedBtn.onclick = async () => {
                    const leaf = this.plugin.app.workspace.getLeaf(false);
                    await leaf.openFile(annotatedFile as TFile, { state: { mode: 'preview' } });
                };
            }
        }
    }

    /**
     * Resolve video source using EME's approach:
     * 1. Scan for ![[video.ext]] wikilink → vault.getResourcePath(TFile)
     * 2. Fall back to frontmatter source: field
     */
    private resolveVideoSource(
        content: string,
        file: TFile,
    ): { type: 'youtube' | 'local'; url: string } | null {
        const { metadataCache, vault } = this.plugin.app;

        // 1. Wikilink embed: ![[anything.mp4]] — same as EME
        const wikiMatch = content.match(
            /!\[\[(.*?\.(?:mp4|webm|ogv|mov|mkv|avi|m4v))\]\]/i,
        );
        if (wikiMatch) {
            const linktext = wikiMatch[1]!;
            const linked = metadataCache.getFirstLinkpathDest(linktext, file.path);
            if (linked) {
                return { type: 'local', url: vault.getResourcePath(linked) };
            }
        }

        // 2. Markdown image syntax: ![](path/to/video.mp4)
        const mdMatch = content.match(
            /!\[.*?\]\((.*?\.(?:mp4|webm|ogv|mov|mkv|avi|m4v))\)/i,
        );
        if (mdMatch) {
            const linktext = mdMatch[1]!;
            if (!linktext.startsWith('http')) {
                const linked = metadataCache.getFirstLinkpathDest(linktext, file.path);
                if (linked) return { type: 'local', url: vault.getResourcePath(linked) };
            }
        }

        // 3. YouTube URL in frontmatter source:
        const fmSource = SubtitleParser.extractVideoSource(content);
        if (fmSource?.type === 'youtube') return fmSource;

        return null;
    }

    // ─── Annotated data loading ───────────────────────────────────────────────

    /**
     * Parse annotated data from the corresponding annotated note.
     * If the current file IS the annotated note (ends with " - annotated.md"),
     * parse it directly. Otherwise look for "[name] - annotated.md".
     */
    private async loadAnnotatedData(file: TFile): Promise<Map<string, AnnotatedData>> {
        const isAlreadyAnnotated = file.path.endsWith(' - annotated.md');
        let annotatedFile: TFile;
        if (isAlreadyAnnotated) {
            annotatedFile = file;
        } else {
            const annotatedPath = normalizePath(NoteGenerator.annotatedNotePath(file.path));
            const found = this.plugin.app.vault.getAbstractFileByPath(annotatedPath);
            if (!(found instanceof TFile)) return new Map();
            annotatedFile = found;
        }

        const content = await this.plugin.app.vault.read(annotatedFile);
        const map     = new Map<string, AnnotatedData>();
        const TS_RE   = /^\[(\d{2}:\d{2}(?::\d{2})?)\]\s*/;

        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            const m = TS_RE.exec(trimmed);
            if (!m) continue;

            const timestamp = m[1]!;
            const rest      = trimmed.slice(m[0].length);

            // Split at the annotation div boundary
            const divIdx = rest.indexOf('<div');
            if (divIdx >= 0) {
                map.set(timestamp, {
                    originalHtml:   boldToStrong(rest.slice(0, divIdx).trim()),
                    annotationHtml: rest.slice(divIdx),
                });
            } else {
                map.set(timestamp, {
                    originalHtml:   boldToStrong(rest.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').trim()),
                    annotationHtml: '',
                });
            }
        }
        return map;
    }

    // ─── Shell rendering ─────────────────────────────────────────────────────

    private renderEmpty(): void {
        this.contentEl.empty();
        this.contentEl.createEl('p', { text: t('shadowing.emptyState'), cls: 'vll-empty-state' });
    }

    private renderNoteView(
        file:   TFile,
        source: { type: 'youtube' | 'local'; url: string } | null,
    ): void {
        const { contentEl } = this;
        contentEl.empty();

        // ── Title ──
        const header = contentEl.createDiv({ cls: 'vll-shadowing-header' });
        header.createEl('span', { text: file.basename, cls: 'vll-shadowing-title' });
        // 「開啟標注版」按鈕（loadNote 中更新狀態）
        this.openAnnotatedBtn = header.createEl('button', {
            text: t('shadowing.openAnnotated'),
            cls:  'vll-btn vll-shadowing-annotated-btn',
        });
        this.openAnnotatedBtn.disabled = true;

        // ── Video player ──
        if (source) {
            const wrap = contentEl.createDiv({ cls: 'vll-video-wrapper' });
            if (source.type === 'youtube') {
                const id = SubtitleParser.extractYouTubeVideoId(source.url);
                if (id) this.initYouTube(wrap, id);
                else wrap.createEl('p', { text: 'Invalid YouTube URL', cls: 'vll-text-muted' });
            } else {
                this.initLocalVideo(wrap, source.url);
            }
        }

        // ── Controls ──
        if (source) {
            this.renderControls(contentEl);
        }

        // ── Scrollable blocks list ──
        this.renderBlocksArea(contentEl);
    }

    // ─── Controls ────────────────────────────────────────────────────────────

    private renderControls(container: HTMLElement): void {
        const bar = container.createDiv({ cls: 'vll-player-controls' });

        for (const secs of [10, 5] as const) {
            const btn = bar.createEl('button', { text: `−${secs}s`, cls: 'vll-ctrl-btn' });
            btn.addEventListener('click', () => this.rewind(secs));
        }

        this.playPauseBtn = bar.createEl('button', {
            text: '▶',
            cls:  'vll-ctrl-btn vll-ctrl-playpause',
        });
        this.playPauseBtn.addEventListener('click', () => this.togglePlayback());

        const speeds: PlaybackSpeed[] = [0.8, 1.0, 1.25];
        this.speedBtns = [];
        for (const s of speeds) {
            const btn = bar.createEl('button', {
                text: `${s}×`,
                cls:  `vll-ctrl-btn${s === this.speed ? ' is-active' : ''}`,
            });
            btn.addEventListener('click', () => this.setSpeed(s));
            this.speedBtns.push(btn);
        }

        const modeRow = container.createDiv({ cls: 'vll-mode-row' });
        for (const m of ['shadowing', 'dictation'] as ShadowingMode[]) {
            const label = m === 'shadowing' ? t('shadowing.modeShadowing') : t('shadowing.modeDictation');
            const btn   = modeRow.createEl('button', {
                text: label,
                cls:  `vll-scope-btn${this.mode === m ? ' is-active' : ''}`,
            });
            btn.addEventListener('click', () => {
                this.mode = m;
                modeRow.querySelectorAll('.vll-scope-btn').forEach((b, i) =>
                    b.toggleClass('is-active', (['shadowing', 'dictation'] as ShadowingMode[])[i] === m));
                // Re-render all blocks for the new mode
                this.renderBlocks();
            });
        }
    }

    // ─── Blocks list (scrollable, all subtitles) ─────────────────────────────

    private renderBlocksArea(container: HTMLElement): void {
        this.blocksContainer = container.createDiv({ cls: 'vll-blocks-container' });

        // Selection popup on mouseup inside blocks
        this.blocksContainer.addEventListener('mouseup', () => {
            // Use setTimeout so the selection is finalised before we read it
            setTimeout(() => this.handleTextSelection(), 0);
        });
        // Dismiss popup on click outside
        this.registerDomEvent(document, 'mousedown', (e: MouseEvent) => {
            if (this.selectionPopup && !this.selectionPopup.contains(e.target as Node)) {
                this.hideSelectionPopup();
            }
        });

        if (this.blocks.length === 0) {
            this.blocksContainer.createEl('p', {
                text: t('shadowing.noSubtitles'),
                cls:  'vll-empty-state',
            });
            return;
        }
        this.renderBlocks();
    }

    /** Render (or re-render) all subtitle blocks. Called on load and on mode change. */
    private renderBlocks(): void {
        this.blocksContainer.empty();
        this.blockEls = [];

        for (let i = 0; i < this.blocks.length; i++) {
            const block = this.blocks[i]!;
            const item  = this.blocksContainer.createDiv({ cls: 'vll-shadowing-item' });
            item.dataset.blockIndex = String(i);
            if (i === this.activeIndex) item.addClass('active');
            this.blockEls.push(item);

            // Timestamp — click to seek
            const tsEl = item.createEl('span', {
                text: `[${block.timestamp}]`,
                cls:  'vll-block-ts',
            });
            tsEl.addEventListener('click', e => {
                e.stopPropagation();
                this.seekTo(block.startSec);
            });

            // Original text
            const textEl    = item.createDiv({ cls: 'vll-block-text' });
            const annotated = this.annotatedMap.get(block.timestamp);
            const subtitleOnly = (block.text.split(/<div\b/)[0] ?? block.text);
            const plainText    = subtitleOnly.replace(/<[^>]+>/g, '').replace(/\*\*/g, '').trim();

            if (annotated?.originalHtml) {
                if (this.mode === 'dictation') {
                    textEl.createEl('span', { cls: 'vll-sub-blurred' }).innerHTML =
                        annotated.originalHtml;
                } else {
                    textEl.innerHTML = annotated.originalHtml;
                }
            } else {
                if (this.mode === 'dictation') {
                    textEl.createEl('span', { text: plainText, cls: 'vll-sub-blurred' });
                } else {
                    textEl.setText(plainText);
                }
            }

            // Annotation (translation + lessons) — hidden in dictation mode
            if (annotated?.annotationHtml && this.mode !== 'dictation') {
                const annotEl = item.createDiv({ cls: 'vll-block-annotation' });
                annotEl.innerHTML = annotated.annotationHtml;
            }

            // Dictation mode: input area below blurred text
            if (this.mode === 'dictation') {
                const blurEl = textEl.querySelector('.vll-sub-blurred') as HTMLElement | null;

                const area     = item.createDiv({ cls: 'vll-dictation-area' });
                const inputEl  = area.createEl('input', { cls: 'vll-dictation-input' });
                inputEl.type        = 'text';
                inputEl.placeholder = t('shadowing.dictationPlaceholder');

                const prevAttempt = this.dictationAttempts.get(i);
                if (prevAttempt !== undefined) inputEl.value = prevAttempt;

                const actions  = area.createDiv({ cls: 'vll-dictation-actions' });
                const checkBtn = actions.createEl('button', {
                    text: t('shadowing.checkAnswer'),
                    cls:  'vll-btn',
                });
                const revealBtn = actions.createEl('button', {
                    text: t('shadowing.reveal'),
                    cls:  'vll-btn vll-dictation-reveal-btn',
                });

                const resultEl = area.createDiv({ cls: 'vll-dictation-result' });

                // Restore previous result if user already submitted this block
                if (prevAttempt !== undefined) {
                    this.renderDiff(plainText, prevAttempt, resultEl);
                }

                const submit = () => this.submitDictation(i, plainText, inputEl, resultEl);
                checkBtn.addEventListener('click', submit);
                inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') { e.preventDefault(); submit(); }
                });

                revealBtn.addEventListener('click', () => {
                    blurEl?.addClass('is-revealed');
                });
            }
        }
    }

    // ─── Selection popup ──────────────────────────────────────────────────────

    private handleTextSelection(): void {
        const selection = window.getSelection();
        const text = selection?.toString().trim() ?? '';
        if (!text || !selection?.rangeCount) {
            this.hideSelectionPopup();
            return;
        }

        const range = selection.getRangeAt(0);
        const rect  = range.getBoundingClientRect();

        // Find which block contains the selection anchor
        const anchorItem = (selection.anchorNode?.parentElement)
            ?.closest('.vll-shadowing-item') as HTMLElement | null;
        const blockIdx = anchorItem
            ? parseInt(anchorItem.dataset.blockIndex ?? '-1', 10)
            : -1;

        this.showSelectionPopup(text, rect, blockIdx);
    }

    private showSelectionPopup(text: string, rect: DOMRect, blockIdx: number): void {
        this.hideSelectionPopup();

        const popup = document.createElement('div');
        popup.className = 'vll-selection-popup';
        // Position: centred above the selection using fixed coords
        popup.style.left = `${rect.left + rect.width / 2}px`;
        popup.style.top  = `${rect.top - 8}px`;

        // ── Dictionary lookup ──
        const dictBtn = popup.createEl('button', {
            cls:  'vll-popup-btn',
            attr: { title: t('dict.viewTitle') },
        });
        dictBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
        dictBtn.addEventListener('mousedown', e => {
            e.preventDefault();
            this.hideSelectionPopup();
            // 前後各 2 條字幕合併為 context，並附加筆記 ai_summary（若有）
            const lo = Math.max(0, blockIdx - 2);
            const hi = Math.min(this.blocks.length - 1, blockIdx + 2);
            let context = this.blocks.slice(lo, hi + 1)
                .map(b => {
                    // Strip annotation block (translation/lesson HTML) — keep only original subtitle text
                    const raw = b.text.split(/<div\s[^>]*class=['"]vll-ann-block/)[0] ?? b.text;
                    return raw.replace(/<[^>]*>/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
                })
                .join(' ');
            if (this.noteSummary) context += `\n[Content context: ${this.noteSummary}]`;
            const timestamp  = this.blocks[blockIdx]?.timestamp;
            const sourceFile = this.currentFile ? `[[${this.currentFile.basename}]]` : undefined;
            this.plugin.lookupWord(text, context, sourceFile, timestamp);
        });
        popup.appendChild(dictBtn);

        // ── Divider ──
        popup.createEl('span', { cls: 'vll-popup-divider' });

        // ── Highlight color chips ──
        const COLORS: Array<{ hex: string; label: string }> = [
            { hex: '#FFF3A3A6', label: '黃色' },
            { hex: '#FFB8EBA6', label: '粉色' },
            { hex: '#ABF7F7A6', label: '藍色' },
            { hex: '#BBFABBA6', label: '綠色' },
        ];
        for (const { hex, label } of COLORS) {
            const chip = popup.createEl('button', {
                cls:  'vll-popup-color',
                attr: { title: label },
            });
            // Use the opaque 6-digit version for the visual dot
            chip.style.background = '#' + hex.slice(1, 7);
            chip.addEventListener('mousedown', e => {
                e.preventDefault();
                this.hideSelectionPopup();
                if (blockIdx >= 0) this.addHighlightToNote(text, hex, blockIdx);
            });
            popup.appendChild(chip);
        }

        document.body.appendChild(popup);
        this.selectionPopup = popup;
    }

    private hideSelectionPopup(): void {
        this.selectionPopup?.remove();
        this.selectionPopup = null;
    }

    /** Wrap selectedText with <mark> in the source note at the given block's line. */
    private async addHighlightToNote(
        selectedText: string,
        colorHex: string,
        blockIdx: number,
    ): Promise<void> {
        const block = this.blocks[blockIdx];
        if (!block || !this.currentFile) return;

        const content = await this.plugin.app.vault.read(this.currentFile);
        const lines   = content.split('\n');

        // Find the line starting with [timestamp]
        const tsRe    = new RegExp(`^\\[${block.timestamp}\\]`);
        const lineIdx = lines.findIndex(l => tsRe.test(l.trim()));
        if (lineIdx === -1) return;

        const line = lines[lineIdx]!;

        // Separate subtitle text from annotation block (annotation starts at first <div)
        const divIdx   = line.indexOf('<div');
        const textPart = divIdx >= 0 ? line.slice(0, divIdx) : line;
        const divPart  = divIdx >= 0 ? line.slice(divIdx) : '';

        // AnnotationFormatter wraps annotated words in **...**; strip them so that
        // selectedText (DOM plain text) matches against the file content.
        const plainText = textPart.replace(/\*\*/g, '');
        if (!plainText.includes(selectedText)) return;

        const marked   = `<mark style="background: ${colorHex};">${selectedText}</mark>`;
        lines[lineIdx] = plainText.replace(selectedText, marked) + divPart;
        await this.plugin.app.vault.modify(this.currentFile, lines.join('\n'));
    }

    /** Seek video to given seconds and resume playback. */
    private seekTo(secs: number): void {
        if (this.videoEl) {
            this.videoEl.currentTime = secs;
            this.videoEl.play().catch(() => { /* autoplay policy — user must interact */ });
        } else if (this.ytPlayer) {
            this.ytPlayer.seekTo(secs, true);
            this.ytPlayer.playVideo();
        }
    }

    // ─── Time update ─────────────────────────────────────────────────────────

    private onTimeUpdate(currentTime: number): void {
        let idx = -1;
        for (let i = 0; i < this.blocks.length; i++) {
            const b = this.blocks[i]!;
            if (currentTime >= b.startSec && currentTime < b.endSec) { idx = i; break; }
        }

        if (idx === this.activeIndex) return;

        // Deactivate previous
        if (this.activeIndex >= 0) {
            this.blockEls[this.activeIndex]?.removeClass('active');
        }
        this.activeIndex = idx;

        // Dictation mode: auto-pause on each new line the user hasn't answered yet
        if (this.mode === 'dictation' && idx >= 0 && !this.dictationAttempts.has(idx)) {
            this.pauseVideo();
        }

        // Activate new
        if (idx >= 0) {
            const el = this.blockEls[idx];
            if (el) {
                el.addClass('active');
                // Smooth-scroll the block list so the active item is visible
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                // Focus the input so the user can type immediately
                if (this.mode === 'dictation') {
                    (el.querySelector('.vll-dictation-input') as HTMLInputElement | null)?.focus();
                }
            }
        }
    }

    // ─── YouTube player ───────────────────────────────────────────────────────

    private initYouTube(container: HTMLElement, videoId: string): void {
        const div = container.createDiv({ cls: 'vll-yt-player' });
        const tryInit = () => {
            if (!window.YT?.Player) { setTimeout(tryInit, 500); return; }
            try {
                this.ytPlayer = new window.YT.Player(div, {
                    videoId,
                    playerVars: { rel: 0, modestbranding: 1 },
                    events: {
                        onReady: () => {
                            this.ytPlayer?.setPlaybackRate(this.speed);
                            this.startYtTick();
                        },
                        onError: (e: { data: number }) => {
                            if (e.data === 101 || e.data === 150) {
                                this.renderEmbedBlockedUI(container, videoId);
                            }
                        },
                    },
                });
            } catch (e) { console.error('[VLL] YT init error:', e); }
        };

        if (!window.YT?.Player) {
            this.loadYouTubeApi(tryInit);
        } else {
            tryInit();
        }
    }

    private renderEmbedBlockedUI(container: HTMLElement, videoId: string): void {
        container.empty();
        const wrap = container.createDiv({ cls: 'vll-embed-blocked' });
        wrap.createEl('p', { text: t('shadowing.embedBlocked'), cls: 'vll-embed-blocked-msg' });

        const statusEl = wrap.createEl('p', { cls: 'vll-embed-blocked-status' });

        const btn = wrap.createEl('button', {
            text: t('shadowing.downloadVideoBtn'),
            cls:  'mod-cta',
        });
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            await this.downloadVideoLocally(videoId, statusEl);
            btn.disabled = false;
        });
    }

    private async downloadVideoLocally(videoId: string, statusEl: HTMLElement): Promise<void> {
        const { app } = this.plugin;
        const file = this.currentFile;
        if (!file) return;

        if (!this.plugin.envStatus.ytdlp.available) {
            statusEl.textContent = t('shadowing.downloadNeedYtdlp');
            return;
        }

        const url   = `https://www.youtube.com/watch?v=${videoId}`;
        const ytdlp = new YtDlpRunner(this.plugin.settings.ytdlpPath);

        try {
            const videoPath = await ytdlp.downloadVideo(url, msg => { statusEl.textContent = msg; });
            const filename  = path.basename(videoPath);

            statusEl.textContent = '正在儲存至 vault...';

            // 用 Obsidian 的附件路徑設定決定存放位置
            const destPath = await app.fileManager.getAvailablePathForAttachment(filename, file.path);

            // 確保目標資料夾存在
            const destFolder = path.dirname(destPath);
            if (destFolder && !(await app.vault.adapter.exists(destFolder))) {
                await app.vault.createFolder(destFolder);
            }

            // 複製影片進 vault
            const vaultBase  = (app.vault.adapter as any).basePath as string;
            const absDestPath = path.join(vaultBase, destPath.replace(/\//g, path.sep));
            fs.copyFileSync(videoPath, absDestPath);
            YtDlpRunner.cleanupTempDir(path.dirname(videoPath));

            // 在筆記 frontmatter 後插入 wikilink
            const content    = await app.vault.read(file);
            const wikilink   = `![[${path.basename(destPath)}]]`;
            if (!content.includes(wikilink)) {
                const updated = content.replace(
                    /^(---\n[\s\S]*?\n---\n)/,
                    `$1\n${wikilink}\n`,
                );
                await app.vault.modify(file, updated);
            }

            statusEl.textContent = t('shadowing.downloadSuccess');

            // 重新載入（先清 currentFile 讓 loadNote 不會跳過）
            this.currentFile = null;
            await this.loadNote(file);

        } catch (e: any) {
            statusEl.textContent = t('shadowing.downloadError', { msg: e.message });
        }
    }

    private loadYouTubeApi(onReady: () => void): void {
        if (document.getElementById('vll-yt-api')) {
            const prev = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => { prev?.(); onReady(); };
            return;
        }
        window.onYouTubeIframeAPIReady = onReady;
        const script = document.createElement('script');
        script.id  = 'vll-yt-api';
        script.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(script);
    }

    private startYtTick(): void {
        if (this.ytTimer !== null) window.clearInterval(this.ytTimer);
        this.ytTimer = window.setInterval(() => {
            if (!this.ytPlayer) return;
            this.onTimeUpdate(this.ytPlayer.getCurrentTime());
            this.playPauseBtn?.setText(this.ytPlayer.getPlayerState() === 1 ? '⏸' : '▶');
        }, 500);
    }

    // ─── Local video player ───────────────────────────────────────────────────

    /** url is already a resolved resource URL from vault.getResourcePath() */
    private initLocalVideo(container: HTMLElement, url: string): void {
        const video = container.createEl('video', {
            cls: 'vll-local-video',
            attr: { src: url, controls: 'true', playsinline: 'true', preload: 'metadata' },
        });
        video.addEventListener('timeupdate', () => this.onTimeUpdate(video.currentTime));
        video.addEventListener('play',  () => this.playPauseBtn?.setText('⏸'));
        video.addEventListener('pause', () => this.playPauseBtn?.setText('▶'));
        this.videoEl = video;
    }

    // ─── Playback helpers ─────────────────────────────────────────────────────

    private togglePlayback(): void {
        if (this.videoEl) {
            this.videoEl.paused ? this.videoEl.play() : this.videoEl.pause();
        } else if (this.ytPlayer) {
            this.ytPlayer.getPlayerState() === 1
                ? this.ytPlayer.pauseVideo()
                : this.ytPlayer.playVideo();
        }
    }

    private pauseVideo(): void {
        this.videoEl?.pause();
        this.ytPlayer?.pauseVideo();
    }

    private resumePlayback(): void {
        this.videoEl?.play();
        this.ytPlayer?.playVideo();
    }

    private rewind(secs: number): void {
        if (this.videoEl) {
            this.videoEl.currentTime = Math.max(0, this.videoEl.currentTime - secs);
        } else if (this.ytPlayer) {
            this.ytPlayer.seekTo(Math.max(0, this.ytPlayer.getCurrentTime() - secs), true);
        }
    }

    private setSpeed(s: PlaybackSpeed): void {
        this.speed = s;
        if (this.videoEl) this.videoEl.playbackRate = s;
        this.ytPlayer?.setPlaybackRate(s);
        this.speedBtns.forEach((btn, i) =>
            btn.toggleClass('is-active', ([0.8, 1.0, 1.25] as PlaybackSpeed[])[i] === s));
    }

    // ─── Dictation ────────────────────────────────────────────────────────────

    private submitDictation(
        blockIdx: number,
        original: string,
        inputEl:  HTMLInputElement,
        resultEl: HTMLElement,
    ): void {
        const attempt = inputEl.value.trim();
        this.dictationAttempts.set(blockIdx, attempt);
        this.renderDiff(original, attempt, resultEl);
    }

    private renderDiff(original: string, attempt: string, container: HTMLElement): void {
        container.empty();
        if (!attempt) return;

        const isCJK  = /[　-鿿가-힯一-鿿]/.test(original);
        const norm   = (s: string) => s.toLowerCase().trim();
        const split  = (s: string): string[] => isCJK
            ? Array.from(norm(s).replace(/\s+/g, ''))
            : norm(s).split(/\s+/).filter(Boolean);

        const origTokens = split(original);
        const tryTokens  = split(attempt);
        const ops        = diffTokens(origTokens, tryTokens);
        const sep        = isCJK ? '' : ' ';

        ops.forEach((op, k) => {
            if (k > 0 && !isCJK) container.appendText(sep);
            container.createEl('span', { text: op.text, cls: `vll-diff-${op.type}` });
        });
    }

    private destroyPlayer(): void {
        if (this.ytTimer !== null) { window.clearInterval(this.ytTimer); this.ytTimer = null; }
        try { this.ytPlayer?.destroy(); } catch { /* ignore */ }
        this.ytPlayer = null;
        if (this.videoEl) { this.videoEl.pause(); this.videoEl.src = ''; this.videoEl = null; }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private buildBlocks(entries: ShadowingEntry[]): SubtitleBlock[] {
        return entries.map((e, i) => ({
            index:     i,
            startSec:  SubtitleParser.timestampToSeconds(e.timestamp),
            endSec:    entries[i + 1]
                           ? SubtitleParser.timestampToSeconds(entries[i + 1]!.timestamp)
                           : Infinity,
            text:      e.text,
            timestamp: e.timestamp,
        }));
    }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function boldToStrong(s: string): string {
    return s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

// ─── Diff helpers ─────────────────────────────────────────────────────────────

type DiffOp = { type: 'ok' | 'miss' | 'wrong'; text: string };

function diffTokens(orig: string[], attempt: string[]): DiffOp[] {
    const m = orig.length, n = attempt.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i]![j] = orig[i - 1] === attempt[j - 1]
                ? dp[i - 1]![j - 1]! + 1
                : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);

    const ops: DiffOp[] = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && orig[i - 1] === attempt[j - 1]) {
            ops.unshift({ type: 'ok', text: orig[i - 1]! });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
            ops.unshift({ type: 'wrong', text: attempt[j - 1]! });
            j--;
        } else {
            ops.unshift({ type: 'miss', text: orig[i - 1]! });
            i--;
        }
    }
    return ops;
}
