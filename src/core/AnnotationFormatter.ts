import type { AnnotatedEntry, AnnotationItem } from '../types';
import { t } from '../i18n';

/**
 * 純函數：將標註資料轉換為 Markdown + HTML 格式的字幕行
 *
 * 移植自 Python skill: process_japanese_subs.py :: json_to_annotated_line()
 * 所有 HTML 在此生成，LLM 完全不碰 HTML。
 *
 * 輸出格式（與現有 annotated.md 相容）：
 * [MM:SS] 原文with**bold**<div blue>翻譯<div pink>小課堂</div></div>
 */

// ─── HTML 小工具 ──────────────────────────────────────────────────────────────
// 使用 CSS class（定義於 styles.css）取代 inline style，支援深色/淺色主題自動適配

/** 翻譯中重點詞：橙色虛線底線 */
function spanUnderline(text: string): string {
    return `<span class="vll-ann-underline">${text}</span>`;
}

/** 小課堂 div（粉色左框）
 *  格式：小課堂："original" [Type] key — explanation
 *          e.g. example sentence
 */
function lessonDiv(ann: AnnotationItem): string {
    const quote   = `<span class="vll-ann-quote">"${ann.original}"</span>`;
    const typeTag = `<span class="vll-ann-type">[${ann.type}]</span>`;
    const example = ann.example
        ? `<div class="vll-ann-example"><em>e.g.</em> ${ann.example}</div>`
        : '';
    return (
        '<div class="vll-ann-lesson">'
      + `<span class="vll-ann-label vll-ann-lesson-label">${t('annotation.lessonLabel')}</span>：`
      + `${quote} ${typeTag} <span class="vll-ann-key">${ann.key}</span> — ${ann.explanation}`
      + example
      + '</div>'
    );
}

/** 翻譯 div（青色左框，包含所有小課堂） */
function translationDiv(translationHtml: string, lessonsHtml: string): string {
    return (
        '<div class="vll-ann-block">'
      + `<span class="vll-ann-label vll-ann-translation-label">${t('annotation.translationLabel')}</span>：${translationHtml}`
      + lessonsHtml
      + '</div>'
    );
}

// ─── 主函數 ───────────────────────────────────────────────────────────────────

/**
 * 將一個 AnnotatedEntry 格式化為完整的 annotated markdown 行。
 * 若 translation 為空（LLM 失敗），回傳原始 `[MM:SS] text` 行（不含 div）。
 */
export function formatAnnotatedLine(entry: AnnotatedEntry): string {
    // LLM 失敗時回退到純文字
    if (!entry.translation) {
        return `[${entry.timestamp}] ${entry.text}`;
    }

    // 在原文中標記粗體（每個 annotation.original 替換一次）
    let annotatedText = entry.text;
    for (const ann of entry.annotations) {
        if (ann.original && annotatedText.includes(ann.original)) {
            annotatedText = annotatedText.replace(ann.original, `**${ann.original}**`);
        }
    }

    // 翻譯中標記重點詞（橙色虛線底線）
    let translationHtml = entry.translation;
    for (const ann of entry.annotations) {
        const tw = ann.translation_word;
        if (tw && translationHtml.includes(tw)) {
            translationHtml = translationHtml.replace(tw, spanUnderline(tw));
        }
    }

    // 組裝小課堂 div
    const lessonsHtml = entry.annotations
        .filter(a => a.key && a.explanation)
        .map(a => lessonDiv(a))
        .join('');

    return (
        `[${entry.timestamp}] ${annotatedText}`
      + translationDiv(translationHtml, lessonsHtml)
    );
}

/**
 * 驗證標註資料的基本正確性（移植自 Python validate_output）
 * 回傳 warnings 陣列，空陣列代表通過。
 */
export function validateAnnotatedLine(entry: AnnotatedEntry): string[] {
    const warnings: string[] = [];

    if (entry.annotations.length > 3) {
        warnings.push(`[${entry.timestamp}] 標註數超過 3 個（${entry.annotations.length}）`);
    }

    for (const ann of entry.annotations) {
        if (!entry.text.includes(ann.original)) {
            warnings.push(
                `[${entry.timestamp}] 標註詞 "${ann.original}" 不是原文子字串，已自動移除`
            );
        }
    }

    return warnings;
}
