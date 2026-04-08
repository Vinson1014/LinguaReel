import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf, normalizePath } from 'obsidian';
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
import { YtDlpRunner } from './core/YtDlpRunner';
import { WhisperRunner } from './core/WhisperRunner';
import { SubtitleParser } from './core/SubtitleParser';
import { AnnotationPipeline } from './core/AnnotationPipeline';
import { NoteGenerator } from './core/NoteGenerator';
import { getAnnotationSystemPrompt, getSubtitleSummaryMessages, type SubtitleSummary } from './llm/prompts';
import {
    VIEW_TYPE_HOME,
    VIEW_TYPE_DICT,
    VIEW_TYPE_HIGHLIGHT,
    VIEW_TYPE_FLASHCARD,
    VIEW_TYPE_SHADOWING,
    EVENT_ANNOTATION_JOB,
    LANGUAGE_PACK_FOLDER,
} from './constants';
import type { AnnotationJob, VLLSettings, EnvironmentStatus } from './types';

export default class VLLPlugin extends Plugin {

    settings!: VLLSettings;

    /** 全域 IndexedDB 實例 */
    db!: VLLDatabase;

    /** 生詞本管理層 */
    vocabStorage!: VocabStorage;

    /** 統一 LLM 客戶端 */
    llm!: LLMClient;

    /** 背景標注任務清單（最新在前，HomeView 訂閱更新） */
    annotationJobs: AnnotationJob[] = [];

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
        this.addRibbonIcon('clapperboard', t('home.viewTitle'), () => this.openView(VIEW_TYPE_HOME));

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
            callback: () => this.openAnnotateModal(),
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

        // 確保語言包資料夾和預設 .md 檔存在（不阻擋 onload，背景執行）
        void this.ensureLanguagePacksExist();

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
    //  語言包管理
    // ===================================================

    /**
     * 在 vault 內建立語言包資料夾和預設 .md 檔（首次載入或檔案遺失時執行）。
     * 每個支援語言都會建立對應的 {code}.md；使用者可直接在 vault 內編輯。
     */
    private async ensureLanguagePacksExist(): Promise<void> {
        const folder = LANGUAGE_PACK_FOLDER;
        if (!this.app.vault.getAbstractFileByPath(folder)) {
            await this.app.vault.createFolder(folder);
        }
        for (const [code, content] of Object.entries(DEFAULT_LANGUAGE_PACKS)) {
            const filePath = `${folder}/${code}.md`;
            if (!this.app.vault.getAbstractFileByPath(filePath)) {
                await this.app.vault.create(filePath, content);
            }
        }
    }

