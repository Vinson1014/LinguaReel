import type { SubtitleEntry } from '../types';

/**
 * 解析各種字幕格式，統一輸出 SubtitleEntry[]
 * 支援：VTT、SRT、YouTube JSON3（去重）、YouTube timedtext XML（srv1）
 */
export class SubtitleParser {

    /** 自動偵測格式並解析 */
    static parse(content: string): SubtitleEntry[] {
        const trimmed = content.trim();
        if (trimmed.startsWith('WEBVTT'))                              return this.parseVTT(trimmed);
        if (trimmed.startsWith('<'))                                   return this.parseTimedtextXml(trimmed);
        if (trimmed.startsWith('{') || trimmed.startsWith('['))       return this.parseJSON3Dedup(trimmed);
        if (/^\d+\s*\n/.test(trimmed))                                return this.parseSRT(trimmed);
        throw new Error('無法識別的字幕格式，支援：VTT、SRT、YouTube JSON3、timedtext XML');
    }

    /** 解析 WebVTT 格式 */
    static parseVTT(content: string): SubtitleEntry[] {
        const entries: SubtitleEntry[] = [];
        const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const body   = normalized.replace(/^WEBVTT.*\n/m, '').replace(/NOTE[\s\S]*?\n\n/g, '');
        const blocks = body.split(/\n\n+/);

        for (const block of blocks) {
            const lines = block.trim().split('\n');
            if (lines.length < 2) continue;

            const timeLineIndex = lines.findIndex(line => line.includes('-->'));
            if (timeLineIndex === -1) continue;

            const timeLine = lines[timeLineIndex];
            if (!timeLine) continue;

            const parts = timeLine.split('-->');
            const startStr = parts[0]?.trim();
            const endStr   = parts[1]?.split(' ')[0]?.trim();  // 忽略 cue settings
            if (!startStr || !endStr) continue;

            const start = this.vttTimeToSeconds(startStr);
            const end   = this.vttTimeToSeconds(endStr);
            const text  = lines.slice(timeLineIndex + 1)
                .join(' ')
                .replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g,  '<')
                .replace(/&gt;/g,  '>')
                .trim();

            if (text) entries.push({ start, end, text });
        }

