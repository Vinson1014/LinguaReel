import { DB_NAME, DB_VERSION, STORE_HIGHLIGHTS } from '../constants';
import type { HighlightNote } from '../types';

/**
 * IndexedDB 包裝層
 *
 * 僅保留 highlights store — 高亮的 AI 結果（翻譯、深度研究）
 * 生詞 / 閃卡排程已改為 Markdown-first，存在 vault 檔案的 frontmatter
 */
export class VLLDatabase {

    private db: IDBDatabase | null = null;

    async open(): Promise<void> {
        if (this.db) return;
        this.db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_HIGHLIGHTS)) {
                    const hs = db.createObjectStore(STORE_HIGHLIGHTS, { keyPath: 'id' });
                    hs.createIndex('sourceFile', 'sourceFile', { unique: false });
                    hs.createIndex('color',      'color',      { unique: false });
                    hs.createIndex('createdAt',  'createdAt',  { unique: false });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
    }

    close(): void {
        this.db?.close();
        this.db = null;
    }

    // ===== 高亮筆記 CRUD =====

    async getHighlight(id: string): Promise<HighlightNote | undefined> {
        return this.get<HighlightNote>(STORE_HIGHLIGHTS, id);
    }

    async getAllHighlights(): Promise<HighlightNote[]> {
        return this.getAll<HighlightNote>(STORE_HIGHLIGHTS);
    }

    async getHighlightsByFile(sourceFile: string): Promise<HighlightNote[]> {
        await this.open();
        return new Promise<HighlightNote[]>((resolve, reject) => {
            const tx      = this.db!.transaction(STORE_HIGHLIGHTS, 'readonly');
            const index   = tx.objectStore(STORE_HIGHLIGHTS).index('sourceFile');
            const req     = index.getAll(IDBKeyRange.only(sourceFile));
            req.onsuccess = () => resolve(req.result as HighlightNote[]);
            req.onerror   = () => reject(req.error);
        });
    }

    async putHighlight(entry: HighlightNote): Promise<void> {
        return this.put(STORE_HIGHLIGHTS, entry);
    }

    async deleteHighlight(id: string): Promise<void> {
        return this.delete(STORE_HIGHLIGHTS, id);
    }

    // ===== 底層工具 =====

    private async get<T>(storeName: string, key: string): Promise<T | undefined> {
        await this.open();
        return new Promise<T | undefined>((resolve, reject) => {
            const req     = this.db!.transaction(storeName, 'readonly').objectStore(storeName).get(key);
            req.onsuccess = () => resolve(req.result as T | undefined);
            req.onerror   = () => reject(req.error);
        });
    }

    private async getAll<T>(storeName: string): Promise<T[]> {
        await this.open();
        return new Promise<T[]>((resolve, reject) => {
            const req     = this.db!.transaction(storeName, 'readonly').objectStore(storeName).getAll();
            req.onsuccess = () => resolve(req.result as T[]);
            req.onerror   = () => reject(req.error);
        });
    }

    private async put(storeName: string, value: unknown): Promise<void> {
        await this.open();
        return new Promise<void>((resolve, reject) => {
            const req     = this.db!.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
            req.onsuccess = () => resolve();
            req.onerror   = () => reject(req.error);
        });
    }

    private async delete(storeName: string, key: string): Promise<void> {
        await this.open();
        return new Promise<void>((resolve, reject) => {
            const req     = this.db!.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
            req.onsuccess = () => resolve();
            req.onerror   = () => reject(req.error);
        });
    }
}
