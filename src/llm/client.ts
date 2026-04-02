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

    /**
     * 串流版 chat — 使用 fetch() + SSE，每個 token 呼叫一次 onToken(accumulated)。
     * 注意：直接用 fetch() 而非 requestUrl，不走 Obsidian proxy，但支援 streaming。
     */
    async chatStream(
        messages:  ChatMessage[],
        profile:   'fast' | 'powerful' = 'fast',
        onToken:   (accumulated: string) => void,
        signal?:   AbortSignal,
    ): Promise<string> {
        const baseUrl = this.s.llmBaseUrl.trim() || 'https://api.openai.com/v1';
        const model   = this.resolveModel(profile);
        const apiKey  = this.s.llmApiKey.trim();

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({ model, messages, stream: true }),
            signal,
        });

        if (!response.ok || !response.body) {
            const text = await response.text().catch(() => '');
            throw new Error(`LLM stream error ${response.status}: ${text.slice(0, 200)}`);
        }

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        let buffer      = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const payload = line.slice(6).trim();
                    if (payload === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(payload) as {
                            choices?: Array<{ delta?: { content?: string } }>;
                        };
                        const token = parsed.choices?.[0]?.delta?.content;
                        if (token) {
                            accumulated += token;
                            onToken(accumulated);
                        }
                    } catch { /* 忽略格式不符的行 */ }
                }
            }
        } finally {
            reader.releaseLock();
        }

        return accumulated;
    }

    /**
     * 串流版 chatJSON — 完成後解析 JSON，過程中呼叫 onToken 顯示即時輸出。
     */
    async chatJSONStream<T>(
        messages: ChatMessage[],
        profile:  'fast' | 'powerful' = 'fast',
        onToken:  (accumulated: string) => void,
        signal?:  AbortSignal,
    ): Promise<T> {
        const raw  = await this.chatStream(messages, profile, onToken, signal);
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
