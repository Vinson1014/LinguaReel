import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type { VLLSettings, EnvironmentStatus } from '../types';
import { YouTubeTranscript } from '../core/YouTubeTranscript';
import { YtDlpRunner } from '../core/YtDlpRunner';
import { WhisperRunner } from '../core/WhisperRunner';
import { SubtitleParser } from '../core/SubtitleParser';
import { NoteGenerator } from '../core/NoteGenerator';
import { t } from '../i18n';

/**
 * 影片匯入彈窗
 *
 * 搬移自 eme-video-importer，調整：
 * - 使用 VLLSettings（settings.shadowingOutputFolder 而非 outputFolder）
 * - 使用 i18n t() 翻譯
 */
export class ImportModal extends Modal {

    private inputEl!: HTMLInputElement;
    private statusEl!: HTMLElement;
    private progressEl!: HTMLElement;
    private importBtn!: HTMLButtonElement;
    private subtitleMethod: 'auto' | 'whisper' = 'auto';

    constructor(
        app: App,
        private settings: VLLSettings,
        private envStatus: EnvironmentStatus
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('vll-import-modal');

        contentEl.createEl('h2', { text: t('importModal.title') });

        // URL 輸入
        new Setting(contentEl)
            .setName(t('importModal.inputLabel'))
            .setDesc(t('importModal.inputDesc'))
            .addText(text => {
                this.inputEl = text.inputEl;
                text.setPlaceholder(t('importModal.inputPlaceholder'));
                text.inputEl.style.width = '100%';
                text.inputEl.addEventListener('keydown', e => {
                    if (e.key === 'Enter') this.startImport();
                });
            });

        // 字幕來源選擇
        this.renderSubtitleMethodSelector(contentEl);

        // 工具狀態
        this.renderToolStatus(contentEl);

        // 進度區
        this.progressEl = contentEl.createDiv({ cls: 'vll-import-progress' });
        this.progressEl.style.display = 'none';

        // 狀態訊息
        this.statusEl = contentEl.createDiv({ cls: 'vll-import-status' });

        // 按鈕列
        const btnRow = contentEl.createDiv({ cls: 'vll-import-buttons' });
        btnRow.style.cssText = 'display:flex; justify-content:flex-end; gap:8px; margin-top:16px;';

        btnRow.createEl('button', { text: t('importModal.cancelBtn') })
            .addEventListener('click', () => this.close());

        this.importBtn = btnRow.createEl('button', {
            text: t('importModal.importBtn'),
            cls:  'mod-cta',
        });
        this.importBtn.addEventListener('click', () => this.startImport());
    }

    onClose(): void {
        this.contentEl.empty();
    }

    // ===== 核心匯入流程 =====

    private async startImport(): Promise<void> {
        const input = this.inputEl.value.trim();
        if (!input) return;

        this.importBtn.disabled = true;
        this.progressEl.style.display = 'block';

        try {
            const isNetworkUrl = /^https?:\/\//i.test(input);
            const isYouTube    = YouTubeTranscript.extractVideoId(input) !== null;

            if (this.subtitleMethod === 'whisper' && isNetworkUrl) {
                await this.importNetworkWithWhisper(input);
            } else if (isYouTube) {
                await this.importYouTube(input);
            } else if (isNetworkUrl) {
                await this.importNetworkWithWhisper(input);
            } else {
                await this.importLocalVideo(input);
            }
        } catch (error: any) {
            this.showStatus(t('importModal.errPrefix') + error.message, 'error');
            this.importBtn.disabled = false;
        }
    }

