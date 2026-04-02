import { requestUrl } from 'obsidian';
import type { VLLSettings } from '../types';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * OpenAI-compatible LLM client.
 * Works with OpenAI, Anthropic (via proxy), DeepSeek, Ollama, and any
 * provider that implements the /chat/completions endpoint.
 */
export class LLMClient {

    constructor(private getSettings: () => VLLSettings) {}

    private get s() { return this.getSettings(); }

    private resolveModel(profile: 'fast' | 'powerful'): string {
        if (profile === 'powerful') {
            const m = this.s.llmModelPowerful.trim();
            if (m) return m;
        }
        return this.s.llmModelFast.trim() || 'gpt-4o-mini';
    }

    /**
     * Send a chat completion request.
     * @param messages  The conversation messages.
     * @param profile   'fast' (default) or 'powerful' — controls model selection.
     * @throws Error if the API returns a non-2xx status or an error body.
     */
    async chat(
        messages: ChatMessage[],
        profile: 'fast' | 'powerful' = 'fast',
    ): Promise<string> {
        const baseUrl = this.s.llmBaseUrl.trim() || 'https://api.openai.com/v1';
        const model   = this.resolveModel(profile);
        const apiKey  = this.s.llmApiKey.trim();

        const response = await requestUrl({
            url:    `${baseUrl}/chat/completions`,
            method: 'POST',
            headers: {
                'Content-Type':  'application/json',
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({ model, messages, stream: false }),
            throw: false,
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(
                `LLM API error ${response.status}: ${(response.text ?? '').slice(0, 300)}`
            );
        }

        const data = response.json as {
            choices?: Array<{ message?: { content?: string } }>;
            error?:   { message?: string };
        };

        if (data.error?.message) {
            throw new Error(`LLM error: ${data.error.message}`);
        }

        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error('LLM returned an empty response');
        return content;
    }

    /**
     * Same as chat() but automatically parses the response as JSON.
     * Strips markdown code fences if present (some models wrap JSON in ```json).
     */
    async chatJSON<T>(
        messages: ChatMessage[],
        profile: 'fast' | 'powerful' = 'fast',
    ): Promise<T> {
        const raw  = await this.chat(messages, profile);
        const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
        try {
            return JSON.parse(text) as T;
        } catch {
            throw new Error(`LLM returned invalid JSON:\n${text.slice(0, 300)}`);
        }
    }

    /** Returns true if the minimum required settings are configured. */
    isConfigured(): boolean {
        return !!(this.s.llmModelFast.trim() && this.s.llmBaseUrl.trim());
    }
}
