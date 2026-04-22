import type { ShadowingEntry, AnnotatedEntry, AnnotationItem, SubtitleAnnotation } from '../types';
import type { LLMClient } from '../llm/client';
import { getAnnotationMessages, getTranslationOnlyMessages } from '../llm/prompts';
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
    /** 輸出語言（用於 translation-only fallback prompt），例如 'Traditional Chinese' */
    targetLang: string;
    /** 進度回呼 */
    onProgress: (done: number, total: number) => void;
    /** 警告回呼（標註驗證問題，不影響流程） */
    onWarning?: (warning: string) => void;
    /** 取消信號 */
    signal?: AbortSignal;
    /** 每批並行數（預設 3，本地模型可設 1） */
    batchSize?: number;
    /**
     * LLM 串流 token 回呼。
     * subtitle = 目前送給 LLM 的字幕原文；accumulated = LLM 目前累積輸出。
     * 批次並行時多條字幕會交錯呼叫，以最後收到的為準。
     */
    onToken?: (subtitle: string, accumulated: string) => void;
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
        // 跨句去重：記錄已標注過的 {original, key} 對，批次間傳遞
        const annotatedPairs: {original: string; key: string}[] = [];

        for (let i = 0; i < entries.length; i += batchSize) {
            if (options.signal?.aborted) break;

            const batch = entries.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(entry => this.annotateOne(
                    entry, options.systemPrompt, options.targetLang, annotatedPairs, options.signal, options.onToken
                ))
            );

            for (const annotated of batchResults) {
                // 驗證並收集 warnings
                const lineWarnings = validateAnnotatedLine(annotated);
                warnings.push(...lineWarnings);

                // 清理無效的 annotations（original 不存在於原文）
                annotated.annotations = annotated.annotations.filter(
                    a => a.original && annotated.text.includes(a.original)
                );

                // 將本批次已標注的 original + key 加入，供後續批次跳過語意重複
                for (const ann of annotated.annotations) {
                    if (ann.original && ann.key) {
                        annotatedPairs.push({original: ann.original, key: ann.key});
                    }
                }

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
        entry:           ShadowingEntry,
        systemPrompt:    string,
        targetLang:      string,
        annotatedPairs:  {original: string; key: string}[],
        signal?:         AbortSignal,
        onToken?:        (subtitle: string, accumulated: string) => void,
    ): Promise<AnnotatedEntry> {
        // 嘗試 1 & 2：完整標注（第 2 次為 retry）
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const termsList = annotatedPairs.length > 0
                    ? annotatedPairs.slice(0, 40).map(p => `${p.original} (key: ${p.key})`).join(', ')
                    : 'none';
                const dynamicPrompt = systemPrompt
                    + `\n\n## Already annotated in this session (skip these and any semantically equivalent concepts):\n${termsList}`;

                const messages = getAnnotationMessages(entry.text, dynamicPrompt);
                let raw: SubtitleAnnotation;

                if (onToken && attempt === 0) {
                    raw = await this.llm.chatJSONStream<SubtitleAnnotation>(
                        messages,
                        'fast',
                        (accumulated) => onToken(entry.text, accumulated),
                        signal,
                    );
                } else {
                    raw = await this.llm.chatJSON<SubtitleAnnotation>(messages, 'fast');
                }

                const cleanAnnotations: AnnotationItem[] = (raw.annotations ?? [])
                    .filter(ann =>
                        ann.original &&
                        ann.key &&
                        ann.explanation &&
                        entry.text.includes(ann.original)
                    )
                    .slice(0, 3);

                return {
                    timestamp:   entry.timestamp,
                    text:        entry.text,
                    translation: raw.translation ?? '',
                    annotations: cleanAnnotations,
                };
            } catch {
                // 繼續到下一次嘗試
            }
        }

        // 嘗試 3：translation-only fallback（極簡 prompt，避免長字幕 JSON 截斷）
        try {
            const messages = getTranslationOnlyMessages(entry.text, targetLang);
            const raw = await this.llm.chatJSON<{ translation: string }>(messages, 'fast');
            return {
                timestamp:   entry.timestamp,
                text:        entry.text,
                translation: raw.translation ?? '',
                annotations: [],
            };
        } catch {
            // 三次全敗，回傳裸行
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
