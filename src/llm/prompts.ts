import type { LearnerLevel, OutputLanguage, UILanguage } from '../types';
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

/**
 * 將 annotationLanguage（'ja'/'ko'/...）解析為 LLM prompt 中的語言名稱。
 * 用於告知 LLM 使用者正在學習的是哪種語言。
 */
export function resolveSourceLang(annotationLanguage: string): string {
    const NAMES: Record<string, string> = {
        ja: 'Japanese',
        ko: 'Korean',
        zh: 'Chinese',
        en: 'English',
        fr: 'French',
        de: 'German',
        es: 'Spanish',
    };
    return NAMES[annotationLanguage] ?? 'Japanese';
}

// ─── Annotation Prompt Architecture ──────────────────────────────────────────
//
// The system prompt is assembled in two layers:
//
//   [Base layer]  — hardcoded in TypeScript; defines the JSON output schema,
//                   7-type annotation taxonomy, CEFR level guidance, and core
//                   constraints. Guarantees stable, parseable LLM output.
//
//   [Pack layer]  — loaded from LinguaReel/language-packs/{code}.md in the vault.
//                   Contains language-specific teaching style, annotation priorities,
//                   and translation guidance. Users can freely edit this.
//                   If the file is absent the base layer alone is used (still works).
//
// At call time, AnnotationPipeline appends the already-annotated terms list
// to the system prompt dynamically to enable cross-sentence deduplication.

const LEVEL_GUIDANCE: Record<LearnerLevel, string> = {
    A1: 'Annotate basic vocabulary and simple grammar structures. Prefer Vocab and Grammar types. Explanations must be very simple and direct — one clear sentence. Annotate generously (2–3 per line if possible).',
    A2: 'Annotate vocabulary and common grammar patterns. Prefer Vocab and Grammar types. Explanations should be simple and concrete. Annotate generously (2–3 per line if possible).',
    B1: 'Focus on idioms, phrasal verbs, and intermediate vocabulary. Skip basic grammar (present/past tense) and common everyday words. Explanations can include nuance and usage context.',
    B2: 'Focus on idioms, collocations, register differences, and advanced vocabulary. Skip anything a B1 learner would already know. Explanations should include subtle meaning differences and usage constraints.',
    C1: 'Focus only on advanced register, rare collocations, cultural references, and nuanced idioms. Skip anything below C1 level. Explanations can be sophisticated and assume strong grammatical knowledge.',
    C2: 'Annotate only the most culturally specific, register-sensitive, or lexically rare items. Virtually no grammar annotations. Explanations should address nuance, etymology, or pragmatic subtleties.',
};

/**
 * Hardcoded base prompt — JSON schema, taxonomy, level guidance.
 * Language-specific guidance is injected via packBody.
 * Already-annotated terms are appended dynamically by AnnotationPipeline.
 */
function buildAnnotationBasePrompt(
    sourceLang:   string,
    targetLang:   string,
    learnerLevel: LearnerLevel,
): string {
    return `\
You are a language teacher helping a student (CEFR level: ${learnerLevel}) learn ${sourceLang}.
Your task: read a single subtitle line in ${sourceLang}, translate it into ${targetLang}, and identify 0–3 points worth teaching at this learner's level.

## Output format — respond with JSON ONLY, no markdown:
{
  "translation": "${targetLang} translation of the subtitle",
  "annotations": [
    {
      "original": "exact substring from the original ${sourceLang} text — never paraphrase",
      "type": "one of the 7 types listed below",
      "key": "the term in its natural form — Vocab/Idiom/Phrasal Verb/Slang: copy from 'original' (e.g. めちゃくちゃ, make sense, 대박); Grammar: standard notation in ${sourceLang} convention (e.g. V-てほしい, 〜なきゃ, Present Perfect, V-아/어야 하다); Register/Culture: short label in ${targetLang}",
      "explanation": "1–2 sentence explanation in ${targetLang}, specific to this use",
      "example": "one new ${sourceLang} example sentence in a different context",
      "translation_word": "corresponding word/phrase in the translation (optional)"
    }
  ]
}

## Annotation types — "type" must be exactly one of these 7 values:
- Grammar: grammatical structures and patterns (e.g. Present Perfect, modal verbs)
- Idiom: multi-word expressions with non-literal meaning (e.g. make sense, a ton of)
- Phrasal Verb: verb + particle with special meaning (e.g. pick up, open up, get to)
- Vocab: single words worth learning at this level (e.g. subpar, telltale)
- Slang: informal / colloquial / internet language (e.g. suck, 'cause, cooking)
- Register: formality, politeness, or tone nuance that changes the social meaning
- Culture: cultural knowledge required to fully understand the expression

## Core rules
- "original" MUST be an exact substring of the input — never paraphrase or shorten
- "type" MUST be exactly one of the 7 values above — no other values allowed
- "key" must follow the type rule above; NEVER write an English description when ${sourceLang} is not English — Vocab/Idiom/Phrasal Verb/Slang keys must be in ${sourceLang}
- Annotate 0–3 points per line; NEVER exceed 3
- If nothing worth teaching at this level, return an empty annotations array

## Learner level: ${learnerLevel}
${LEVEL_GUIDANCE[learnerLevel]}`;
}

/**
 * Built-in Japanese pack body — used as fallback when LinguaReel/language-packs/ja.md
 * does not exist yet.
 */
const JA_PACK_BODY = `\
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

**Always annotate** keigo (polite/honorific speech) — explain the politeness level and nuance.

**Explanation style**
- Explain the specific use in this sentence, then show how it transfers to other contexts
- Write naturally — avoid academic grammar terminology`;

