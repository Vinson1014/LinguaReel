# LinguaReel — Obsidian 語言學習插件

## 專案概覽

從零重新開發的 Obsidian 語言學習插件，靈感來自 EME（English Made Easy）。
作者以逆向工程方式仿造 EME 功能邏輯，完整掌控代碼。

- **Plugin ID:** `lingua-reel`
- **Entry point:** `src/main.ts` → bundled to `main.js`
- **Package manager:** npm
- **Bundler:** esbuild（`esbuild.config.mjs`）

```bash
npm run dev     # watch 模式開發
npm run build   # 正式 build（含 tsc type check）
npm run lint    # eslint 檢查
```

---

## 檔案結構

```
src/
├── main.ts              # VLLPlugin 主類別（lifecycle only）
├── constants.ts         # View ID、DB 名稱、事件常數
├── types.ts             # 所有 TS 型別定義
├── settings.ts          # VLLSettings + VLLSettingTab
├── i18n/
│   ├── index.ts         # initI18n() + t(key, vars)
│   └── locales/         # en.ts, zh-TW.ts, zh-CN.ts
├── llm/
│   ├── client.ts        # OpenAI-compatible LLM client（用 Obsidian requestUrl）
│   └── prompts.ts       # DictLookup / Annotation prompts
├── views/
│   ├── HomeView.ts      # Dashboard — LLM 狀態、生詞/待複習數、模組卡片
│   ├── DictView.ts      # 查詞側邊欄 — LLM 查詞 + 加入生詞本
│   ├── HighlightView.ts # 高亮筆記 — 解析 ==text==/<mark>、AI 翻譯/研究
│   ├── FlashcardView.ts # FSRS 閃卡 — 到期佇列、4 評分鍵、365 天熱圖
│   └── ShadowingView.ts # 跟讀工坊 — 可滾動字幕、本地/YouTube 影片、選字 popup
├── core/
│   ├── SubtitleParser.ts
│   ├── YouTubeTranscript.ts
│   ├── YtDlpRunner.ts
│   ├── WhisperRunner.ts
│   ├── NoteGenerator.ts
│   ├── AnnotationFormatter.ts  # 格式化標注行
│   └── AnnotationPipeline.ts   # LLM 批次標注
├── db/
│   ├── database.ts      # IndexedDB — 僅 highlights store
│   └── vocabStorage.ts  # Markdown-first 生詞本 CRUD + FSRS schedule
└── ui/
    ├── ImportModal.ts   # 影片匯入 Modal
    └── AnnotateModal.ts # 標注觸發 Modal + 進度顯示
```

---

## 四大功能模組

1. **DictView** — LLM 查詞（reading、POS、definitions、example、notes），加入生詞本建立 .md
2. **HighlightView** — 解析 `==text==` 和 `<mark>` 高亮，AI 翻譯（fast model）/ 深度研究（powerful model）
3. **FlashcardView** — ts-fsrs 算法，到期佇列，4 評分鍵，interval 預覽，365 天熱圖
4. **ShadowingView** — EME-style 可滾動字幕列表，本地/YouTube 影片，選字彈出 popup（查詞 + 高亮色塊）

---

## 架構決策

### 資料儲存 — Markdown-first
- 每個生詞 = 一個 `.md` 檔，放在 `vocabFolder`（預設 `Vocabulary/`）
- FSRS 欄位存在 YAML frontmatter，用 `app.fileManager.processFrontMatter()` 更新
- 快速讀取用 `metadataCache`（in-memory）
- IndexedDB **只存** highlight AI 結果
- `VocabEntry` 同時是生詞資料和閃卡資料（無獨立 `FlashcardEntry`）

### 本地影片載入
- 用 `![[video.ext]]` wikilink → `metadataCache.getFirstLinkpathDest()` → `vault.getResourcePath(TFile)`
- **不可用** `file:///` URL（Electron CSP 封鎖）

### 關鍵細節
- **i18n**：`initI18n(settings.uiLanguage)` 在 `onload()` 最開頭，UI 文字用 `t('key')`
- **語言偵測**：`window.localStorage.getItem('language')` → 映射到 en/zh-TW/zh-CN
- **HighlightView** 用 `fileScope`（`scope` 是 Obsidian ItemView 保留屬性）
- **tsconfig target**：ES2018（需支援 regex `s` flag）
- **NoteGenerator.generate()** 接受 `Pick<VLLSettings, 'defaultSubtitleLang'>` 最小介面
- **ImportModal** 用 `settings.shadowingOutputFolder`
- **ts-fsrs type cast**：`scheduler.repeat()` 回傳 `IPreview`，用 `unknown as Record<number, {card:Card}>` 繞過
- **ShadowingView 選字**：blocks container 需 `user-select: text; -webkit-user-select: text`
- **LLM client** 用 Obsidian `requestUrl`（不是 fetch）— 支援 proxy
- **vocab context 欄位**：傳入前剔除 `vll-ann-block` HTML，序列化時移除換行並截斷至 300 字元

---

## 開發規範

### 程式碼
- TypeScript `"strict": true`
- `main.ts` 保持最小化（lifecycle only），功能邏輯拆到各模組
- 單一檔案超過 ~300 行考慮拆分
- `async/await` 優先於 promise chains
- 所有 cleanup 用 `this.register*` helpers（registerEvent / registerDomEvent / registerInterval）
- Bundle everything into `main.js`（no unbundled runtime deps）

### Manifest (`manifest.json`)
- 必要欄位：`id`、`name`、`version`（SemVer）、`minAppVersion`、`description`、`isDesktopOnly`
- `id` 發布後不能更改；`minAppVersion` 隨 API 使用同步更新
- Release artifacts 在 plugin 根目錄：`main.js`、`manifest.json`、`styles.css`

### 安全 / 隱私
- 預設本地/離線，網路請求需有明確理由並揭露
- 不可在 vault 外存取檔案
- 不得執行遠端代碼或 auto-update
- 不收集 vault 內容或個人資訊

### 效能
- `onload()` 輕量，重型工作延後初始化
- 批次 disk access，避免過度掃描 vault
- 防抖/節流回應 file system 事件

### UX 文案
- 標題/按鈕用 sentence case
- 導航用箭頭：**Settings → Community plugins**
- UI 文字簡短一致

### 版本發布
- `manifest.json` 的 `version` 用 SemVer，同步更新 `versions.json`
- GitHub release tag 與 version 一致，不加前綴 `v`
- Release 附件：`manifest.json`、`main.js`、`styles.css`

---

## 問題排除

- 插件不載入：確認 `main.js` 和 `manifest.json` 在 plugin 根目錄
- Build 失敗：先 `npm install` 再 `npm run build`
- 指令不出現：確認 `addCommand` 在 `onload` 內，ID 唯一
- Settings 不持久：確認 `loadData`/`saveData` 都有 await
- 本地影片不播放：用 wikilink `![[file.mp4]]`，不支援 `file:///`

---

## 參考

- Obsidian API docs: https://docs.obsidian.md
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
