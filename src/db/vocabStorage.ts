import { App, TFile, normalizePath } from 'obsidian';
import type { VocabEntry, VLLSettings } from '../types';

/**
 * 生詞本管理層（Markdown-first）
 *
 * 每個生詞 = vault 中一個獨立的 .md 檔
 * FSRS 排程資料存在 YAML frontmatter，透過 Obsidian Sync 同步
 * IndexedDB 不再用於字彙/閃卡
 */
export class VocabStorage {

    constructor(
        private app:         App,
        private getSettings: () => Pick<VLLSettings, 'vocabFolder'>,
    ) {}

    // ─── 路徑工具 ─────────────────────────────────────────────────────────────

    private get folder(): string {
        return this.getSettings().vocabFolder || 'Vocabulary';
    }

    /** 把單字轉成安全的檔名（移除 Windows/macOS 不允許的字元） */
    private safeFilename(word: string): string {
        return word.replace(/[\\/:*?"<>|#^[\]]/g, '_').trim();
    }

    filePath(word: string): string {
        return normalizePath(`${this.folder}/${this.safeFilename(word)}.md`);
    }

    // ─── 查詢 ─────────────────────────────────────────────────────────────────

    async getByWord(word: string): Promise<VocabEntry | undefined> {
        const file = this.app.vault.getAbstractFileByPath(this.filePath(word));
        if (!(file instanceof TFile)) return undefined;
        return this.readFile(file);
    }

    async isInVocab(word: string): Promise<boolean> {
        return !!this.app.vault.getAbstractFileByPath(this.filePath(word));
    }

    async getAll(): Promise<VocabEntry[]> {
        const folderPath = normalizePath(this.folder);
        const files = this.app.vault.getMarkdownFiles()
            .filter(f => f.parent?.path === folderPath || f.path.startsWith(folderPath + '/'));
        const entries = await Promise.all(files.map(f => this.readFile(f)));
        return entries.filter((e): e is VocabEntry => e !== undefined);
    }

    /** 回傳今天及以前到期的卡片（state >= 1 表示曾經複習過，新卡 state=0 也納入） */
    async getDueCards(): Promise<VocabEntry[]> {
        const all  = await this.getAll();
        const now  = Date.now();
        return all.filter(e => e.due <= now);
    }

    async getStats(): Promise<{ due: number; new: number; learning: number; review: number }> {
        const all = await this.getAll();
        const now = Date.now();
        return {
            due:      all.filter(e => e.due <= now).length,
            new:      all.filter(e => e.state === 0).length,
            learning: all.filter(e => e.state === 1 || e.state === 3).length,
            review:   all.filter(e => e.state === 2).length,
        };
    }

    // ─── 新增 / 更新 ──────────────────────────────────────────────────────────

    async add(entry: VocabEntry): Promise<void> {
        await this.ensureFolder();
        const path     = this.filePath(entry.word);
        const content  = this.buildMarkdown(entry);
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
            await this.app.vault.modify(existing, content);
        } else {
            await this.app.vault.create(path, content);
        }
    }

    /** FSRS 複習後更新排程欄位（不重寫整個檔案，只改 frontmatter） */
    async updateSchedule(word: string, update: {
        due:        number;
        stability:  number;
        difficulty: number;
        reps:       number;
        lapses:     number;
        state:      number;
        lastReview: number;
    }): Promise<void> {
        const path = this.filePath(word);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return;

        await this.app.fileManager.processFrontMatter(file, (fm) => {
            fm.due         = msToDateStr(update.due);
            fm.stability   = round4(update.stability);
            fm.difficulty  = round4(update.difficulty);
            fm.reps        = update.reps;
            fm.lapses      = update.lapses;
            fm.state       = update.state;
            fm.last_review = msToDateStr(update.lastReview);
        });
    }

    async remove(word: string): Promise<void> {
        const path = this.filePath(word);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) await this.app.vault.delete(file);
    }

    // ─── 讀取 .md 檔 ──────────────────────────────────────────────────────────

    private async readFile(file: TFile): Promise<VocabEntry | undefined> {
        // 優先用 metadataCache（in-memory，快）；新建檔可能 cache 尚未更新則 fallback 讀檔
        const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const fm     = cached ?? await this.readFrontmatterDirect(file);
        if (!fm?.word) return undefined;

        return {
            word:        fm.word,
            reading:     fm.reading,
            pos:         fm.pos,
            definitions: Array.isArray(fm.definitions) ? fm.definitions : (fm.definitions ? [fm.definitions] : []),
            example:            fm.example,
            exampleTranslation: fm.example_translation,
            sourceFile:         fm.source,
            timestamp:   fm.timestamp,
            context:     fm.context,
            tags:        Array.isArray(fm.tags) ? fm.tags : [],
            createdAt:   fm.created_at ? new Date(fm.created_at).getTime() : 0,
            due:         fm.due       ? new Date(fm.due).getTime()         : Date.now(),
            stability:   fm.stability  ?? 0,
            difficulty:  fm.difficulty ?? 0,
            reps:        fm.reps       ?? 0,
            lapses:      fm.lapses     ?? 0,
            state:       fm.state      ?? 0,
            lastReview:  fm.last_review ? new Date(fm.last_review).getTime() : undefined,
            filePath:    file.path,
        };
    }

