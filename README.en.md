<div align="center">

# LinguaReel

*An AI-powered language learning plugin for Obsidian*

[![Platform](https://img.shields.io/badge/Obsidian-Plugin-7c3aed?style=flat-square&logo=obsidian&logoColor=white)](https://obsidian.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

**Language / 語言：** [English](README.en.md) · [繁體中文](README.md) · [简体中文](README.zh-CN.md)

*Inspired by [obsidian-English-Made-Easy](https://github.com/PandoraReads/obsidian-English-Made-Easy)*

<!-- TODO: Insert full UI screenshot or Demo GIF (suggested: five panels side by side) -->

</div>

---

Most of LinguaReel's features **depend directly on an LLM** — no dictionary lookups, no annotation, no highlight translation without one. This is an intentional design choice:

| Feature | Description |
|---------|-------------|
| **Dictionary** | LLM generates readings, POS, definitions, examples, and grammar notes in context — not from a static database |
| **Subtitle annotation** | LLM reads each subtitle line and decides which vocabulary is worth learning, then writes corresponding grammar lessons |
| **Highlight research** | LLM deeply analyses text you've marked — going beyond translation to provide contextual interpretation |
| **Language packs** | Guide the LLM's annotation style in plain language without touching any code |

> [!NOTE]
> Video import depends on **yt-dlp** and **Whisper / WhisperX**, both of which are optional. Other AI features are unaffected if they are not installed.

---

## Table of Contents

- [Learning Workflow](#learning-workflow)
- [Five Panels](#five-panels)
- [External Tool Dependencies](#external-tool-dependencies)
- [Installation](#installation)
- [LLM Configuration](#llm-configuration)
- [Other Settings](#other-settings)
- [Data Storage](#data-storage)
- [Language Packs](#language-packs)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Development](#development)
- [Acknowledgements](#acknowledgements)

---

## Learning Workflow

LinguaReel's five panels form a complete immersive learning loop:

```
Import video (ShadowingView)
    ↓
AI subtitle annotation (HomeView → AnnotationPipeline)
    ↓
Look up words while watching (ShadowingView + DictView)
    ↓
Mark difficult points, AI translation & research (HighlightView)
    ↓
FSRS flashcard review (FlashcardView)
```

---

## Five Panels

### Home — Dashboard

<div align="center">
  <img src="docs/screenshot/HomeView.png" width="55%">
</div>

Home is the control centre of the plugin. It shows LLM connection status, total vocabulary count, today's review count, and quick entry points to each module.

The most important feature is **annotation job management**: once you start AI annotation on a video's subtitles, the job runs in the background in batches, and the Home panel shows real-time progress bars and LLM streaming output for each job.

---

### DictView — AI Dictionary

<div align="center">
  <img src="docs/screenshot/DictView.png" width="55%">
</div>

The dictionary is LinguaReel's core entry point. Unlike traditional dictionaries, results are generated **in context** by the LLM in real time — every lookup gives an explanation suited to its actual usage.

**How to use**

| Method | Description |
|--------|-------------|
| Panel search | Type a word directly into the search box |
| Quick lookup | **Ctrl + double-click** any text in any vault note to trigger a lookup with context |

**LLM-generated content includes:** reading, POS, definitions (possibly multiple), example sentence with translation, grammar or usage notes.

After the lookup, click "Add to vocabulary" to create a corresponding `.md` note in `Vocabulary/` for flashcard review.

---

### HighlightView — Highlight Notes

<div align="center">
  <img src="docs/screenshot/HighlightView.png" width="75%">
</div>

While reading or watching subtitles, mark any text you find interesting with Obsidian's standard `==highlight syntax==`. HighlightView automatically scans and centrally manages all such marks.

**AI features (all powered by LLM)**

| Feature | Model | Description |
|---------|-------|-------------|
| Translate | Fast model | Quickly get a translation of the marked text |
| Deep research | Powerful model | Analyse vocabulary, context, and usage — ideal for understanding difficult points |

> [!TIP]
> Translation and research results are persisted — no need to regenerate after restarting Obsidian.

---

### FlashcardView — FSRS Flashcards

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="docs/screenshot/FlashcardView_front.png" width="100%"><br>
        <sub><b>Front</b></sub>
      </td>
      <td align="center">
        <img src="docs/screenshot/FlashcardView_back.png" width="100%"><br>
        <sub><b>Back</b></sub>
      </td>
    </tr>
  </table>
</div>

Every word added to the vocabulary automatically enters the review queue, scheduled with the **FSRS** (Free Spaced Repetition Scheduler) algorithm — widely regarded as one of the most accurate open-source forgetting-curve predictors available.

**Review flow**

1. See the card front (reading + example hint)
2. Recall the definition, then click "Show answer"
3. Rate with `1`–`4` (or click the buttons)
4. The plugin automatically calculates the next review time based on your rating and the FSRS algorithm

**Rating guide**

| Key | Rating | Description |
|-----|--------|-------------|
| `1` | Again | Completely forgot — repeat immediately |
| `2` | Hard | Remembered, but with difficulty |
| `3` | Good | Normal recall |
| `4` | Easy | Knew it instantly |

All scheduling data (`due`, `stability`, `difficulty`, etc.) is stored directly in each word's `.md` frontmatter — no external database, syncs and backs up with your vault.

---

### ShadowingView — Shadowing Workshop

<div align="center">
  <img src="docs/screenshot/ShadowingView.gif" width="85%">
</div>

The Shadowing Workshop is the starting point of the entire learning flow and LinguaReel's most central experience.

**Supported video sources**

| Source | How to use |
|--------|-----------|
| Local video | Reference with `![[video.mp4]]` wikilink format in a note (`file:///` is not supported) |
| YouTube | Paste the video URL — embedded via the YouTube IFrame API |

**Subtitle features**
- Subtitles automatically sync with video playback; the current subtitle block is highlighted
- Playback speed: 0.8× / 1.0× / 1.25×
- Mode toggle: **Shadowing mode** (all subtitles visible) / **Dictation mode** (subtitles hidden — listen first, then reveal)

**Word lookup**: Ctrl + click any word in the subtitles to open a popup with dictionary lookup (triggers DictView with subtitle context) and Add to vocabulary.

**Annotated version**: If AI annotation has been run on the note, switch to the annotated version to show LLM-generated translations and grammar lessons below each subtitle line.

---

## External Tool Dependencies

> [!NOTE]
> Both tools below are **optional**. If not installed, you can paste subtitles manually or use videos that already have subtitles — all other AI features are completely unaffected.

### yt-dlp

[yt-dlp](https://github.com/yt-dlp/yt-dlp) is an open-source video download tool that supports YouTube and hundreds of other video sites. LinguaReel uses it to:
- Download embedded subtitles from YouTube videos (`.vtt` format)
- Download the video itself for local playback (optional)

**Installation**: Go to [yt-dlp Releases](https://github.com/yt-dlp/yt-dlp/releases/latest) and download the executable for your platform (`yt-dlp.exe` / `yt-dlp_macos` / `yt-dlp`). Place it anywhere and enter the full path in LinguaReel's settings.

### Whisper / WhisperX

When a video has no existing subtitles, LinguaReel can call a speech recognition model to automatically transcribe audio to subtitles.

- **[Whisper](https://github.com/openai/whisper)**: OpenAI's open-source speech recognition model, multilingual, runs entirely locally with no API key required
- **[WhisperX](https://github.com/m-bain/whisperX)**: Community-enhanced version — faster, supports word-level timestamp alignment and speaker diarization. **Recommended.**

**Prerequisite:** [Python 3.8+](https://www.python.org/downloads/)

```bash
# Install WhisperX (recommended)
pip install whisperx

# Or original Whisper
pip install openai-whisper
```

> [!TIP]
> If you have an NVIDIA GPU, set the device to `cuda` in settings to significantly reduce transcription time.

**Available model sizes**

| Model | Speed | Accuracy | Recommended for |
|-------|-------|----------|-----------------|
| `tiny` | Fastest | Lower | Quick testing |
| `base` | Fast | Average | Daily use (default) |
| `small` | Medium | Good | Balanced choice |
| `medium` | Slow | High | When higher quality is needed |
| `large-v3` | Slowest | Highest | Best quality |

---

## Installation

### Manual

1. Download `main.js`, `manifest.json`, `styles.css` from the [latest release](../../releases/latest)
2. Copy the three files to your vault's `.obsidian/plugins/vll/` folder
3. In Obsidian → **Settings → Community plugins**, enable **LinguaReel**

### From source

```bash
git clone https://github.com/Vinson1014/LinguaReel.git
cd LinguaReel
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, `styles.css` to the plugin folder.

---

## LLM Configuration

Configure in **Settings → LinguaReel → LLM Provider**.

LinguaReel uses two model profiles for different tasks:

| Profile | Purpose | Description |
|---------|---------|-------------|
| **Fast model** | Dictionary, translation, subtitle annotation | Used for all everyday features |
| **Powerful model** | Deep highlight research | Leave blank by default; fill in when needed |

**Supported providers**

| Provider | Fast model (default) | Powerful model |
|----------|---------------------|----------------|
| OpenAI | `gpt-5.4-mini` | (blank) |
| Gemini | `gemini-3-flash-preview` | (blank) |
| OpenRouter | `google/gemini-3-flash-preview` | (blank) |
| Ollama (local) | `gemma4:latest` | (blank) |
| Custom endpoint | any | any |

> [!TIP]
> Choosing Ollama allows fully offline operation with no API key required, but annotation quality depends on the local model's capability.

---

## Other Settings

### Language

| Setting | Options | Description |
|---------|---------|-------------|
| UI language | `auto` / `en` / `zh-TW` / `zh-CN` | Plugin interface language |
| Output language | `auto` / `en` / `zh-TW` / `zh-CN` | Language used in LLM responses (translations, definitions) |
| Annotation language | `ja` / `ko` / `zh` / `en` / `fr` / `de` / `es` / `custom` | The target language you are learning |

### Folder Paths

| Setting | Default | Description |
|---------|---------|-------------|
| Vocabulary folder | `Vocabulary/` | Where vocabulary `.md` files are stored |
| Shadowing output folder | `Shadowing/` | Where imported video notes are stored |

### Subtitle Processing

| Setting | Default | Description |
|---------|---------|-------------|
| Subtitle merge gap | `1.5 s` | Gap between lines before starting a new block |
| Max line length | `80 chars` | Characters before wrapping to a new block |

---

## Data Storage

LinguaReel uses a **Markdown-first** architecture — data is stored as standard `.md` files inside your vault, backed up and synced with your vault.

Each vocabulary word corresponds to one `.md` file, with FSRS scheduling fields stored in the frontmatter:

```yaml
---
word: 難しい
reading: むずかしい
pos: adjective
definitions:
  - difficult
  - hard
example: "この問題は難しい。"
example_translation: "This problem is difficult."
source: "Shadowing/video.md"
tags: []
created_at: 2024-01-01
due: 2024-01-04
stability: 3.5
difficulty: 0.3
reps: 2
lapses: 0
state: 2
last_review: 2024-01-01
---
```

AI translation and research results for highlights are stored in local IndexedDB and are not written to vault files.

---

## Language Packs

The annotation pipeline uses **language packs** to tailor the LLM's teaching style for each learning language. Language packs are plain `.md` files stored in your vault:

```
<vault>/LinguaReel/language-packs/
├── ja.md   ← Japanese pack
├── ko.md   ← Korean pack
├── zh.md
├── en.md
└── ...
```

Seven default packs (`ja`, `ko`, `zh`, `en`, `fr`, `de`, `es`) are created automatically on first launch.

You can directly edit a pack's body to "tell" the LLM in plain language what to prioritise annotating and how to style translations. Changes take effect on the next annotation run — no plugin restart required.

---

## Keyboard Shortcuts

| Context | Key | Action |
|---------|-----|--------|
| Anywhere in vault | Ctrl + double-click | Look up selected text in DictView |
| FlashcardView (after answer shown) | `1` | Rate: Again |
| FlashcardView (after answer shown) | `2` | Rate: Hard |
| FlashcardView (after answer shown) | `3` | Rate: Good |
| FlashcardView (after answer shown) | `4` | Rate: Easy |

---

## Development

```bash
npm install       # Install dependencies
npm run dev       # Watch mode — auto-rebuilds on save
npm run build     # Production build (includes tsc type check)
npm run lint      # ESLint check
```

Build tool: **esbuild** + **tsc** (`target: ES2018`).  
Entry point: `src/main.ts` → bundled to `main.js`.

---

## Acknowledgements

- Inspired by [obsidian-English-Made-Easy](https://github.com/PandoraReads/obsidian-English-Made-Easy)
- Spaced repetition algorithm: [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)
- Video download: [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- Speech recognition: [Whisper](https://github.com/openai/whisper) / [WhisperX](https://github.com/m-bain/whisperX)
