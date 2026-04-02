import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { ToolStatus } from '../types';

const execFileAsync = promisify(execFile);

/**
 * Tier 2：呼叫 WhisperX / faster-whisper / whisper 進行語音轉錄
 * 用於：本地影片、YouTube 沒有字幕的影片
 *
 * 優先順序：
 *   1. whisperx（推薦）：內建 VAD 預處理，大幅減少幻覺
 *   2. faster-whisper：速度快 4-10 倍
 *   3. whisper（OpenAI 官方）
 */
export class WhisperRunner {

    constructor(
        private whisperPath = 'whisperx',
        private model       = 'base',
        private device      = 'auto'
    ) {}

    /** 偵測 WhisperX / faster-whisper / whisper 是否已安裝 */
    async detectInstallation(): Promise<ToolStatus> {
        const primaryResult = await this.tryExecute(this.whisperPath);
        if (primaryResult.available) return primaryResult;

        for (const tool of ['whisperx', 'faster-whisper', 'whisper']) {
            const result = await this.tryExecute(tool);
            if (result.available) {
                this.whisperPath = tool;
                return result;
            }
        }

        for (const p of this.getCommonPaths()) {
            const result = await this.tryExecute(p);
            if (result.available) {
                this.whisperPath = p;
                return result;
            }
        }

        return { available: false };
    }

    /**
     * 轉錄音頻或影片文件
     * @returns 生成的 VTT 字幕文件路徑
     */
    async transcribe(
        inputPath: string,
        outputDir?: string,
        language = 'auto',
        onProgress?: (msg: string) => void
    ): Promise<string> {
        const workDir = outputDir ?? path.join(os.tmpdir(), `vll-whisper-${Date.now()}`);
        fs.mkdirSync(workDir, { recursive: true });

        const toolName = this.whisperPath.includes('whisperx')        ? 'WhisperX'
                       : this.whisperPath.includes('faster-whisper')  ? 'faster-whisper'
                       : 'Whisper';

        onProgress?.(`正在使用 ${toolName} ${this.model} 模型轉錄，請稍候...`);
        onProgress?.('（轉錄時間取決於影片長度和模型大小）');

        const isWhisperX      = this.whisperPath.includes('whisperx');
        const isFasterWhisper = !isWhisperX && this.whisperPath.includes('faster-whisper');

        const args = isWhisperX      ? this.buildWhisperXArgs(inputPath, workDir, language)
                   : isFasterWhisper ? this.buildFasterWhisperArgs(inputPath, workDir, language)
                   : this.buildWhisperArgs(inputPath, workDir, language);

        try {
            await execFileAsync(this.whisperPath, args, {
                timeout:   1800000,
                maxBuffer: 10 * 1024 * 1024,
                env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
            });
        } catch (error: any) {
            throw new Error(`Whisper 轉錄失敗：${error.message}`);
        }

        const inputBaseName = path.basename(inputPath, path.extname(inputPath));
        const vttPath       = path.join(workDir, `${inputBaseName}.vtt`);
        if (fs.existsSync(vttPath)) return vttPath;

        const files   = fs.readdirSync(workDir);
        const vttFile = files.find(f => f.endsWith('.vtt'));
        if (vttFile) return path.join(workDir, vttFile);

        throw new Error('Whisper 轉錄完成但找不到輸出的 VTT 文件');
    }

    // ===== 私有方法 =====

    private buildWhisperXArgs(inputPath: string, outputDir: string, language: string): string[] {
        const args = [
            inputPath,
            '--output_format', 'vtt',
            '--output_dir', outputDir,
            '--model', this.model,
            '--condition_on_previous_text', 'False',
        ];
        if (this.device !== 'auto')  args.push('--device', this.device);
        if (language !== 'auto')     args.push('--language', language);
        return args;
    }

    private buildWhisperArgs(inputPath: string, outputDir: string, language: string): string[] {
        const args = [inputPath, '--output_format', 'vtt', '--output_dir', outputDir, '--model', this.model];
        if (language !== 'auto') args.push('--language', language);
        return args;
    }

    private buildFasterWhisperArgs(inputPath: string, outputDir: string, language: string): string[] {
        const args = [inputPath, '--output_format', 'vtt', '--output_dir', outputDir, '--model', this.model];
        if (language !== 'auto') args.push('--language', language);
        return args;
    }

    private async tryExecute(execPath: string): Promise<ToolStatus> {
        try {
            const { stdout, stderr } = await execFileAsync(execPath, ['--help'], { timeout: 5000 });
            const versionMatch = (stdout + stderr).match(/(\d+\.\d+[\.\d]*)/);
            return { available: true, version: versionMatch?.[1], path: execPath };
        } catch {
            return { available: false };
        }
    }

    private getCommonPaths(): string[] {
        if (os.platform() === 'win32') {
            return [
                'faster-whisper',
                path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'whisper', 'whisper.exe'),
                path.join(os.homedir(), 'AppData', 'Roaming', 'Python', 'Scripts', 'whisper.exe'),
            ];
        }
        return [
            'faster-whisper',
            '/usr/local/bin/whisper',
            path.join(os.homedir(), '.local', 'bin', 'whisper'),
            path.join(os.homedir(), 'miniconda3', 'bin', 'whisper'),
            path.join(os.homedir(), 'anaconda3', 'bin', 'whisper'),
        ];
    }
}
