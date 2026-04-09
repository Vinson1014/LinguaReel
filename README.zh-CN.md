<div align="center">

# LinguaReel

*一款以 AI 为核心的 Obsidian 语言学习插件*

[![Platform](https://img.shields.io/badge/Obsidian-Plugin-7c3aed?style=flat-square&logo=obsidian&logoColor=white)](https://obsidian.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

**Language / 语言：** [English](README.en.md) · [繁體中文](README.md) · [简体中文](README.zh-CN.md)

*灵感来自 [obsidian-English-Made-Easy](https://github.com/PandoraReads/obsidian-English-Made-Easy)*

<!-- TODO: 插入整体 UI 截图或 Demo GIF（建议：并排显示五个面板） -->

</div>

---

LinguaReel 的大多数功能**直接依赖 LLM**，没有 LLM 就没有查词、没有标注、没有高亮翻译。这是刻意的设计选择：

| 功能 | 说明 |
|------|------|
| **查词** | LLM 依照上下文即时生成读音、词性、定义、例句和语法说明，而非固定词典 |
| **字幕标注** | LLM 逐行阅读字幕，自行判断哪些词汇值得学习，并写出对应的语法课程 |
| **高亮研究** | LLM 对你标记的文字进行深度解析，不只是翻译，而是提供语境诠释 |
| **语言包** | 用自然语言直接「指导」LLM 的标注风格，不需要修改任何代码 |

> [!NOTE]
> 视频导入功能依赖 **yt-dlp** 和 **Whisper / WhisperX**，均为可选工具，未安装不影响其他 AI 功能。

---

## 目录

- [学习流程](#学习流程)
- [五大面板](#五大面板)
- [外部工具依赖](#外部工具依赖)
- [安装插件](#安装插件)
- [LLM 设置](#llm-设置)
- [其他设置](#其他设置)
- [数据存储](#数据存储)
- [语言包](#语言包)
- [键盘快捷键](#键盘快捷键)
- [开发](#开发)
- [致谢](#致谢)

---

## 学习流程

LinguaReel 的五个面板共同构成一套完整的沉浸式学习循环：

```
导入视频（ShadowingView）
    ↓
AI 标注字幕（HomeView → AnnotationPipeline）
    ↓
边看视频边查生词（ShadowingView + DictView）
    ↓
标记难点，AI 翻译与研究（HighlightView）
    ↓
FSRS 闪卡复习生词（FlashcardView）
```

---

## 五大面板

### Home — 仪表板

<div align="center">
  <img src="docs/screenshot/HomeView.png" width="55%">
</div>

Home 是整个插件的控制中心，显示 LLM 连接状态、生词总数、今日待复习数量，以及进入各模块的快速入口。

最重要的功能是**标注任务管理**：当你对一部视频字幕启动 AI 标注后，任务会在后台批量执行，Home 面板实时显示每项任务的进度条与 LLM 流式输出预览。

---

### DictView — AI 查词

<div align="center">
  <img src="docs/screenshot/DictView.png" width="55%">
</div>

查词是 LinguaReel 的核心入口。不同于传统词典，LinguaReel 的查词结果由 LLM **依照当前语境**即时生成，每次查询都能得到与使用情境相符的解释。

**使用方式**

| 方式 | 说明 |
|------|------|
| 面板搜索 | 在面板搜索框直接输入单词 |
| 快速查词 | 在 vault 任何笔记中 **Ctrl + 双击**文字，自动带入上下文触发查词 |

**LLM 生成的内容包括：** 读音（Reading）、词性（POS）、定义（可能多条）、例句及其翻译、语法或惯用说明（Notes）。

查词完成后，一键「加入生词本」即可在 `Vocabulary/` 文件夹创建对应的 `.md` 笔记，供闪卡复习使用。

---

### HighlightView — 高亮笔记

<div align="center">
  <img src="docs/screenshot/HighlightView.png" width="75%">
</div>

在阅读或观看字幕时，对任何感兴趣的文字使用 Obsidian 标准的 `==高亮语法==` 标记，HighlightView 就会自动扫描并集中管理这些标记。

**AI 功能（均由 LLM 执行）**

| 功能 | 使用模型 | 说明 |
|------|---------|------|
| 翻译 | 快速模型 | 快速获取该段文字的翻译 |
| 深度研究 | 强力模型 | 分析词汇、语境、惯用法，适合深入理解难点 |

> [!TIP]
> 翻译与研究结果会持久化存储，重开 Obsidian 后不需重新生成。

---

### FlashcardView — FSRS 闪卡

<div align="center">
  <table>
    <tr>
      <td align="center">
        <img src="docs/screenshot/FlashcardView_front.png" width="100%"><br>
        <sub><b>正面</b></sub>
      </td>
      <td align="center">
        <img src="docs/screenshot/FlashcardView_back.png" width="100%"><br>
        <sub><b>背面</b></sub>
      </td>
    </tr>
  </table>
</div>

所有加入生词本的单词都会自动进入闪卡复习队列，采用 **FSRS**（Free Spaced Repetition Scheduler）算法排程，是目前公认遗忘曲线预测准确度最高的开源算法之一。

**复习流程**

1. 看到单词正面（读音 + 例句提示）
2. 回想定义后点击「显示答案」
3. 按 `1`–`4` 评分（或点击按钮）
4. 插件根据评分和 FSRS 算法自动计算下次复习时间

**评分说明**

| 按键 | 评分 | 说明 |
|------|------|------|
| `1` | Again | 完全不记得，立即重复 |
| `2` | Hard | 记得但很吃力 |
| `3` | Good | 正常回想起来 |
| `4` | Easy | 一眼就知道 |

所有排程数据（`due`、`stability`、`difficulty` 等）直接存在每个生词 `.md` 的 frontmatter，不依赖外部数据库，可以随 vault 一起同步或备份。

---

### ShadowingView — 跟读工坊

<div align="center">
  <img src="docs/screenshot/ShadowingView.gif" width="85%">
</div>

跟读工坊是整个学习流程的起点，也是 LinguaReel 最核心的体验。

**支持的视频来源**

| 来源 | 使用方式 |
|------|---------|
| 本地视频 | 在笔记中用 `![[video.mp4]]` wikilink 格式引用（不支持 `file:///`） |
| YouTube | 粘贴视频链接，通过 YouTube IFrame API 嵌入播放 |

**字幕功能**
- 字幕与视频进度自动同步，当前播放位置的字幕块自动高亮
- 播放速度：0.8× / 1.0× / 1.25×
- 模式切换：**跟读模式**（字幕全显）/ **听写模式**（字幕隐藏，先听后对答案）

**选字查词**：在字幕文字上 Ctrl + 点击任意单词，弹出窗口提供查词（触发 DictView，并自动带入字幕上下文）及加入生词本。

**标注版本**：若已对该笔记执行过 AI 标注，可切换至标注版本，每行字幕下方显示 LLM 生成的翻译与语法课程说明。

---

## 外部工具依赖

> [!NOTE]
> 以下两个工具**均为可选**。未安装时，可以手动粘贴字幕或使用已有字幕的视频，其余 AI 功能完全不受影响。

### yt-dlp

[yt-dlp](https://github.com/yt-dlp/yt-dlp) 是开源的视频下载工具，支持 YouTube 及数百个视频网站。LinguaReel 使用它来：
- 下载 YouTube 视频的内嵌字幕（`.vtt` 格式）
- 下载视频本体供本地播放（可选）

**安装**：前往 [yt-dlp Releases](https://github.com/yt-dlp/yt-dlp/releases/latest) 下载对应平台的可执行文件（`yt-dlp.exe` / `yt-dlp_macos` / `yt-dlp`），放到任意文件夹后在 LinguaReel 设置中填入完整路径即可。

### Whisper / WhisperX

当视频没有现成字幕时，LinguaReel 可呼叫语音识别模型自动转录音频为字幕。

- **[Whisper](https://github.com/openai/whisper)**：OpenAI 开源语音识别模型，支持多语言，完全本地执行，不需 API 密钥
- **[WhisperX](https://github.com/m-bain/whisperX)**：社区强化版本，速度更快、支持词级别时间戳与说话者识别，**建议优先使用**

**前置需求：** [Python 3.8+](https://www.python.org/downloads/)

```bash
# 安装 WhisperX（建议）
pip install whisperx

# 或原版 Whisper
pip install openai-whisper
```

> [!TIP]
> 若有 NVIDIA GPU，可在设置中将设备设为 `cuda`，大幅缩短转录时间。

**可用模型大小**

| 模型 | 速度 | 精准度 | 建议用途 |
|------|------|--------|---------|
| `tiny` | 最快 | 较低 | 快速测试 |
| `base` | 快 | 普通 | 日常使用（默认） |
| `small` | 中等 | 良好 | 平衡选择 |
| `medium` | 慢 | 高 | 要求较高时 |
| `large-v3` | 最慢 | 最高 | 最佳质量 |

---

## 安装插件

### 手动安装

1. 从 [最新 Release](../../releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`
2. 将三个文件复制到 vault 的 `.obsidian/plugins/vll/` 文件夹
3. 在 Obsidian → **设置 → Community plugins** 中启用 **LinguaReel**

### 从源码构建

```bash
git clone https://github.com/Vinson1014/LinguaReel.git
cd LinguaReel
npm install
npm run build
```

再将 `main.js`、`manifest.json`、`styles.css` 复制到插件文件夹。

---

## LLM 设置

在 **设置 → LinguaReel → LLM 提供商** 中设置。

LinguaReel 使用两个模型配置，分别对应不同的任务：

| 配置 | 用途 | 说明 |
|------|------|------|
| **快速模型** | 查词、翻译、字幕标注 | 所有日常功能均使用此模型 |
| **强力模型** | 高亮深度研究 | 默认留空，有需要时再填入 |

**支持的提供商**

| 提供商 | 快速模型（默认） | 强力模型 |
|--------|----------------|---------|
| OpenAI | `gpt-5.4-mini` | （留空） |
| Gemini | `gemini-3-flash-preview` | （留空） |
| OpenRouter | `google/gemini-3-flash-preview` | （留空） |
| Ollama（本地） | `gemma4:latest` | （留空） |
| 自定义端点 | 任意 | 任意 |

> [!TIP]
> 选择 Ollama 可完全离线运作，不需要 API 密钥，但标注质量取决于本地模型能力。

---

## 其他设置

### 语言

| 设置 | 选项 | 说明 |
|------|------|------|
| 界面语言 | `auto` / `en` / `zh-TW` / `zh-CN` | 插件 UI 显示语言 |
| 输出语言 | `auto` / `en` / `zh-TW` / `zh-CN` | LLM 响应使用的语言（翻译、定义） |
| 标注语言 | `ja` / `ko` / `zh` / `en` / `fr` / `de` / `es` / `custom` | 你正在学习的目标语言 |

### 文件夹路径

| 设置 | 默认 | 说明 |
|------|------|------|
| 生词文件夹 | `Vocabulary/` | 生词 `.md` 文件的存储位置 |
| 跟读输出文件夹 | `Shadowing/` | 导入的视频笔记存储位置 |

### 字幕处理

| 设置 | 默认 | 说明 |
|------|------|------|
| 字幕合并间距 | `1.5 秒` | 两行间距超过此值才开新段落 |
| 最大行长 | `80 字符` | 超过此长度自动换段 |

---

## 数据存储

LinguaReel 采用 **Markdown-first** 架构，数据以标准 `.md` 格式存在 vault 里，随 vault 一起备份与同步。

每个生词对应一个 `.md` 文件，FSRS 排程字段存于 frontmatter：

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

高亮的 AI 翻译与研究结果存储在本地 IndexedDB，不写入 vault 文件。

---

## 语言包

标注流程使用**语言包**来针对每种学习语言调整 LLM 的教学风格。语言包是存在 vault 里的普通 `.md` 文件：

```
<vault>/LinguaReel/language-packs/
├── ja.md   ← 日语语言包
├── ko.md   ← 韩语语言包
├── zh.md
├── en.md
└── ...
```

首次启动自动创建 `ja`、`ko`、`zh`、`en`、`fr`、`de`、`es` 七种默认包。

你可以直接编辑语言包的正文，用自然语言「告诉」LLM 要优先标注什么、翻译风格如何。修改后下次标注立即生效，不需要重启插件。

---

## 键盘快捷键

| 情境 | 按键 | 动作 |
|------|------|------|
| vault 任意位置 | Ctrl + 双击 | 在 DictView 查询选取的文字 |
| FlashcardView（答案显示后） | `1` | 评分：Again |
| FlashcardView（答案显示后） | `2` | 评分：Hard |
| FlashcardView（答案显示后） | `3` | 评分：Good |
| FlashcardView（答案显示后） | `4` | 评分：Easy |

---

## 开发

```bash
npm install       # 安装依赖
npm run dev       # 监听模式，保存后自动重新构建
npm run build     # 正式构建（含 tsc 类型检查）
npm run lint      # ESLint 检查
```

构建工具：**esbuild** + **tsc**（`target: ES2018`）。  
入口点：`src/main.ts` → 打包输出 `main.js`。

---

## 致谢

- 灵感来自 [obsidian-English-Made-Easy](https://github.com/PandoraReads/obsidian-English-Made-Easy)
- 间隔重复算法：[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)
- 视频下载：[yt-dlp](https://github.com/yt-dlp/yt-dlp)
- 语音识别：[Whisper](https://github.com/openai/whisper) / [WhisperX](https://github.com/m-bain/whisperX)