    /** 直接讀檔解析 frontmatter（metadataCache 尚未更新時的 fallback） */
    private async readFrontmatterDirect(file: TFile): Promise<Record<string, unknown> | undefined> {
        try {
            const content = await this.app.vault.read(file);
            const m = content.match(/^---\n([\s\S]*?)\n---/);
            if (!m) return undefined;
            // 簡單 YAML key: value 解析（不依賴外部套件）
            const fm: Record<string, unknown> = {};
            for (const line of m[1]!.split('\n')) {
                const idx = line.indexOf(':');
                if (idx < 0) continue;
                const key = line.slice(0, idx).trim();
                const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
                fm[key] = val;
            }
            return fm;
        } catch {
            return undefined;
        }
    }

    // ─── 建立 Markdown 內容 ───────────────────────────────────────────────────

    private buildMarkdown(e: VocabEntry): string {
        const now       = Date.now();
        const due       = e.due       ? msToDateStr(e.due)       : msToDateStr(now);
        const created   = e.createdAt ? msToDateStr(e.createdAt) : msToDateStr(now);
        const lastRev   = e.lastReview ? msToDateStr(e.lastReview) : '';
        const defsYaml  = e.definitions.map(d => `  - "${d.replace(/"/g, "'")}"`).join('\n');
        const sourceVal = e.sourceFile ? `"${e.sourceFile}"` : '';
        const exampleQ    = e.example            ? `"${e.example.replace(/"/g, "'")}"` : '';
        const exTransQ    = e.exampleTranslation ? `"${e.exampleTranslation.replace(/"/g, "'")}"` : '';
        const contextQ    = e.context
            ? `"${e.context.replace(/\n|\r/g, ' ').replace(/"/g, "'").slice(0, 300)}"`
            : '';

        const frontmatter = [
            '---',
            `word: ${e.word}`,
            e.reading   ? `reading: ${e.reading}`   : '',
            e.pos       ? `pos: ${e.pos}`           : '',
            `definitions:`,
            defsYaml || '  []',
            exampleQ    ? `example: ${exampleQ}`        : '',
            exTransQ    ? `example_translation: ${exTransQ}` : '',
            contextQ    ? `context: ${contextQ}`    : '',
            sourceVal   ? `source: ${sourceVal}`    : '',
            e.timestamp ? `timestamp: "${e.timestamp}"` : '',
            `tags: [${(e.tags ?? []).join(', ')}]`,
            `created_at: ${created}`,
            `due: ${due}`,
            `stability: ${round4(e.stability ?? 0)}`,
            `difficulty: ${round4(e.difficulty ?? 0)}`,
            `reps: ${e.reps ?? 0}`,
            `lapses: ${e.lapses ?? 0}`,
            `state: ${e.state ?? 0}`,
            lastRev ? `last_review: ${lastRev}` : `last_review: null`,
            '---',
        ].filter(l => l !== '').join('\n');

        const body = [
            '',
            `# ${e.word}`,
            '',
            e.reading ? `*${e.reading}*${e.pos ? `｜${e.pos}` : ''}` : (e.pos || ''),
            '',
            e.definitions.length > 0
                ? `**意思**：${e.definitions.join('；')}`
                : '',
            '',
            e.example ? `**例句**：${e.example}` : '',
            e.example ? '' : '',
            e.context ? `**上下文**：*${e.context.replace(/\n|\r/g, ' ').slice(0, 300)}*` : '',
            e.context ? '' : '',
            e.sourceFile
                ? `**來源**：${e.sourceFile}${e.timestamp ? ` \`${e.timestamp}\`` : ''}`
                : '',
        ].filter(l => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n');

        return frontmatter + '\n' + body;
    }

    // ─── 工具 ─────────────────────────────────────────────────────────────────

    private async ensureFolder(): Promise<void> {
        const path = normalizePath(this.folder);
        if (!this.app.vault.getAbstractFileByPath(path)) {
            await this.app.vault.createFolder(path).catch(() => {});
        }
    }
}

// ── 輔助函數 ──────────────────────────────────────────────────────────────────

function msToDateStr(ms: number): string {
    return new Date(ms).toISOString().split('T')[0]!;
}

function round4(n: number): number {
    return Math.round(n * 10000) / 10000;
}
