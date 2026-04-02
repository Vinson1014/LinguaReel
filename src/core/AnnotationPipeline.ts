import type { ShadowingEntry, AnnotatedEntry, AnnotationItem, SubtitleAnnotation } from '../types';
import type { LLMClient } from '../llm/client';
import { getAnnotationMessages } from '../llm/prompts';
import { formatAnnotatedLine, validateAnnotatedLine } from './AnnotationFormatter';
import { SubtitleParser } from './SubtitleParser';

/**
 * 字幕標註 Pipeline（狀態機）
 *
 * 移植自 Python skill: annotate.py
 *
 * 設計原則：
 * - LLM 每次只處理一條字幕（防止跨句干擾）
 * - 以批次並行（預設 3 條/批）提升速度
 * - annotations[].original 不存在於原文時自動移除，不阻擋流程
 * - LLM 失敗時回傳無標註的原始條目（不整體中斷）
 * - 支援 AbortSignal 中途取消
 */

export interface PipelineOptions {
    /** 標註語言 system prompt（來自語言包或自訂） */
    systemPrompt: string;
    /** 進度回呼 */
    onProgress: (done: number, total: number) => void;
    /** 警告回呼（標註驗證問題，不影響流程） */
    onWarning?: (warning: string) => void;
    /** 取消信號 */
    signal?: AbortSignal;
    /** 每批並行數（預設 3，本地模型可設 1） */
    batchSize?: number;
}

export interface PipelineResult {
    entries: AnnotatedEntry[];
    /** 組裝完整的 annotated markdown 內容（含原始 header） */
    toMarkdown: (noteHeader: string) => string;
    warnings: string[];
}

export class AnnotationPipeline {

    constructor(private llm: LLMClient) {}

    /**
     * 對一個跟讀筆記的字幕條目執行標註。
     * 回傳 PipelineResult，包含所有 AnnotatedEntry 和組裝用的 toMarkdown()。
     */
    async run(
        entries: ShadowingEntry[],
        options: PipelineOptions,
    ): Promise<PipelineResult> {
        const batchSize = options.batchSize ?? 3;
        const results: AnnotatedEntry[] = [];
        const warnings: string[] = [];

        for (let i = 0; i < entries.length; i += batchSize) {
            if (options.signal?.aborted) break;

            const batch = entries.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(entry => this.annotateOne(entry, options.systemPrompt))
            );

            for (const annotated of batchResults) {
                // 驗證並收集 warnings
                const lineWarnings = validateAnnotatedLine(annotated);
                warnings.push(...lineWarnings);

                // 清理無效的 annotations（original 不存在於原文）
                annotated.annotations = annotated.annotations.filter(
                    a => a.original && annotated.text.includes(a.original)
                );

                results.push(annotated);
            }

            options.onProgress(results.length, entries.length);
        }

        return {
            entries: results,
            warnings,
            toMarkdown: (noteHeader: string) => assembleNote(noteHeader, results),
        };
    }

    /**
     * 從 Markdown 筆記內容直接執行標註（一站式入口）
     * 自動解析 header + entries，完成後回傳完整 annotated markdown
     */
    async runOnNote(
        noteContent: string,
        options: PipelineOptions,
    ): Promise<PipelineResult> {
        const header  = SubtitleParser.extractNoteHeader(noteContent);
        const entries = SubtitleParser.parseShadowingNote(noteContent);
        return this.run(entries, options);
    }

    // ─── 單條標註 ─────────────────────────────────────────────────────────

    private async annotateOne(
        entry: ShadowingEntry,
        systemPrompt: string,
    ): Promise<AnnotatedEntry> {
        try {
            const messages = getAnnotationMessages(entry.text, systemPrompt);
            const raw      = await this.llm.chatJSON<SubtitleAnnotation>(messages, 'fast');

            const cleanAnnotations: AnnotationItem[] = (raw.annotations ?? [])
                .filter(ann =>
                    ann.original &&
                    ann.key &&
                    ann.explanation &&
                    entry.text.includes(ann.original)
                )
                .slice(0, 3);  // 最多 3 個（SKILL.md 規則）

            return {
                timestamp:   entry.timestamp,
                text:        entry.text,
                translation: raw.translation ?? '',
                annotations: cleanAnnotations,
            };
        } catch {
            // LLM 失敗時回傳無標註的原始條目，不中斷整體流程
            return {
                timestamp:   entry.timestamp,
                text:        entry.text,
                translation: '',
                annotations: [],
            };
        }
    }
}

// ─── 組裝最終 Markdown ────────────────────────────────────────────────────────

function assembleNote(header: string, entries: AnnotatedEntry[]): string {
    const lines = entries.map(e => formatAnnotatedLine(e));
    return header + lines.join('\n') + '\n';
}
