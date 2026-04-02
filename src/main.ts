import { MarkdownView, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { initI18n, t } from './i18n';
import { DEFAULT_SETTINGS, VLLSettingTab } from './settings';
import { VLLDatabase } from './db/database';
import { VocabStorage } from './db/vocabStorage';
import { LLMClient } from './llm/client';
import { HomeView } from './views/HomeView';
import { DictView } from './views/DictView';
import { HighlightView } from './views/HighlightView';
import { FlashcardView } from './views/FlashcardView';
import { ShadowingView } from './views/ShadowingView';
import { ImportModal } from './ui/ImportModal';
import { AnnotateModal } from './ui/AnnotateModal';
import { YtDlpRunner } from './core/YtDlpRunner';
import { WhisperRunner } from './core/WhisperRunner';
import {
    VIEW_TYPE_HOME,
    VIEW_TYPE_DICT,
    VIEW_TYPE_HIGHLIGHT,
    VIEW_TYPE_FLASHCARD,
    VIEW_TYPE_SHADOWING,
} from './constants';
import type { VLLSettings, EnvironmentStatus } from './types';

export default class VLLPlugin extends Plugin {

    settings!: VLLSettings;

    /** 全域 IndexedDB 實例 */
    db!: VLLDatabase;

    /** 生詞本管理層 */
    vocabStorage!: VocabStorage;

    /** 統一 LLM 客戶端 */
    llm!: LLMClient;

    /** 外部工具狀態 */
    envStatus: EnvironmentStatus = {
        ytdlp:   { available: false },
        whisper: { available: false },
        maxTier: 0,
    };

    // ===================================================
    //  生命週期
    // ===================================================

    async onload(): Promise<void> {
        await this.loadSettings();

        // 初始化 i18n（必須在任何 t() 呼叫之前）
        initI18n(this.settings.uiLanguage);

        // 初始化資料庫（僅 highlights store）
        this.db = new VLLDatabase();
        await this.db.open();

        // 初始化生詞本（Markdown-first，不依賴 IndexedDB）
        this.vocabStorage = new VocabStorage(this.app, () => this.settings);

        // 初始化 LLM 客戶端
        this.llm = new LLMClient(() => this.settings);

        // 在背景偵測外部工具
        this.detectEnvironment();

        // 註冊 Views
        this.registerView(VIEW_TYPE_HOME,       leaf => new HomeView(leaf, this));
        this.registerView(VIEW_TYPE_DICT,       leaf => new DictView(leaf, this));
        this.registerView(VIEW_TYPE_HIGHLIGHT,  leaf => new HighlightView(leaf, this));
        this.registerView(VIEW_TYPE_FLASHCARD,  leaf => new FlashcardView(leaf, this));
        this.registerView(VIEW_TYPE_SHADOWING,  leaf => new ShadowingView(leaf, this));

        // Ribbon 圖示（單一入口）
        this.addRibbonIcon('layout-dashboard', t('home.viewTitle'), () => this.openView(VIEW_TYPE_HOME));

        // 指令
        this.addCommand({
            id:       'open-home',
            name:     t('home.viewTitle'),
            callback: () => this.openView(VIEW_TYPE_HOME),
        });
        this.addCommand({
            id:       'open-dict',
            name:     t('commands.openDict'),
            callback: () => this.openView(VIEW_TYPE_DICT),
        });
        this.addCommand({
            id:       'open-highlights',
            name:     t('commands.openHighlights'),
            callback: () => this.openView(VIEW_TYPE_HIGHLIGHT),
        });
        this.addCommand({
            id:       'open-flashcards',
            name:     t('commands.openFlashcards'),
            callback: () => this.openView(VIEW_TYPE_FLASHCARD),
        });
        this.addCommand({
            id:       'open-shadowing',
            name:     t('commands.openShadowing'),
            callback: () => this.openView(VIEW_TYPE_SHADOWING),
        });
        this.addCommand({
            id:       'import-video',
            name:     t('commands.importVideo'),
            callback: () => new ImportModal(this.app, this.settings, this.envStatus).open(),
        });
        this.addCommand({
            id:       'annotate-shadowing-note',
            name:     t('commands.annotateNote'),
            callback: () => {
                const file = this.app.workspace.getActiveFile();
                if (!file) return;
                new AnnotateModal(this.app, this, file).open();
            },
        });

        // 設定頁
        this.addSettingTab(new VLLSettingTab(this.app, this));

        // 全域事件：Ctrl+雙擊 觸發查詞
        this.registerDomEvent(document, 'dblclick', (evt: MouseEvent) => {
            if (!evt.ctrlKey && !evt.metaKey) return;
            const selection = window.getSelection()?.toString().trim();
            if (!selection) return;
            this.lookupWord(selection);
        });

        // 監聽活躍文件切換，更新 HighlightView + ShadowingView
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', leaf => {
                const view = leaf?.view;
                if (view instanceof MarkdownView && view.file) {
                    this.refreshHighlightView(view.file);
                    this.refreshShadowingView(view.file);
                }
            })
        );

        console.log('[VLL] 插件已載入');
    }

    async onunload(): Promise<void> {
        this.db.close();
        console.log('[VLL] 插件已卸載');
    }

    // ===================================================
    //  設定
    // ===================================================

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<VLLSettings>);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    // ===================================================
    //  私有方法
    // ===================================================

    /** 開啟或切換至指定 View（public，供 HomeView 呼叫） */
    async openView(viewType: string): Promise<void> {
        const { workspace } = this.app;
        const existing = workspace.getLeavesOfType(viewType);

        if (existing.length > 0) {
            workspace.revealLeaf(existing[0]!);
            return;
        }

        // ShadowingView 在主編輯區開新 tab；其他 View 在右側 sidebar
        let leaf: WorkspaceLeaf;
        if (viewType === VIEW_TYPE_SHADOWING) {
            // Capture active file BEFORE switching to the new tab (Issue 4)
            const fileToLoad = workspace.getActiveFile();
            // @ts-ignore — 'tab' PaneType available in Obsidian 0.16+
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: viewType, active: true });
            workspace.revealLeaf(leaf);
            if (fileToLoad) {
                const view = leaf.view as ShadowingView;
                await view.loadNote(fileToLoad);
            }
            return;
        } else {
            leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
        }
        await leaf.setViewState({ type: viewType, active: true });
        workspace.revealLeaf(leaf);
    }

    /** 開啟影片匯入 Modal（public，供 HomeView 呼叫） */
    openImportModal(): void {
        new ImportModal(this.app, this.settings, this.envStatus).open();
    }

    /** 觸發查詞（開啟 DictView 並查詢） */
    async lookupWord(word: string, context?: string): Promise<void> {
        await this.openView(VIEW_TYPE_DICT);
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DICT);
        if (leaves.length > 0) {
            const view = leaves[0]!.view as DictView;
            const ctx = context ?? window.getSelection()?.anchorNode?.textContent ?? undefined;
            await view.lookup(word, ctx);
        }
    }

    /** 通知 HighlightView 刷新 */
    private refreshHighlightView(file: TFile): void {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HIGHLIGHT);
        for (const leaf of leaves) {
            (leaf.view as unknown as HighlightView).refresh(file);
        }
    }

    /** 通知 ShadowingView 載入新筆記 */
    private refreshShadowingView(file: TFile): void {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SHADOWING);
        for (const leaf of leaves) {
            (leaf.view as unknown as ShadowingView).loadNote(file);
        }
    }

    /** 在背景偵測外部工具（yt-dlp / Whisper） */
    private async detectEnvironment(): Promise<void> {
        const ytdlp   = new YtDlpRunner(this.settings.ytdlpPath);
        const whisper = new WhisperRunner(
            this.settings.whisperPath,
            this.settings.whisperModel,
            this.settings.whisperDevice
        );

        const [ytdlpStatus, whisperStatus] = await Promise.all([
            ytdlp.detectInstallation(),
            whisper.detectInstallation(),
        ]);

        this.envStatus.ytdlp   = ytdlpStatus;
        this.envStatus.whisper = whisperStatus;
        this.envStatus.maxTier = whisperStatus.available ? 2
                               : ytdlpStatus.available   ? 1
                               : 0;

        console.log(
            `[VLL] 環境偵測完成 - ` +
            `yt-dlp: ${ytdlpStatus.available ? ytdlpStatus.version : '未安裝'}, ` +
            `Whisper: ${whisperStatus.available ? (whisperStatus.version ?? '已安裝') : '未安裝'}, ` +
            `最高 Tier: ${this.envStatus.maxTier}`
        );
    }
}