        return entries;
    }

    /** 解析 SRT 格式 */
    static parseSRT(content: string): SubtitleEntry[] {
        const entries: SubtitleEntry[] = [];
        const blocks = content.split(/\n\n+/);

        for (const block of blocks) {
            const lines = block.trim().split('\n');
            if (lines.length < 3) continue;

            const timeLineIndex = lines.findIndex(line => line.includes('-->'));
            if (timeLineIndex === -1) continue;

            const timeLine = lines[timeLineIndex];
            if (!timeLine) continue;

            const parts = timeLine.split('-->');
            const startStr = parts[0]?.trim();
            const endStr   = parts[1]?.trim();
            if (!startStr || !endStr) continue;

            const start = this.srtTimeToSeconds(startStr);
            const end   = this.srtTimeToSeconds(endStr);
            const text  = lines.slice(timeLineIndex + 1)
                .join(' ')
                .replace(/<[^>]+>/g, '')
                .trim();

            if (text) entries.push({ start, end, text });
        }

        return entries;
    }

    /**
     * 解析 YouTube timedtext XML（srv1 格式）
     * 一句一條，沒有滾動視窗重複問題
     */
    static parseTimedtextXml(content: string): SubtitleEntry[] {
        const entries: SubtitleEntry[] = [];
        const blockRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
        let match: RegExpExecArray | null;

        while ((match = blockRegex.exec(content)) !== null) {
            const attrs = match[1] ?? '';
            const raw   = match[2] ?? '';

            const startMatch = attrs.match(/\bstart="([\d.]+)"/);
            const durMatch   = attrs.match(/\bdur="([\d.]+)"/);
            if (!startMatch?.[1] || !durMatch?.[1]) continue;

            const start = parseFloat(startMatch[1]);
            const dur   = parseFloat(durMatch[1]);
            const text  = raw
                .replace(/&amp;/g,  '&')
                .replace(/&lt;/g,   '<')
                .replace(/&gt;/g,   '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g,  "'")
                .replace(/\n/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            if (text) entries.push({ start, end: start + dur, text });
        }

        return entries;
    }

    /**
     * 解析 YouTube JSON3 格式（正確去除滾動視窗重疊）
     */
    static parseJSON3Dedup(content: string): SubtitleEntry[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any;
        try {
            data = JSON.parse(content);
        } catch {
            throw new Error('JSON3 格式解析失敗');
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const events: any[] = data.events ?? [];
        const snippets: SubtitleEntry[] = [];
        let prevGroupAccumulated    = '';
        let currentGroupAccumulated = '';

        for (const event of events) {
            if (!event.segs) continue;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rawText = (event.segs as any[])
                .map((seg) => (seg.utf8 as string) ?? '')
                .join('')
                .replace(/\n/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            if (!rawText) continue;

            const start = (event.tStartMs as number ?? 0) / 1000;
            const end   = start + (event.dDurationMs as number ?? 2000) / 1000;

            let text: string;
            if (event.aAppend === 1) {
                text = rawText;
                currentGroupAccumulated = (currentGroupAccumulated + ' ' + rawText).trim();
            } else {
                text = this.stripLeadingOverlap(prevGroupAccumulated, rawText);
                prevGroupAccumulated    = currentGroupAccumulated;
                currentGroupAccumulated = rawText;
            }

            text = text.trim();
            if (text) snippets.push({ start, end, text });
        }

        return this.mergeSnippetsIntoSentences(snippets, 12);
    }

    /** 把細碎的 snippet 合併成自然長度的字幕條目 */
    private static mergeSnippetsIntoSentences(
        snippets: SubtitleEntry[],
        maxDuration: number
    ): SubtitleEntry[] {
        if (snippets.length === 0) return [];

        const entries: SubtitleEntry[] = [];
        let current: SubtitleEntry = { ...snippets[0] as SubtitleEntry };

        for (let i = 1; i < snippets.length; i++) {
            const next     = snippets[i] as SubtitleEntry;
            const duration = current.end - current.start;
            const endsWithSentence = /[.!?]["']?\s*$/.test(current.text);

            if (endsWithSentence || duration >= maxDuration) {
                entries.push(current);
                current = { ...next };
            } else {
                current.end  = next.end;
                current.text = (current.text + ' ' + next.text).replace(/\s+/g, ' ').trim();
            }
        }

        entries.push(current);
        return entries;
    }

    /** 去除 text 開頭與 prev 結尾重疊的部分 */
    private static stripLeadingOverlap(prev: string, text: string): string {
        if (!prev || !text) return text;

        const prevWords = prev.split(/\s+/);
        const textWords = text.split(/\s+/);
        const maxCheck  = Math.min(prevWords.length, textWords.length, 20);

        for (let len = maxCheck; len >= 2; len--) {
            const prevSuffix = prevWords.slice(-len).join(' ').toLowerCase();
            const textPrefix = textWords.slice(0, len).join(' ').toLowerCase();
            if (prevSuffix === textPrefix) {
                return textWords.slice(len).join(' ');
            }
        }

        return text;
    }

    /**
     * 智慧合併短句（用於 timedtext XML 解析後的後處理）
     */
    static mergeShortEntries(entries: SubtitleEntry[], mergeGap = 1.5): SubtitleEntry[] {
        if (entries.length === 0) return [];

        const merged: SubtitleEntry[] = [];
        let current: SubtitleEntry = { ...entries[0] as SubtitleEntry };

        for (let i = 1; i < entries.length; i++) {
            const next = entries[i] as SubtitleEntry;
            const gap  = next.start - current.end;
            const endsWithPunctuation = /[.!?。！？](\s*)$/.test(current.text);
            const currentIsShort      = current.text.length < 40;
            const nextIsShort         = next.text.length < 40;

            const shouldMerge =
                gap < mergeGap &&
                !endsWithPunctuation &&
                (currentIsShort || nextIsShort);

            if (shouldMerge) {
                current.end  = next.end;
                current.text = current.text.trimEnd() + ' ' + next.text.trimStart();
            } else {
                merged.push(current);
                current = { ...next };
            }
        }

        merged.push(current);
        return merged;
    }

    // ===== 跟讀筆記解析 =====

    /**
     * 解析 NoteGenerator 產生的跟讀 Markdown 筆記
     * 回傳時間戳字串+原文的條目陣列（保留原始 MM:SS / HH:MM:SS 格式）
     *
     * 跳過：YAML frontmatter、嵌入式影片行（![[...]] / ![](...）、空行
     * 注意：若筆記已標註（行尾有 <div> HTML），text 會包含 HTML，
     *       呼叫端負責判斷是否為已標註筆記（不重複標註）。
     */
    static parseShadowingNote(content: string): import('../types').ShadowingEntry[] {
        const TIMESTAMP = /^\[(\d{2}:\d{2}(?::\d{2})?)\]\s*(.+)$/;
        const entries: import('../types').ShadowingEntry[] = [];
        let inFrontmatter = false;
        let frontmatterDone = false;

        for (const line of content.split('\n')) {
            const trimmed = line.trim();

            // YAML frontmatter
            if (trimmed === '---') {
                if (!frontmatterDone) {
                    inFrontmatter = !inFrontmatter;
                    if (!inFrontmatter) frontmatterDone = true;
                }
                continue;
            }
            if (inFrontmatter) continue;

            // 空行 / 嵌入影片行
            if (!trimmed) continue;
            if (trimmed.startsWith('![[') || trimmed.startsWith('![')) continue;
            // 裸 URL 行（YouTube embed）
            if (/^https?:\/\//.test(trimmed) && !trimmed.includes(']')) continue;

            const match = TIMESTAMP.exec(trimmed);
            if (match) {
                entries.push({ timestamp: match[1]!, text: match[2]! });
            } else if (entries.length > 0) {
                // 無時間戳的行視為上一行的延續
                entries[entries.length - 1]!.text += ' ' + trimmed;
            }
        }

        return entries;
    }

    /**
     * 從跟讀筆記中提取 frontmatter + 影片嵌入行（標註時原樣保留）
     * 回傳字串：到第一個 [MM:SS] 行之前的所有內容（含尾端換行）
     */
    static extractNoteHeader(content: string): string {
        const lines = content.split('\n');
        const TIMESTAMP = /^\[\d{2}:\d{2}(?::\d{2})?\]/;
        const firstSubIdx = lines.findIndex(l => TIMESTAMP.test(l.trim()));
        if (firstSubIdx === -1) return content;
        return lines.slice(0, firstSubIdx).join('\n').trimEnd() + '\n\n';
    }

    // ===== 跟讀筆記影片來源解析 =====

    /**
     * 從跟讀筆記的 YAML frontmatter 中提取 source 欄位。
     * 回傳 { type, url } 或 null（若無 source）。
     */
    static extractVideoSource(
        content: string
    ): { type: 'youtube' | 'local'; url: string } | null {
        const m = content.match(/^---\n[\s\S]*?\nsource:\s*(.+?)\s*\n[\s\S]*?---/m);
        const source = m?.[1]?.trim();
        if (!source) return null;
        if (/youtube\.com|youtu\.be/.test(source)) return { type: 'youtube', url: source };
        return { type: 'local', url: source };
    }

    /** 從 YouTube URL 中提取 11 位 video ID */
    static extractYouTubeVideoId(url: string): string | null {
        return url.match(/(?:v=|youtu\.be\/)([\w-]{11})/)?.[1] ?? null;
    }

    /**
     * 將 ShadowingEntry 的時間戳字串（MM:SS 或 HH:MM:SS）轉為秒數。
     * 複用 vttTimeToSeconds 實作（格式相容）。
     */
    static timestampToSeconds(ts: string): number {
        return this.vttTimeToSeconds(ts);
    }

    // ===== 時間轉換工具 =====

    /** VTT 時間格式轉秒數（支援 HH:MM:SS.mmm 和 MM:SS.mmm） */
    static vttTimeToSeconds(timeStr: string): number {
        const clean = timeStr.replace(',', '.');
        const parts = clean.split(':').map(Number);
        if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
        if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
        return 0;
    }

    /** SRT 時間格式轉秒數（HH:MM:SS,mmm） */
    static srtTimeToSeconds(timeStr: string): number {
        return this.vttTimeToSeconds(timeStr.replace(',', '.'));
    }

    /** 秒數轉 [HH:MM:SS] 或 [MM:SS] 格式 */
    static secondsToTimestamp(seconds: number): string {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) {
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
}
