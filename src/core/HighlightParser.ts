import type { HighlightNote, HighlightColor } from '../types';

/** Stable deterministic ID based on file path + line + text */
function highlightId(filePath: string, lineNum: number, text: string): string {
    return `${filePath}::${lineNum}::${text.trim()}`;
}

/**
 * Classify a CSS hex color string (e.g. "#FFF3A3A6") into one of the four
 * HighlightColor buckets by computing the HSL hue of the RGB components.
 * Alpha channel (8-digit hex) is ignored.
 */
function classifyHexColor(hex: string): HighlightColor {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    // Achromatic / very pale — call it yellow
    if (delta < 0.12) return 'yellow';

    let hue = 0;
    if (max === r)      hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else                hue = (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;

    if (hue < 35 || hue >= 315) return 'pink';    // red / pink / magenta
    if (hue < 80)                return 'yellow';  // orange / yellow
    if (hue < 175)               return 'green';   // green / lime
    return 'blue';                                  // cyan / blue / indigo
}

/**
 * Parse all highlights from raw markdown content.
 *
 * Supported syntax:
 *   - ==text==
 *       Standard Obsidian highlight — always classified as yellow.
 *   - <mark style="background: #RRGGBBAA;">text</mark>
 *       Highlightr plugin default output — color inferred from hex value.
 *   - <mark class="hltr-COLOR">text</mark>
 *       Highlightr plugin (older / custom CSS snippet installs).
 *
 * Plain <mark> without style or class is intentionally ignored to avoid
 * false-positives from annotated.md output.
 */
export function parseHighlights(content: string, filePath: string): HighlightNote[] {
    const lines = content.split('\n');
    const results: HighlightNote[] = [];
    const now = Date.now();

    // Skip YAML frontmatter
    let startLine = 0;
    if (lines[0]?.trimEnd() === '---') {
        let i = 1;
        while (i < lines.length && lines[i]?.trimEnd() !== '---') i++;
        startLine = i + 1;
    }

    for (let lineIdx = startLine; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx]!;

        // Skip fenced code blocks
        if (line.startsWith('```') || line.startsWith('~~~')) {
            const fence = line.slice(0, 3);
            lineIdx++;
            while (lineIdx < lines.length && !lines[lineIdx]!.startsWith(fence)) lineIdx++;
            continue;
        }

        // Context helper: strip all mark syntax from a line to get plain text
        const stripMarks = (s: string) =>
            s.replace(/==([^=\n]+)==/g, '$1')
             .replace(/<mark[^>]*>(.*?)<\/mark>/gi, '$1')
             .trim();

        // ── ==text== (Obsidian native) ─────────────────────────────────────
        const obsidianRe = /==([^=\n]+)==/g;
        let m: RegExpExecArray | null;
        while ((m = obsidianRe.exec(line)) !== null) {
            const text = m[1]!.trim();
            if (!text) continue;
            const context = stripMarks(line);
            results.push({
                id:         highlightId(filePath, lineIdx, text),
                text,
                context:    context !== text ? context : undefined,
                color:      'yellow',
                sourceFile: filePath,
                sourceLine: lineIdx,
                tags:       [],
                createdAt:  now,
                updatedAt:  now,
            });
        }

        // ── <mark style="background: #XXXXXX[XX]"> (Highlightr default) ───
        const styleRe = /<mark\s+style="[^"]*background:\s*(#[0-9a-fA-F]{6,8})[^"]*"[^>]*>(.*?)<\/mark>/gi;
        while ((m = styleRe.exec(line)) !== null) {
            const hex  = m[1]!;
            const text = m[2]!.replace(/<[^>]+>/g, '').trim();
            if (!text) continue;
            const context = stripMarks(line);
            results.push({
                id:         highlightId(filePath, lineIdx, text),
                text,
                context:    context !== text ? context : undefined,
                color:      classifyHexColor(hex),
                sourceFile: filePath,
                sourceLine: lineIdx,
                tags:       [],
                createdAt:  now,
                updatedAt:  now,
            });
        }

        // ── <mark class="hltr-COLOR"> (Highlightr with custom CSS snippet) ─
        const classColorMap: Record<string, HighlightColor> = {
            yellow: 'yellow', orange: 'yellow',
            pink: 'pink', red: 'pink', magenta: 'pink', purple: 'pink',
            blue: 'blue', cyan: 'blue', indigo: 'blue',
            green: 'green', lime: 'green', teal: 'green',
        };
        const classRe = /<mark\s+class="hltr-(\w+)"[^>]*>(.*?)<\/mark>/gi;
        while ((m = classRe.exec(line)) !== null) {
            const colorKey = m[1]!.toLowerCase();
            const text     = m[2]!.replace(/<[^>]+>/g, '').trim();
            if (!text) continue;
            const context = stripMarks(line);
            results.push({
                id:         highlightId(filePath, lineIdx, text),
                text,
                context:    context !== text ? context : undefined,
                color:      classColorMap[colorKey] ?? 'yellow',
                sourceFile: filePath,
                sourceLine: lineIdx,
                tags:       [],
                createdAt:  now,
                updatedAt:  now,
            });
        }
    }

    return results;
}
