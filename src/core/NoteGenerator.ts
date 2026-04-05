import type { SubtitleEntry, VideoInfo, VLLSettings } from '../types';
import { SubtitleParser } from './SubtitleParser';

/**
 * 生成 VLL 跟讀工坊相容的 Markdown 筆記
 *
 * 格式：
 * ---
 * title: "影片標題"
 * source: URL 或本地路徑
 * language: en
 * imported: YYYY-MM-DD
 * ---
 *
 * https://www.youtube.com/watch?v=xxxxx
 *
 * [00:03] 字幕文字
 *
 * [00:06] 更多字幕文字
 */
export class NoteGenerator {

    static generate(
        video: VideoInfo,
        subtitles: SubtitleEntry[],
        settings: Pick<VLLSettings, 'annotationLanguage'>
    ): string {
        const today = new Date().toISOString().split('T')[0];

        const frontmatter = [
            '---',
            `title: "${video.title.replace(/"/g, "'")}"`,
            `source: ${video.source}`,
            `language: ${settings.annotationLanguage}`,
            `imported: ${today}`,
            '---',
        ].join('\n');

        // 影片嵌入行
        const videoEmbed = video.type === 'youtube'
            ? `\n${video.source}\n`
            : `\n![[${video.source}]]\n`;

        // 字幕條目
        const subtitleLines = subtitles
            .map(entry => {
                const timestamp = SubtitleParser.secondsToTimestamp(entry.start);
                const text      = entry.text.replace(/\s+/g, ' ').trim();
                return `[${timestamp}] ${text}`;
            })
            .join('\n\n');

        return `${frontmatter}\n${videoEmbed}\n${subtitleLines}\n`;
    }

    /** 產生筆記的建議檔名（移除非法字元，限制 60 字元） */
    static generateFileName(title: string): string {
        return title
            .replace(/[\\/:*?"<>|]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 60)
            + '.md';
    }

    /**
     * 由原始筆記路徑產生標註版的建議路徑
     * 例如：Shadowing/video.mp4.md → Shadowing/video.mp4 - annotated.md
     */
    static annotatedNotePath(originalPath: string): string {
        return originalPath.replace(/\.md$/, ' - annotated.md');
    }
}
