import { App, PluginSettingTab, Setting } from 'obsidian';
import type VLLPlugin from './main';
import { t } from './i18n';
import type { ProviderProfile, VLLSettings } from './types';

// ===== Provider 預設值（首次切換時使用） =====

export const PROVIDER_DEFAULTS: Record<string, ProviderProfile> = {
    openai:     { baseUrl: 'https://api.openai.com/v1',                               apiKey: '', modelFast: 'gpt-4o-mini',             modelPowerful: 'gpt-4o' },
    gemini:     { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',  apiKey: '', modelFast: 'gemini-2.0-flash',        modelPowerful: 'gemini-2.5-pro-exp-03-25' },
    openrouter: { baseUrl: 'https://openrouter.ai/api/v1',                            apiKey: '', modelFast: 'google/gemini-flash-1.5',  modelPowerful: 'anthropic/claude-3.5-sonnet' },
    ollama:     { baseUrl: 'http://localhost:11434/v1',                                apiKey: '', modelFast: 'llama3.2',                modelPowerful: '' },
    custom:     { baseUrl: '',                                                          apiKey: '', modelFast: '',                        modelPowerful: '' },
};

// ===== 預設值 =====

export const DEFAULT_SETTINGS: VLLSettings = {
    // 一般
    uiLanguage: 'auto',

    // 字典
    dictSource:    'jisho',
    localDictPath: '',
    vocabFolder:   'Vocabulary',

    // LLM
    selectedProvider:       'openai',
    providerProfiles:       {},
    llmBaseUrl:             'https://api.openai.com/v1',
    llmApiKey:              '',
    llmModelFast:           'gpt-4o-mini',
    llmModelPowerful:       '',
    annotationLanguage:     'ja',
    annotationSystemPrompt: '',
    annotationBatchSize:    3,

    // 跟讀
    shadowingOutputFolder: 'Shadowing',
    defaultSubtitleLang:   'en',
    subtitleMergeGap:      1.5,
    maxLineLength:         80,

    // 外部工具
    ytdlpPath:     'yt-dlp',
    whisperPath:   'whisperx',
    whisperModel:  'large-v3',
    whisperDevice: 'auto',
};

// ===== 設定頁 =====

export class VLLSettingTab extends PluginSettingTab {

    constructor(app: App, private plugin: VLLPlugin) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: t('settings.title') });

        this.renderGeneral(containerEl);
        this.renderDict(containerEl);
        this.renderAI(containerEl);
        this.renderFlashcard(containerEl);
        this.renderShadowing(containerEl);
        this.renderTools(containerEl);
    }

    // ── 一般 ──────────────────────────────────────────────────────────────

    private renderGeneral(el: HTMLElement) {
        el.createEl('h3', { text: t('settings.general.title') });

        new Setting(el)
            .setName(t('settings.general.language'))
            .setDesc(t('settings.general.languageDesc'))
            .addDropdown(dd => dd
                .addOption('auto',  t('settings.general.langAuto'))
                .addOption('en',    t('settings.general.langEn'))
                .addOption('zh-TW', t('settings.general.langZhTW'))
                .addOption('zh-CN', t('settings.general.langZhCN'))
                .setValue(this.plugin.settings.uiLanguage)
                .onChange(async v => {
                    this.plugin.settings.uiLanguage = v as VLLSettings['uiLanguage'];
                    await this.plugin.saveSettings();
                    // 重新渲染設定頁以反映語言切換
                    this.display();
                })
            );
    }

    // ── 字典 ──────────────────────────────────────────────────────────────

    private renderDict(el: HTMLElement) {
        el.createEl('h3', { text: t('settings.dict.title') });

        new Setting(el)
            .setName(t('settings.dict.source'))
            .setDesc(t('settings.dict.sourceDesc'))
            .addDropdown(dd => dd
                .addOption('none',   t('settings.dict.srcNone'))
                .addOption('jisho',  t('settings.dict.srcJisho'))
                .addOption('weblio', t('settings.dict.srcWeblio'))
                .addOption('youdao', t('settings.dict.srcYoudao'))
                .addOption('google', t('settings.dict.srcGoogle'))
                .setValue(this.plugin.settings.dictSource)
                .onChange(async v => {
                    this.plugin.settings.dictSource = v as VLLSettings['dictSource'];
                    await this.plugin.saveSettings();
                })
            );

        new Setting(el)
            .setName(t('settings.dict.vocabNote'))
            .setDesc(t('settings.dict.vocabNoteDesc'))
            .addText(text => text
                .setPlaceholder('Vocabulary')
                .setValue(this.plugin.settings.vocabFolder)
                .onChange(async v => {
                    this.plugin.settings.vocabFolder = v.trim();
                    await this.plugin.saveSettings();
                })
            );
    }

    // ── LLM ───────────────────────────────────────────────────────────────

    private renderAI(el: HTMLElement) {
        el.createEl('h3', { text: t('settings.ai.title') });

        // 供應商下拉選單
        new Setting(el)
            .setName(t('settings.ai.provider'))
            .setDesc(t('settings.ai.providerDesc'))
            .addDropdown(dd => {
                dd.addOption('openai',     t('settings.ai.provOpenAI'));
                dd.addOption('gemini',     t('settings.ai.provGemini'));
                dd.addOption('openrouter', t('settings.ai.provOpenRouter'));
                dd.addOption('ollama',     t('settings.ai.provOllama'));
                dd.addOption('custom',     t('settings.ai.provCustom'));
                dd.setValue(this.plugin.settings.selectedProvider);
                dd.onChange(async newProvider => {
                    // 儲存目前供應商的設定
                    this.saveCurrentProfile();
                    // 切換到新供應商
                    this.plugin.settings.selectedProvider = newProvider;
                    const saved    = this.plugin.settings.providerProfiles[newProvider];
                    const defaults = PROVIDER_DEFAULTS[newProvider] ?? { baseUrl: '', apiKey: '', modelFast: '', modelPowerful: '' };
                    const profile  = saved ?? defaults;
                    this.plugin.settings.llmBaseUrl       = profile.baseUrl;
                    this.plugin.settings.llmApiKey        = profile.apiKey;
                    this.plugin.settings.llmModelFast     = profile.modelFast;
                    this.plugin.settings.llmModelPowerful = profile.modelPowerful;
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        new Setting(el)
            .setName(t('settings.ai.baseUrl'))
            .setDesc(t('settings.ai.baseUrlDesc'))
            .addText(text => text
                .setPlaceholder('https://api.openai.com/v1')
                .setValue(this.plugin.settings.llmBaseUrl)
                .onChange(async v => {
                    this.plugin.settings.llmBaseUrl = v.trim();
                    this.saveCurrentProfile();
                    await this.plugin.saveSettings();
                })
            );

        new Setting(el)
            .setName(t('settings.ai.apiKey'))
            .setDesc(t('settings.ai.apiKeyDesc'))
            .addText(text => {
                text.inputEl.type = 'password';
                text
                    .setPlaceholder('sk-...')
                    .setValue(this.plugin.settings.llmApiKey)
                    .onChange(async v => {
                        this.plugin.settings.llmApiKey = v.trim();
                        this.saveCurrentProfile();
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(el)
            .setName(t('settings.ai.modelFast'))
            .setDesc(t('settings.ai.modelFastDesc'))
            .addText(text => text
                .setPlaceholder('gpt-4o-mini')
                .setValue(this.plugin.settings.llmModelFast)
                .onChange(async v => {
                    this.plugin.settings.llmModelFast = v.trim();
                    this.saveCurrentProfile();
                    await this.plugin.saveSettings();
                })
            );

        new Setting(el)
            .setName(t('settings.ai.modelPowerful'))
            .setDesc(t('settings.ai.modelPowerfulDesc'))
            .addText(text => text
                .setPlaceholder('gpt-4o')
                .setValue(this.plugin.settings.llmModelPowerful)
                .onChange(async v => {
                    this.plugin.settings.llmModelPowerful = v.trim();
                    this.saveCurrentProfile();
                    await this.plugin.saveSettings();
                })
            );

        new Setting(el)
            .setName(t('settings.ai.annotationLang'))
            .setDesc(t('settings.ai.annotationLangDesc'))
            .addDropdown(dd => {
                dd.addOption('ja', t('settings.ai.langJa'));
                dd.addOption('custom', t('settings.ai.langCustom'));
                dd.setValue(this.plugin.settings.annotationLanguage);
                dd.onChange(async v => {
                    this.plugin.settings.annotationLanguage = v;
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        if (this.plugin.settings.annotationLanguage === 'custom') {
            new Setting(el)
                .setName(t('settings.ai.customPrompt'))
                .setDesc(t('settings.ai.customPromptDesc'))
                .addTextArea(ta => ta
                    .setPlaceholder('You are a language teacher...')
                    .setValue(this.plugin.settings.annotationSystemPrompt)
                    .onChange(async v => {
                        this.plugin.settings.annotationSystemPrompt = v;
                        await this.plugin.saveSettings();
                    })
                );
        }

        // ── 進階設定（折疊） ──────────────────────────────────────────────
        const details = el.createEl('details', { cls: 'vll-advanced-section' });
        details.createEl('summary', {
            text: t('settings.ai.advanced'),
            cls:  'vll-advanced-summary',
        });

        new Setting(details)
            .setName(t('settings.ai.batchSize'))
            .setDesc(t('settings.ai.batchSizeDesc'))
            .addSlider(sl => sl
                .setLimits(1, 20, 1)
                .setValue(this.plugin.settings.annotationBatchSize)
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.annotationBatchSize = v;
                    await this.plugin.saveSettings();
                })
            )
            .addExtraButton(btn => btn
                .setIcon('reset')
                .setTooltip(t('settings.ai.batchSizeReset'))
                .onClick(async () => {
                    this.plugin.settings.annotationBatchSize = 3;
                    await this.plugin.saveSettings();
                    this.display();
                })
            );
    }

    /** 將目前作用中的設定儲存回 providerProfiles[selectedProvider] */
    private saveCurrentProfile(): void {
        const provider = this.plugin.settings.selectedProvider;
        this.plugin.settings.providerProfiles[provider] = {
            baseUrl:       this.plugin.settings.llmBaseUrl,
            apiKey:        this.plugin.settings.llmApiKey,
            modelFast:     this.plugin.settings.llmModelFast,
            modelPowerful: this.plugin.settings.llmModelPowerful,
        };
    }

    // ── 閃卡 ──────────────────────────────────────────────────────────────

    private renderFlashcard(el: HTMLElement) {
        el.createEl('h3', { text: t('settings.flashcard.title') });

        // 閃卡資料現在存在生詞本資料夾（vocabFolder），無需獨立設定
    }

    // ── 跟讀 ──────────────────────────────────────────────────────────────

    private renderShadowing(el: HTMLElement) {
        el.createEl('h3', { text: t('settings.shadowing.title') });

        new Setting(el)
            .setName(t('settings.shadowing.outputFolder'))
            .setDesc(t('settings.shadowing.outputDesc'))
            .addText(text => text
                .setPlaceholder('Shadowing')
                .setValue(this.plugin.settings.shadowingOutputFolder)
                .onChange(async v => {
                    this.plugin.settings.shadowingOutputFolder = v.trim();
                    await this.plugin.saveSettings();
                })
            );

        new Setting(el)
            .setName(t('settings.shadowing.subtitleLang'))
            .setDesc(t('settings.shadowing.subtitleLangDesc'))
            .addText(text => text
                .setPlaceholder('en')
                .setValue(this.plugin.settings.defaultSubtitleLang)
                .onChange(async v => {
                    this.plugin.settings.defaultSubtitleLang = v.trim() || 'en';
                    await this.plugin.saveSettings();
                })
            );

        new Setting(el)
            .setName(t('settings.shadowing.mergeGap'))
            .setDesc(t('settings.shadowing.mergeGapDesc'))
            .addSlider(sl => sl
                .setLimits(0, 3, 0.1)
                .setValue(this.plugin.settings.subtitleMergeGap)
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.subtitleMergeGap = v;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(el)
            .setName(t('settings.shadowing.maxLine'))
            .setDesc(t('settings.shadowing.maxLineDesc'))
            .addSlider(sl => sl
                .setLimits(40, 120, 5)
                .setValue(this.plugin.settings.maxLineLength)
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.maxLineLength = v;
                    await this.plugin.saveSettings();
                })
            );
    }

    // ── 外部工具 ──────────────────────────────────────────────────────────

    private renderTools(el: HTMLElement) {
        el.createEl('h3', { text: t('settings.tools.title') });

        el.createEl('p', {
            text: t('settings.tools.toolsDesc'),
            cls: 'setting-item-description',
        });

        new Setting(el)
            .setName(t('settings.tools.ytdlpPath'))
            .setDesc(t('settings.tools.ytdlpDesc'))
            .addText(text => text
                .setPlaceholder('yt-dlp')
                .setValue(this.plugin.settings.ytdlpPath)
                .onChange(async v => {
                    this.plugin.settings.ytdlpPath = v.trim() || 'yt-dlp';
                    await this.plugin.saveSettings();
                })
            );

        new Setting(el)
            .setName(t('settings.tools.whisperPath'))
            .setDesc(t('settings.tools.whisperDesc'))
            .addText(text => text
                .setPlaceholder('whisperx')
                .setValue(this.plugin.settings.whisperPath)
                .onChange(async v => {
                    this.plugin.settings.whisperPath = v.trim() || 'whisperx';
                    await this.plugin.saveSettings();
                })
            );

        new Setting(el)
            .setName(t('settings.tools.whisperModel'))
            .setDesc(t('settings.tools.whisperModelDesc'))
            .addDropdown(dd => dd
                .addOption('tiny',     'tiny（最快）')
                .addOption('base',     'base')
                .addOption('small',    'small（無 GPU 推薦）')
                .addOption('medium',   'medium')
                .addOption('large',    'large')
                .addOption('large-v2', 'large-v2')
                .addOption('large-v3', 'large-v3（有 GPU 推薦）')
                .setValue(this.plugin.settings.whisperModel)
                .onChange(async v => {
                    this.plugin.settings.whisperModel = v as VLLSettings['whisperModel'];
                    await this.plugin.saveSettings();
                })
            );

        new Setting(el)
            .setName(t('settings.tools.whisperDevice'))
            .setDesc(t('settings.tools.whisperDeviceDesc'))
            .addDropdown(dd => dd
                .addOption('auto', 'auto（自動）')
                .addOption('cuda', 'cuda（NVIDIA GPU）')
                .addOption('cpu',  'cpu')
                .setValue(this.plugin.settings.whisperDevice)
                .onChange(async v => {
                    this.plugin.settings.whisperDevice = v as VLLSettings['whisperDevice'];
                    await this.plugin.saveSettings();
                })
            );

        // 安裝說明
        el.createEl('h3', { text: t('settings.tools.installGuide') });
        const guide = el.createDiv({ cls: 'vll-install-guide' });
        guide.innerHTML = `
            <strong>${t('settings.tools.ytdlpInstall')}</strong><br>
            Windows: <code>winget install yt-dlp</code><br>
            Mac/Linux: <code>pip install yt-dlp</code>
            <br><br>
            <strong>${t('settings.tools.whisperInstall')}</strong><br>
            <code>uv tool install whisperx</code>
            <br><br>
            <strong>${t('settings.tools.fwInstall')}</strong><br>
            <code>uv tool install faster-whisper</code>
        `;
    }
}