    /**
     * 從 vault 讀取指定語言的語言包 body（frontmatter 已剝除）。
     * 若檔案不存在則回傳 undefined，由 getAnnotationSystemPrompt 使用內建 fallback。
     */
    private async loadLanguagePackBody(lang: string): Promise<string | undefined> {
        const filePath = `${LANGUAGE_PACK_FOLDER}/${lang}.md`;
        const file     = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return undefined;
        const content = await this.app.vault.read(file);
        // 剝除 YAML frontmatter（--- ... ---），回傳純 body
        const match = content.match(/^---\n[\s\S]*?\n---\n*([\s\S]*)$/);
        const body  = match ? (match[1] ?? content) : content;
        return body.trim() || undefined;
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

    /** 啟動背景標注任務（public，供 HomeView 按鈕 / 指令面板呼叫） */
    openAnnotateModal(): void {
        const file = this.app.workspace.getActiveFile();
        if (!file) { new Notice(t('home.noActiveFile')); return; }
        if (!this.llm.isConfigured()) { new Notice(t('highlight.llmNotConfigured')); return; }
        void this._runAnnotationJob(file);
        void this.openView(VIEW_TYPE_HOME);  // 切換到 HomeView 讓用戶看到進度
    }

    private async _runAnnotationJob(file: TFile): Promise<void> {
        const abort = new AbortController();
        const job: AnnotationJob = {
            id:       `job-${Date.now()}`,
            fileName: file.basename,
            filePath: file.path,
            status:   'running',
            done:     0,
            total:    0,
            abort:    () => abort.abort(),
        };

        this.annotationJobs.unshift(job);
        this._emitJobUpdate();

        try {
            const noteContent = await this.app.vault.read(file);
            const entries     = SubtitleParser.parseShadowingNote(noteContent);

            if (entries.length === 0) {
                job.status = 'failed';
                job.error  = t('shadowing.noSubtitles');
                this._emitJobUpdate();
                return;
            }

            job.total = entries.length;
            this._emitJobUpdate();

            // 從 vault 載入語言包 body（使用者可自訂教學風格）
            const packBody = await this.loadLanguagePackBody(this.settings.annotationLanguage);
            let systemPrompt = getAnnotationSystemPrompt(
                this.settings.annotationLanguage,
                this.settings.annotationSystemPrompt,
                this.settings.outputLanguage,
                this.settings.uiLanguage,
                packBody,
            );

            // 在正式標注前先取得字幕摘要：優先讀 frontmatter 快取，避免重複 API 呼叫
            let contentSummary: SubtitleSummary | null = null;
            const cachedSummary = this.app.metadataCache
                .getFileCache(file)?.frontmatter?.['ai_summary'] as string | undefined;

            if (cachedSummary) {
                // 快取命中：直接用，不重複呼叫 API
                contentSummary = { topic: '', tone: '', summary: cachedSummary };
            } else {
                try {
                    const summaryMsgs = getSubtitleSummaryMessages(
                        entries.map(e => e.text),
                        this.settings.outputLanguage,
                        this.settings.uiLanguage,
                    );
                    contentSummary = await this.llm.chatJSON<SubtitleSummary>(summaryMsgs, 'fast');
                    // 存入原始筆記 frontmatter，下次標注或查詞可直接讀取
                    if (contentSummary) {
                        await this.app.fileManager.processFrontMatter(file, fm => {
                            fm['ai_summary'] = contentSummary!.summary;
                        });
                    }
                } catch { /* 靜默失敗 */ }
            }

            // 將摘要注入 system prompt（LLM 知道脈絡後標注品質更好）
            if (contentSummary) {
                systemPrompt +=
                    `\n\n## Content context\n` +
                    `Topic: ${contentSummary.topic}\n` +
                    (contentSummary.characters ? `Characters: ${contentSummary.characters}\n` : '') +
                    `Tone: ${contentSummary.tone}\n` +
                    (contentSummary.setting ? `Setting: ${contentSummary.setting}\n` : '') +
                    `Summary: ${contentSummary.summary}`;
            }

            // Throttle streaming UI updates — 最多每 150ms 觸發一次 DOM 更新
            let pendingEmit = false;
            const scheduleEmit = () => {
                if (pendingEmit) return;
                pendingEmit = true;
                window.setTimeout(() => { pendingEmit = false; this._emitJobUpdate(); }, 150);
            };

            const pipeline = new AnnotationPipeline(this.llm);
            const result   = await pipeline.run(entries, {
                systemPrompt,
                signal:    abort.signal,
                batchSize: this.settings.annotationBatchSize,
                onProgress: (done, total) => {
                    job.done  = done;
                    job.total = total;
                    this._emitJobUpdate();
                },
                onToken: (subtitle, accumulated) => {
                    job.currentSubtitle = subtitle;
                    job.currentOutput   = accumulated;
                    scheduleEmit();
                },
            });

            const header        = SubtitleParser.extractNoteHeader(noteContent);
            const annotatedPath = normalizePath(NoteGenerator.annotatedNotePath(file.path));
            const existing      = this.app.vault.getAbstractFileByPath(annotatedPath);
            let annotatedFile: TFile;
            if (existing instanceof TFile) {
                await this.app.vault.modify(existing, result.toMarkdown(header));
                annotatedFile = existing;
            } else {
                annotatedFile = await this.app.vault.create(annotatedPath, result.toMarkdown(header));
            }

            // 用 processFrontMatter 寫入 ai_summary，避免手動 regex 造成重複欄位
            if (contentSummary) {
                await this.app.fileManager.processFrontMatter(annotatedFile, fm => {
                    fm['ai_summary'] = contentSummary!.summary;
                });
            }

            job.status     = 'done';
            job.resultPath = annotatedPath;

        } catch (e) {
            job.status = abort.signal.aborted ? 'cancelled' : 'failed';
            if (!abort.signal.aborted) {
                job.error = e instanceof Error ? e.message : String(e);
            }
        }

        this._emitJobUpdate();
    }

    private _emitJobUpdate(): void {
        // @ts-ignore — custom workspace event，HomeView 以 registerEvent 訂閱
        this.app.workspace.trigger(EVENT_ANNOTATION_JOB);
    }

    /** 觸發查詞（開啟 DictView 並查詢） */
    async lookupWord(
        word:       string,
        context?:   string,
        sourceFile?: string,
        timestamp?:  string,
    ): Promise<void> {
        await this.openView(VIEW_TYPE_DICT);
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DICT);
        if (leaves.length > 0) {
            const view = leaves[0]!.view as DictView;
            const ctx = context ?? window.getSelection()?.anchorNode?.textContent ?? undefined;
            await view.lookup(word, ctx, sourceFile, timestamp);
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

// ─── 預設語言包內容（首次載入時寫入 vault） ───────────────────────────────────
//
// frontmatter 僅供人閱讀，插件只讀取 body（--- 以下的部分）。
// 使用者可自由修改 body，不會影響 JSON 解析穩定性。

const DEFAULT_LANGUAGE_PACKS: Record<string, string> = {

    ja: `---
language: Japanese
code: ja
---

## Japanese-specific teaching guidelines

**Translation style**
- Match the character's tone — casual speech stays casual, formal stays formal
- Natural output > literal accuracy; avoid over-translation
- Condense repeated filler words (あの、えっと) but keep grammatically meaningful ones
- Preserve speaker personality (energetic, shy, formal, etc.)

**Annotation priority** (in order)
1. High-frequency idioms and mimetics/onomatopoeia (めっちゃ, どんどん, ワクワク)
2. Verb conjugation forms and contractions (〜てる, 〜ちゃう, 〜とく, 〜なきゃ)
3. Particles and sentence-final particles with special nuance

**Skip these** — too common to annotate
- Basic vocabulary (学校、天気、映画 and other everyday JLPT N5/N4 words)
- Standard particle usage (は、を、が with no special nuance)

**Always annotate** keigo (polite/honorific speech) — explain the politeness level and nuance specifically.

**Explanation style**
- One or two sentences maximum
- Explain the specific use in this sentence, then show how it transfers to other contexts
- Write naturally — avoid academic grammar terminology
`,

    ko: `---
language: Korean
code: ko
---

## Korean-specific teaching guidelines

**Translation style**
- Preserve speech level — formal (합쇼체) and informal (해요체) should stay distinct
- Natural output > literal accuracy
- Keep emotionally nuanced sentence endings intact

**Annotation priority** (in order)
1. Sentence-final endings that convey nuance (~잖아요, ~거든요, ~는데, ~네요)
2. Verb/adjective conjugation patterns (~아/어서, ~(으)ㄴ데, ~고 싶다)
3. Honorific and humble verb forms (드리다, 여쭤보다, 드시다)

**Skip these** — too basic to annotate
- Simple conjunctions (그리고, 하지만) unless used in a noteworthy way
- Common everyday vocabulary at beginner level

**Explanation style**
- One or two sentences maximum
- Connect the pattern to real-life situations the learner would encounter
`,

    zh: `---
language: Chinese
code: zh
---

## Chinese-specific teaching guidelines

**Translation style**
- Preserve tone and register — colloquial stays colloquial, formal stays formal
- Keep chengyu and set phrases intact; explain them in annotations
- Natural output — avoid word-for-word translation

**Annotation priority** (in order)
1. 成語 and common set phrases (慣用語)
2. Aspect markers and particles (了、著、過、的／地／得)
3. Grammar patterns (是…的, 把字句, 被字句)
4. Measure words in tricky or non-obvious pairings

**Skip these** — too common to annotate
- Basic measure words (一個、一本、一張) in standard usage
- Simple conjunctions (和、但是) unless in idiomatic context

**Explanation style**
- One or two sentences maximum
- Include zhuyin or pinyin for any annotated vocabulary
`,

    en: `---
language: English
code: en
---

## English-specific teaching guidelines

**Translation style**
- Preserve register — formal, informal, and slang should stay distinct
- Translate idioms and phrasal verbs by meaning, not literally
- Keep cultural references; explain them in annotations when non-obvious

**Annotation priority** (in order)
1. Idioms and phrasal verbs (give up, run into, bite the bullet)
2. Colloquial reductions and contractions (gonna, wanna, kinda, y'all)
3. Modal verbs with nuanced meaning (might, should, could in context)

**Skip these** — too basic to annotate
- Simple vocabulary that intermediate learners already know
- Regular verb conjugations with no special nuance

**Explanation style**
- One or two sentences maximum
- Give a real-world context or an equivalent native phrasing
`,

    fr: `---
language: French
code: fr
---

## French-specific teaching guidelines

**Translation style**
- Preserve register — formal (vous) vs informal (tu) should stay distinct
- Translate idioms and expressions by meaning, not word-for-word
- Keep colloquial contractions natural in casual speech

**Annotation priority** (in order)
1. Subjunctive usage (que je sois, il faut que, bien que...)
2. Idiomatic expressions and false cognates with English
3. Register differences (tu/vous, passé composé vs imparfait nuance)

**Skip these** — too basic
- Basic conjugations of avoir/être in simple tenses
- Simple prepositions (à, de, en) without special nuance

**Explanation style**
- One or two sentences maximum
- Highlight why French uses this form vs an alternative the learner might expect
`,

    de: `---
language: German
code: de
---

## German-specific teaching guidelines

**Translation style**
- Preserve formal (Sie) vs informal (du) register distinctions
- German word order doesn't map 1:1 — translate for natural output
- Keep compound words visible; explain noteworthy ones in annotations

**Annotation priority** (in order)
1. Separable verbs in use (anfangen, aufhören — note the separated prefix)
2. Case usage in context (especially Dativ vs Akkusativ distinctions)
3. Modal particles with nuance (doch, mal, ja, eigentlich, halt)

**Skip these** — too basic
- Regular noun cases in standard prepositional phrases already drilled
- Basic auxiliary (haben/sein) in simple sentences

**Explanation style**
- One or two sentences maximum
- Explain the grammatical trigger when relevant (e.g. "Dativ because of mit")
`,

    es: `---
language: Spanish
code: es
---

## Spanish-specific teaching guidelines

**Translation style**
- Preserve formal (usted) vs informal (tú/vos) register
- Note regional differences if apparent (vosotros vs ustedes)
- Natural output — avoid calque translations from English

**Annotation priority** (in order)
1. Subjunctive usage (que + subjunctive, hypothetical si clauses)
2. Ser vs estar in non-obvious or commonly confused cases
3. Reflexive verbs with changed meaning (ir vs irse, dormir vs dormirse)
4. Idiomatic expressions unique to Spanish

**Skip these** — too basic
- Regular -ar/-er/-ir conjugations in simple tenses
- Common connectors (y, pero, porque) in straightforward usage

**Explanation style**
- One or two sentences maximum
- Compare with a common learner mistake or an English false cognate if relevant
`,
};
