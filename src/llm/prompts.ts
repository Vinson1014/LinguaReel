import type { OutputLanguage, UILanguage } from '../types';
import { getCurrentLang } from '../i18n';

// ─── Output Language Resolution ──────────────────────────────────────────────

/**
 * 將 OutputLanguage（含 auto）解析為 LLM prompt 中可直接使用的語言名稱。
 * auto 時跟隨 uiLanguage；uiLanguage 也是 auto 則預設 English。
 */
export function resolveOutputLang(
    outputLanguage: OutputLanguage,
    uiLanguage:     UILanguage,
): string {
    // 當 outputLanguage 為 auto，跟隨 uiLanguage；
    // 若 uiLanguage 也是 auto，則讀取已由 initI18n() 解析的實際語言代碼
    const resolved = outputLanguage !== 'auto'
        ? outputLanguage
        : uiLanguage !== 'auto'
            ? uiLanguage
            : getCurrentLang();   // 已偵測的 Obsidian 語言（'en'|'zh-TW'|'zh-CN'）
    switch (resolved) {
        case 'zh-TW': return 'Traditional Chinese';
        case 'zh-CN': return 'Simplified Chinese';
        default:      return 'English';
    }
}

// ─── Language Pack ────────────────────────────────────────────────────────────

export interface LanguagePack {
    id: string;
    /** Display name shown in settings */
    name: string;
    /** System prompt injected into the annotation pipeline */
    annotationSystemPrompt: string;
}

// ─── Japanese Language Pack ───────────────────────────────────────────────────

function buildJaAnnotationPrompt(targetLang: string): string {
    return `\
You are a senior Japanese language teacher and subtitle translator.
Your task: translate a single Japanese subtitle line into ${targetLang} AND identify up to 3 grammar/vocabulary points worth teaching.

## Output format — respond with JSON ONLY, no markdown, no HTML:
{
  "translation": "${targetLang} translation",
  "annotations": [
    {
      "original": "exact substring from the original Japanese text",
      "key": "grammar point title, e.g. 〜てる",
      "explanation": "concise explanation in ${targetLang} (1-2 sentences, natural language, relatable)",
      "translation_word": "corresponding word in the translation (optional)"
    }
  ]
}

## Translation rules
- Match the character's tone — casual speech stays casual, formal stays formal
- Don't over-translate; natural ${targetLang} > literal accuracy
- Condense redundant filler words (あの、えっと repeated) but keep grammatically meaningful ones
- Preserve speaker personality (energetic, shy, formal, etc.)

## Annotation rules
- Annotate 0–3 points per line; prefer 0–2; NEVER exceed 3
- Priority order:
  1. High-frequency idioms, mimetics/onomatopoeia (めっちゃ, どんどん, ワクワク)
  2. Verb conjugation forms (〜てる, 〜ちゃう, 〜とく, 〜なきゃ)
  3. Particles or sentence-final particles with special nuance
- DO NOT annotate: basic kanji (学校/天気/映画), standard は/を/が usage, words >5 kanji unless rare/technical
- ALWAYS annotate keigo; include politeness nuance in the explanation
- "original" MUST be an exact substring of the input text — never paraphrase or shorten it

## Lesson writing guide
- One or two sentences max, written in ${targetLang}
- Explain the specific use IN THIS sentence, then show transferability
- Use everyday ${targetLang}, not academic Japanese grammar terminology`;
}

export const LANGUAGE_PACKS: Record<string, LanguagePack> = {
    ja: {
        id:   'ja',
        name: '日本語 (Japanese)',
        // annotationSystemPrompt is built dynamically; this is kept as a fallback
        annotationSystemPrompt: buildJaAnnotationPrompt('Traditional Chinese'),
    },
};

export function getAnnotationSystemPrompt(
    annotationLanguage: string,
    customPrompt:       string,
    outputLanguage:     OutputLanguage = 'auto',
    uiLanguage:         UILanguage     = 'auto',
): string {
    if (annotationLanguage === 'custom') return customPrompt;
    const targetLang = resolveOutputLang(outputLanguage, uiLanguage);
    if (annotationLanguage === 'ja') return buildJaAnnotationPrompt(targetLang);
    // fallback to pack's stored prompt if available
    return LANGUAGE_PACKS[annotationLanguage]?.annotationSystemPrompt
        ?? buildJaAnnotationPrompt(targetLang);
}