/**
 * Build the annotation system prompt (base + optional pack).
 * The already-annotated terms list is NOT included here —
 * AnnotationPipeline appends it dynamically per call.
 *
 * @param annotationLanguage  Learning language code ('ja', 'ko', etc.) or 'custom'
 * @param customPrompt        Used verbatim when annotationLanguage === 'custom'
 * @param outputLanguage      Language for AI output (translations, explanations)
 * @param uiLanguage          Plugin UI language (fallback for outputLanguage auto)
 * @param packBody            Body of the language pack .md file (frontmatter stripped).
 * @param learnerLevel        CEFR level — controls annotation density and depth.
 */
export function getAnnotationSystemPrompt(
    annotationLanguage: string,
    customPrompt:       string,
    outputLanguage:     OutputLanguage = 'auto',
    uiLanguage:         UILanguage     = 'auto',
    packBody?:          string,
    learnerLevel:       LearnerLevel   = 'B1',
): string {
    if (annotationLanguage === 'custom') return customPrompt;

    const targetLang = resolveOutputLang(outputLanguage, uiLanguage);
    const sourceLang = resolveSourceLang(annotationLanguage);
    const base       = buildAnnotationBasePrompt(sourceLang, targetLang, learnerLevel);

    // User-supplied pack takes priority
    if (packBody) return base + '\n\n' + packBody;

    // Built-in fallback for Japanese
    if (annotationLanguage === 'ja') return base + '\n\n' + JA_PACK_BODY;

    return base;
}

// ─── Subtitle Summary Prompt ──────────────────────────────────────────────────

/** JSON shape returned by getSubtitleSummaryMessages */
export interface SubtitleSummary {
    topic:       string;
    characters?: string;
    tone:        string;
    setting?:    string;
    summary:     string;
}

/**
 * 對整份字幕的前幾十行進行快速摘要，讓後續標注 LLM 了解背景（主題/語氣/人物）。
 * 只取前 40 行避免 token 過多；一般 30 秒字幕已足夠捕捉語境。
 */
export function getSubtitleSummaryMessages(
    subtitleTexts: string[],
    outputLanguage: OutputLanguage,
    uiLanguage:     UILanguage = 'auto',
): import('./client').ChatMessage[] {
    const targetLang = resolveOutputLang(outputLanguage, uiLanguage);
    const sample = subtitleTexts.slice(0, 40).join('\n');
    return [
        {
            role: 'system',
            content:
                `You are a content analyst. Read the subtitle excerpt and produce a brief context profile.\n` +
                `Return ONLY JSON (no markdown):\n` +
                `{"topic":"main topic or show type","characters":"visible speakers if any","tone":"speech style (casual/formal/energetic/etc)","setting":"context or scene","summary":"1–2 sentence overview"}\n` +
                `Write all values in ${targetLang}.`,
        },
        { role: 'user', content: sample },
    ];
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

/**
 * Fallback: translation-only prompt used when full annotation fails twice.
 * Minimal JSON output reduces the chance of parse failure on long subtitles.
 */
export function getTranslationOnlyMessages(
    subtitleText: string,
    targetLang:   string,
): import('./client').ChatMessage[] {
    return [
        {
            role: 'system',
            content: `Translate the subtitle into ${targetLang}. Return ONLY JSON: {"translation":"..."}. No annotations needed.`,
        },
        { role: 'user', content: subtitleText },
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
    sourceLang?:    string,
): import('./client').ChatMessage[] {
    const replyLang  = resolveOutputLang(outputLanguage, uiLanguage);
    const sourceLine = sourceLang ? `The word is in ${sourceLang}. ` : '';

    const contextLine = context
        ? `Context: "${context}"`
        : 'No context provided.';

    return [
        {
            role: 'system',
            content: `\
${sourceLine}You are a language teacher helping a student look up a word.
Return ONLY a JSON object (no markdown, no code fences) with these fields:
{
  "reading": "pronunciation/reading (e.g. hiragana for Japanese, pinyin for Chinese, IPA for others; empty string if same as word)",
  "pos": "part of speech (e.g. noun, verb, adjective suffix)",
  "definitions": ["definition 1", "definition 2"],
  "example": { "original": "${sourceLang ?? 'source language'} example sentence", "translation": "${replyLang} translation" },
  "notes": "brief grammar or usage note in ${replyLang} (1-2 sentences; empty string if nothing notable)"
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
    sourceLang?:    string,
): import('./client').ChatMessage[] {
    const replyLang  = resolveOutputLang(outputLanguage, uiLanguage);
    const fromClause = sourceLang ? `from ${sourceLang} ` : '';
    return [
        {
            role: 'system',
            content:
                `You are a language teacher. Translate the highlighted ${sourceLang ?? 'text'} ${fromClause}into ${replyLang} concisely. ` +
                `Return ONLY JSON (no markdown): {"translation":"...","note":"brief grammar/usage note in ${replyLang}, or empty string"}.`,
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
    sourceLang?:    string,
): import('./client').ChatMessage[] {
    const replyLang  = resolveOutputLang(outputLanguage, uiLanguage);
    const langClause = sourceLang ? `${sourceLang} ` : '';
    return [
        {
            role: 'system',
            content:
                `You are a ${langClause}language and culture expert helping a language learner. ` +
                `Research the highlighted ${langClause}text thoroughly. ` +
                `Return ONLY JSON (no markdown):\n` +
                `{"translation":"${replyLang} translation","explanation":"detailed meaning, nuance, etymology in ${replyLang} (under 80 words)",` +
                `"examples":[{"original":"${sourceLang ?? 'source'} sentence","translation":"${replyLang} translation"}],` +
                `"related":["related ${langClause}words or phrases"],` +
                `"cultural":"${replyLang} cultural/contextual notes if relevant, empty string if not"}\n` +
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