    private async importYouTube(url: string): Promise<void> {
        // Tier 0
        try {
            this.showProgress('正在抓取字幕（Tier 0 - 零依賴模式）...');
            const { subtitles, video } = await YouTubeTranscript.fetch(
                url, this.settings.annotationLanguage
            );
            this.showProgress(`取得 ${subtitles.length} 條字幕，正在合併整理...`);
            const merged = SubtitleParser.mergeShortEntries(subtitles, this.settings.subtitleMergeGap);
            await this.saveNote(video, merged);
            return;
        } catch (e: any) {
            console.log(`[VLL] Tier 0 失敗：${e.message}`);
        }

        // Tier 1
        if (this.envStatus.ytdlp.available) {
            this.showProgress('Tier 0 無字幕，改用 yt-dlp 下載...');
            const ytdlp = new YtDlpRunner(this.settings.ytdlpPath);
            const [videoInfo, subtitlePath] = await Promise.all([
                ytdlp.getVideoInfo(url),
                ytdlp.downloadSubtitle(url, this.settings.annotationLanguage),
            ]);

            if (subtitlePath) {
                this.showProgress('解析字幕文件...');
                const subContent = fs.readFileSync(subtitlePath, 'utf-8');
                const subtitles  = SubtitleParser.parseTimedtextXml(subContent);
                const merged     = SubtitleParser.mergeShortEntries(subtitles, this.settings.subtitleMergeGap);
                YtDlpRunner.cleanupTempDir(path.dirname(subtitlePath));
                await this.saveNote(videoInfo, merged);
                return;
            }

            // Tier 2
            if (this.envStatus.whisper.available) {
                this.showProgress('此影片無字幕，準備使用 Whisper 轉錄...');
                await this.transcribeAndSave(ytdlp, url, videoInfo);
                return;
            }

            throw new Error('此影片無字幕，且未安裝 Whisper，無法轉錄。');
        }

        throw new Error('無法取得字幕：Tier 0 失敗，且未安裝 yt-dlp。');
    }

    private async importNetworkWithWhisper(url: string): Promise<void> {
        if (!this.envStatus.ytdlp.available) {
            throw new Error('下載網路影片需要 yt-dlp，請先安裝。');
        }
        if (!this.envStatus.whisper.available) {
            throw new Error('Whisper 轉錄需要安裝 faster-whisper 或 WhisperX。');
        }

        const ytdlp = new YtDlpRunner(this.settings.ytdlpPath);
        this.showProgress('正在取得影片資訊...');
        const videoInfo = await ytdlp.getVideoInfo(url);

        this.showProgress('準備使用 Whisper 轉錄...');
        await this.transcribeAndSave(ytdlp, url, videoInfo);
    }

    private async transcribeAndSave(ytdlp: YtDlpRunner, url: string, videoInfo: any): Promise<void> {
        const audioPath = await ytdlp.downloadAudio(url, msg => this.showProgress(msg));
        const whisper   = new WhisperRunner(
            this.settings.whisperPath,
            this.settings.whisperModel,
            this.settings.whisperDevice
        );
        const vttPath   = await whisper.transcribe(
            audioPath, undefined,
            this.settings.annotationLanguage,
            msg => this.showProgress(msg)
        );
        const subtitles = SubtitleParser.parseVTT(fs.readFileSync(vttPath, 'utf-8'));
        const merged    = SubtitleParser.mergeShortEntries(subtitles, this.settings.subtitleMergeGap);
        YtDlpRunner.cleanupTempDir(path.dirname(audioPath));
        YtDlpRunner.cleanupTempDir(path.dirname(vttPath));
        await this.saveNote(videoInfo, merged);
    }

    private async importLocalVideo(filePath: string): Promise<void> {
        if (!this.envStatus.whisper.available) {
            throw new Error('本地影片轉錄需要 Whisper（請安裝 faster-whisper）。');
        }
        if (!fs.existsSync(filePath)) {
            throw new Error(`找不到文件：${filePath}`);
        }

        const whisper  = new WhisperRunner(
            this.settings.whisperPath,
            this.settings.whisperModel,
            this.settings.whisperDevice
        );
        const vttPath  = await whisper.transcribe(
            filePath, undefined,
            this.settings.annotationLanguage,
            msg => this.showProgress(msg)
        );
        const subtitles = SubtitleParser.parseVTT(fs.readFileSync(vttPath, 'utf-8'));
        const merged    = SubtitleParser.mergeShortEntries(subtitles, this.settings.subtitleMergeGap);
        YtDlpRunner.cleanupTempDir(path.dirname(vttPath));
        const fileName  = path.basename(filePath, path.extname(filePath));
        const vaultBase = (this.app.vault.adapter as any).basePath as string;
        const relSource = path.relative(vaultBase, filePath).replace(/\\/g, '/');
        await this.saveNote({ title: fileName, source: relSource, type: 'local' }, merged);
    }