// ─── Annotation Prompt ───────────────────────────────────────────────────────

/**
 * Build messages for a single subtitle annotation request.
 * LLM sees ONE subtitle at a time — this is intentional (prevents cross-contamination).
 */
export function getAnnotationMessages(
    subtitleText: string,
    systemPrompt: string,
): import('./client').ChatMessage[] {
    return [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: subtitleText },
    ];
}

// ─── Dictionary Lookup Prompt ─────────────────────────────────────────────────

/**
 * Build messages for a word lookup query.
 * The response should be JSON matching DictLookupResult.
 */
export function getDictLookupMessages(
    word:           string,
    context:        string | undefined,
    outputLanguage: OutputLanguage,
    uiLanguage:     UILanguage = 'auto',
): import('./client').ChatMessage[] {
    const replyLang = resolveOutputLang(outputLanguage, uiLanguage);

    const contextLine = context
        ? `Context sentence: "${context}"`
        : 'No context provided.';

    return [
        {
            role: 'system',
            content: `\
You are a language teacher. The user double-clicked a word in a text to look it up.
Return ONLY a JSON object (no markdown, no code fences) with these fields:
{
  "reading": "pronunciation/reading (e.g. hiragana for Japanese, pinyin for Chinese, IPA for others; empty string if same as word)",
  "pos": "part of speech (e.g. noun, verb, adjective suffix)",
  "definitions": ["definition 1", "definition 2"],
  "example": { "original": "example sentence", "translation": "translation" },
  "notes": "brief grammar or usage note (1-2 sentences; empty string if nothing notable)"
}
All text values (definitions, notes, translations) must be in ${replyLang}.
Keep definitions concise. Provide 1–3 definitions maximum.`,
        },
        {
            role: 'user',
            content: `Word: "${word}"\n${contextLine}`,
        },
    ];
}

/** Shape of the JSON returned by getDictLookupMessages */
export interface DictLookupResult {
    reading:     string;
    pos:         string;
    definitions: string[];
    example:     { original: string; translation: string };
    notes:       string;
}

// ─── Highlight Prompts ───────────────────────────────────────────────────────

/** Shape of JSON returned by getHighlightTranslationMessages */
export interface HighlightTranslationResult {
    translation: string;
    note?:       string;
}

/** Shape of JSON returned by getHighlightResearchMessages */
export interface HighlightResearchResult {
    translation: string;
    explanation: string;
    examples:    Array<{ original: string; translation: string }>;
    related?:    string[];
    cultural?:   string;
}

/** Build messages for a quick AI translation of a highlighted phrase. */
export function getHighlightTranslationMessages(
    text:           string,
    context:        string | undefined,
    outputLanguage: OutputLanguage,
    uiLanguage:     UILanguage = 'auto',
): import('./client').ChatMessage[] {
    const replyLang = resolveOutputLang(outputLanguage, uiLanguage);
    return [
        {
            role: 'system',
            content:
                `You are a translator. Translate the highlighted text concisely. ` +
                `Return ONLY JSON (no markdown): {"translation":"...","note":"brief grammar/usage note or empty string"}. ` +
                `Reply in ${replyLang}.`,
        },
        {
            role: 'user',
            content: context
                ? `Text: "${text}"\nContext: "${context}"`
                : `Text: "${text}"`,
        },
    ];
}

/**
 * Build messages for a deep-research report on a highlighted phrase.
 * Uses the "powerful" model profile.
 */
export function getHighlightResearchMessages(
    text:           string,
    context:        string | undefined,
    outputLanguage: OutputLanguage,
    uiLanguage:     UILanguage = 'auto',
): import('./client').ChatMessage[] {
    const replyLang = resolveOutputLang(outputLanguage, uiLanguage);
    return [
        {
            role: 'system',
            content:
                `You are a language and culture expert. Research the highlighted text thoroughly. ` +
                `Return ONLY JSON (no markdown):\n` +
                `{"translation":"...","explanation":"detailed meaning, nuance, etymology (under 80 words)",` +
                `"examples":[{"original":"...","translation":"..."}],"related":["related words or phrases"],` +
                `"cultural":"cultural/contextual notes if relevant, empty string if not"}\n` +
                `Reply in ${replyLang}. Provide 1-2 examples max.`,
        },
        {
            role: 'user',
            content: context
                ? `Highlighted: "${text}"\nContext: "${context}"`
                : `Highlighted: "${text}"`,
        },
    ];
}
