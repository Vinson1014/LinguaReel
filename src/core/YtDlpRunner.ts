import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { VideoInfo, ToolStatus } from '../types';

const execFileAsync = promisify(execFile);

/**
 * Tier 1/2：呼叫 yt-dlp 執行檔
 * 負責：下載字幕（有字幕時）、下載音頻（給 Whisper 用）
 */
export class YtDlpRunner {

    constructor(private ytdlpPath = 'yt-dlp') {}

    /** 偵測 yt-dlp 是否已安裝 */
    async detectInstallation(): Promise<ToolStatus> {
        try {
            const { stdout } = await execFileAsync(this.ytdlpPath, ['--version'], { timeout: 5000 });
            return { available: true, version: stdout.trim(), path: this.ytdlpPath };
        } catch {
            for (const p of this.getCommonPaths()) {
                try {
                    const { stdout } = await execFileAsync(p, ['--version'], { timeout: 5000 });
                    this.ytdlpPath = p;
                    return { available: true, version: stdout.trim(), path: p };
                } catch { continue; }
            }
            return { available: false };
        }
    }

    /** 取得影片基本資訊（不下載任何文件） */
    async getVideoInfo(url: string): Promise<VideoInfo> {
        const { stdout } = await execFileAsync(
            this.ytdlpPath,
            ['--print', '%(title)s\t%(duration)s', '--no-playlist', url],
            { timeout: 30000 }
        );
        const [title, durationStr] = stdout.trim().split('\t');
        return {
            title:    title ?? '未知標題',
            source:   url,
            duration: durationStr ? parseFloat(durationStr) : undefined,
            type:     'youtube',
        };
    }

    /**
     * 下載字幕到暫存目錄
     * @returns 字幕檔案路徑，若無字幕則回傳 null
     */
    async downloadSubtitle(url: string, lang = 'en'): Promise<string | null> {
        const tempDir        = this.createTempDir();
        const outputTemplate = path.join(tempDir, 'subtitle');

        try {
            await execFileAsync(
                this.ytdlpPath,
                [
                    '--write-sub', '--write-auto-sub',
                    '--sub-lang', lang,
                    '--sub-format', 'srv1',
                    '--skip-download', '--no-playlist',
                    '-o', outputTemplate,
                    url,
                ],
                { timeout: 60000 }
            );

            const files   = fs.readdirSync(tempDir);
            const subFile = files.find(f => f.endsWith('.srv1') || f.endsWith('.xml'));
            return subFile ? path.join(tempDir, subFile) : null;
        } catch (error: any) {
            console.log(`[VLL] yt-dlp 字幕下載失敗：${error.message}`);
            return null;
        }
    }

    /**
     * 下載音頻到暫存目錄（給 Whisper 轉錄用）
     * @returns 音頻檔案路徑（mp3）
     */
    async downloadAudio(url: string, onProgress?: (msg: string) => void): Promise<string> {
        const tempDir        = this.createTempDir();
        const outputTemplate = path.join(tempDir, 'audio');

        onProgress?.('正在下載音頻...');

        await execFileAsync(
            this.ytdlpPath,
            ['-x', '--audio-format', 'mp3', '--audio-quality', '5',
             '--no-playlist', '-o', outputTemplate, url],
            { timeout: 300000 }
        );

        const files   = fs.readdirSync(tempDir);
        const mp3File = files.find(f => f.endsWith('.mp3'));
        if (!mp3File) throw new Error('yt-dlp 音頻下載完成但找不到輸出文件');

        return path.join(tempDir, mp3File);
    }

    /** 清除暫存目錄 */
    static cleanupTempDir(dirPath: string): void {
        try {
            fs.rmSync(dirPath, { recursive: true, force: true });
        } catch { /* 清理失敗不影響主流程 */ }
    }

    // ===== 私有方法 =====

    private createTempDir(): string {
        const tempDir = path.join(os.tmpdir(), `vll-import-${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });
        return tempDir;
    }

    private getCommonPaths(): string[] {
        if (os.platform() === 'win32') {
            return [
                'yt-dlp.exe',
                path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'yt-dlp', 'yt-dlp.exe'),
                'C:\\yt-dlp\\yt-dlp.exe',
            ];
        }
        return [
            '/usr/local/bin/yt-dlp',
            '/usr/bin/yt-dlp',
            path.join(os.homedir(), '.local', 'bin', 'yt-dlp'),
        ];
    }
}