    private async saveNote(video: any, subtitles: any[]): Promise<void> {
        this.showProgress(`正在生成筆記（${subtitles.length} 條字幕）...`);

        const content  = NoteGenerator.generate(video, subtitles, this.settings);
        const fileName = NoteGenerator.generateFileName(video.title);
        const folder   = this.settings.shadowingOutputFolder;

        if (folder) {
            const exists = this.app.vault.getAbstractFileByPath(folder);
            if (!exists) await this.app.vault.createFolder(folder);
        }

        const filePath  = folder ? `${folder}/${fileName}` : fileName;
        const finalPath = await this.getUniquePath(filePath);
        const file      = await this.app.vault.create(finalPath, content);

        this.showStatus(t('importModal.success', { path: finalPath }), 'success');
        this.importBtn.disabled = false;

        setTimeout(() => {
            this.app.workspace.getLeaf('tab').openFile(file as TFile);
            this.close();
        }, 1000);
    }

    // ===== UI 輔助方法 =====

    private renderSubtitleMethodSelector(container: HTMLElement): void {
        const setting = new Setting(container)
            .setName(t('importModal.subtitleMethodLabel'));

        const radioGroup = setting.settingEl.createDiv({ cls: 'vll-method-radio-group' });
        radioGroup.style.cssText = 'display:flex; flex-direction:column; gap:6px; margin-top:4px;';

        for (const method of ['auto', 'whisper'] as const) {
            const label = radioGroup.createEl('label', { cls: 'vll-method-label' });
            label.style.cssText = 'display:flex; align-items:center; gap:8px; cursor:pointer;';

            const radio = label.createEl('input');
            radio.type    = 'radio';
            radio.name    = 'vll-subtitle-method';
            radio.value   = method;
            radio.checked = method === this.subtitleMethod;
            radio.addEventListener('change', () => { this.subtitleMethod = method; });

            label.appendText(t(`importModal.method${method === 'auto' ? 'Auto' : 'Whisper'}`));
        }
    }

    private renderToolStatus(container: HTMLElement): void {
        const div = container.createDiv({ cls: 'vll-tool-status' });
        div.createEl('div', { text: t('importModal.toolStatus'), cls: 'vll-tool-status-title' });

        div.createDiv().textContent = this.envStatus.ytdlp.available
            ? t('importModal.ytdlpOk',     { version: this.envStatus.ytdlp.version ?? '' })
            : t('importModal.ytdlpFail');

        div.createDiv().textContent = this.envStatus.whisper.available
            ? t('importModal.whisperOk',   { version: this.envStatus.whisper.version ?? '' })
            : t('importModal.whisperFail');

        div.createDiv({ cls: 'vll-tier-info' }).textContent =
            t('importModal.tierInfo', { tier: String(this.envStatus.maxTier) });
    }

    private showProgress(message: string): void {
        this.progressEl.style.display = 'block';
        this.progressEl.textContent   = `⏳ ${message}`;
    }

    private showStatus(message: string, type: 'success' | 'error' | 'info'): void {
        this.progressEl.style.display = 'none';
        this.statusEl.textContent     = message;
        this.statusEl.style.color =
            type === 'error'   ? 'var(--text-error)' :
            type === 'success' ? 'var(--color-green)' : 'var(--text-normal)';
        if (type === 'error') new Notice(message, 5000);
    }

    private async getUniquePath(filePath: string): Promise<string> {
        if (!this.app.vault.getAbstractFileByPath(filePath)) return filePath;
        const base      = filePath.replace(/\.md$/, '');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return `${base}_${timestamp}.md`;
    }
}
