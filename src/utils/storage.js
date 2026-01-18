// IndexedDB Storage Manager for Archives

const DB_NAME = 'ThreadsSweeperDB';
const DB_VERSION = 1;
const STORE_NAME = 'archives';

export class StorageManager {
  constructor() {
    this.db = null;
    this.initPromise = this.initDB();
  }

  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB open error:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create archives store
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('username', 'username', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  async ensureDB() {
    if (!this.db) {
      await this.initPromise;
    }
    return this.db;
  }

  async saveArchive(archive) {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.put(archive);

      request.onsuccess = () => {
        resolve(archive.id);
      };

      request.onerror = () => {
        console.error('Error saving archive:', request.error);
        reject(request.error);
      };
    });
  }

  async getArchive(id) {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        console.error('Error getting archive:', request.error);
        reject(request.error);
      };
    });
  }

  async getAllArchives() {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.getAll();

      request.onsuccess = () => {
        // Sort by timestamp descending (newest first)
        const archives = request.result || [];
        archives.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        resolve(archives);
      };

      request.onerror = () => {
        console.error('Error getting all archives:', request.error);
        reject(request.error);
      };
    });
  }

  async getArchivesByUsername(username) {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('username');

      const request = index.getAll(username);

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        console.error('Error getting archives by username:', request.error);
        reject(request.error);
      };
    });
  }

  async deleteArchive(id) {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.delete(id);

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        console.error('Error deleting archive:', request.error);
        reject(request.error);
      };
    });
  }

  async clearAllArchives() {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.clear();

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        console.error('Error clearing archives:', request.error);
        reject(request.error);
      };
    });
  }

  async getArchiveCount() {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      const request = store.count();

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  async exportAllData() {
    const archives = await this.getAllArchives();
    return JSON.stringify(archives, null, 2);
  }

  async importData(jsonString) {
    const archives = JSON.parse(jsonString);

    for (const archive of archives) {
      await this.saveArchive(archive);
    }

    return archives.length;
  }
}
