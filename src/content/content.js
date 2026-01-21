// Content Script for Threads.com/Threads.net
// Handles page interaction, scraping, and blocking

// Check if we need to define the class (first run) or just re-initialize (retry)
if (typeof window.ThreadsSweeperClass === 'undefined') {
  console.log('Threads Sweeper defining class...');

  const MESSAGE_TYPES = {
    GET_PROFILE_INFO: 'GET_PROFILE_INFO',
    BLOCK_FOLLOWERS: 'BLOCK_FOLLOWERS',
    CANCEL_OPERATION: 'CANCEL_OPERATION',
    PROGRESS_UPDATE: 'PROGRESS_UPDATE',
    OPERATION_COMPLETE: 'OPERATION_COMPLETE',
    COLLECTION_COMPLETE: 'COLLECTION_COMPLETE',
    ALL_BLOCKING_COMPLETE: 'ALL_BLOCKING_COMPLETE',
    USER_COLLECTED: 'USER_COLLECTED',
    BLOCK_RESULT: 'BLOCK_RESULT',
    QUEUE_BLOCK_USERS: 'QUEUE_BLOCK_USERS',
    STOP_BLOCKING: 'STOP_BLOCKING',
    PAUSE_BLOCKING: 'PAUSE_BLOCKING',
    RESUME_BLOCKING: 'RESUME_BLOCKING',
    PAUSE_COLLECTION: 'PAUSE_COLLECTION',
    RESUME_COLLECTION: 'RESUME_COLLECTION'
  };

  const SELECTORS = {
    PROFILE_HEADER: 'h1, [data-testid*="profile"], [data-testid*="user-info"], [class*="ProfileHeader"], header, [role="main"]',
    FOLLOWERS_LINK: 'a[href$="/followers"], a[href$="/followers/"], a[href*="/followers?"], [data-testid*="followers"]',
    FOLLOWERS_CONTAINER: '[role="dialog"], [aria-modal="true"], [data-testid*="followers"], [class*="modal"], main, [role="main"]',
    BIO: [
      '[data-testid="profile-bio"]',
      '[data-testid="user-bio"]',
      '[data-testid*="bio"]',
      '[class*="bio"]',
      '[class*="description"]',
      'header + div span[dir="auto"]'
    ]
  };

  class ThreadsSweeper {
    constructor() {
      this.isProcessing = false;
      this.shouldCancel = false;
      this.isPaused = false;
      this.currentProfile = null;

      // Collection session state (manual-scroll based)
      this.isCollecting = false;
      this.collectedUsernames = new Set();
      this.activeProfileUsername = null;
      this.followersContainer = null;
      this.followersScrollHandler = null;
      this.followersObserver = null;

      this.init();
    }

    init() {
      // Listen for messages from popup
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        this.handleMessage(message, sendResponse);
        return true; // Keep the message channel open for async response
      });

      // Initial profile check
      this.checkCurrentProfile();
    }

    async handleMessage(message, sendResponse) {
      switch (message.type) {
        case MESSAGE_TYPES.GET_PROFILE_INFO:
          const profile = await this.getProfileInfo();
          sendResponse({ success: !!profile, profile });
          break;

        case MESSAGE_TYPES.BLOCK_FOLLOWERS:
          this.startBlockingFollowers();
          sendResponse({ success: true });
          break;

        case MESSAGE_TYPES.CANCEL_OPERATION:
          this.shouldCancel = true;
          this.isPaused = false; // Force resume to exit
          sendResponse({ success: true });
          break;

        case MESSAGE_TYPES.PAUSE_BLOCKING:
          this.isPaused = true;
          sendResponse({ success: true });
          break;

        case MESSAGE_TYPES.RESUME_BLOCKING:
          this.isPaused = false;
          sendResponse({ success: true });
          break;

        case MESSAGE_TYPES.PAUSE_COLLECTION:
          this.stopCollectionSession();
          sendResponse({ success: true });
          break;

        case MESSAGE_TYPES.RESUME_COLLECTION:
          this.resumeCollectionSession();
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    }

    checkCurrentProfile() {
      // Check if we're on a profile page
      const path = window.location.pathname;
      const profileMatch = path.match(/^\/@([^/]+)\/?$/);

      if (profileMatch) {
        this.currentUsername = profileMatch[1];
      } else {
        this.currentUsername = null;
      }
    }

    async getProfileInfo() {
      try {
        const path = window.location.pathname;
        // Strictly match /@username or /@username/
        const profileMatch = path.match(/^\/@([^/]+)\/?$/);

        if (!profileMatch) {
          return null;
        }

        const username = profileMatch[1];

        // Wait for profile elements to load
        await this.waitForElement(SELECTORS.PROFILE_HEADER);

        // Try to get profile info from the page
        const profile = {
          username: username,
          followerCount: null,
          profileUrl: `${window.location.origin}/@${username}`,
          bio: this.getBio()
        };

        this.currentProfile = profile;
        return profile;
      } catch (error) {
        console.error('Error getting profile info:', error);
        return null;
      }
    }

    findFirstText(selectors) {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          return element.textContent.trim();
        }
      }
      return null;
    }

    getBio() {
      const ogDescription = document.querySelector('meta[property="og:description"], meta[name="description"]')?.content;
      if (ogDescription) return ogDescription.trim();

      const bioSelectors = SELECTORS.BIO;
      return this.findFirstText(bioSelectors) || '';
    }

    async waitForElement(selector, timeout = 5000) {
      return new Promise((resolve, reject) => {
        const element = document.querySelector(selector);
        if (element) {
          resolve(element);
          return;
        }

        const observer = new MutationObserver((mutations, obs) => {
          const element = document.querySelector(selector);
          if (element) {
            obs.disconnect();
            resolve(element);
          }
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true
        });

        setTimeout(() => {
          observer.disconnect();
          resolve(null); // Resolve with null instead of rejecting
        }, timeout);
      });
    }

    async startBlockingFollowers() {
      // Start a manual-scroll collection session on the current profile.
      if (this.isCollecting) return;

      try {
        const profile = this.currentProfile || await this.getProfileInfo();
        if (!profile) {
          this.sendComplete(false, '프로필 정보를 가져올 수 없습니다.');
          return;
        }

        this.activeProfileUsername = profile.username;
        this.isCollecting = true;
        this.shouldCancel = false;

        this.sendProgress(0, 0, `팔로워 목록에서 스크롤하여 수집 중...`);

        // User must open followers list manually before starting collection.
        const container = this.getFollowersContainer();
        this.followersContainer = container;

        if (!container) {
          this.sendComplete(false, '팔로워 목록을 먼저 연 다음에 수집을 시작해주세요.');
          this.isCollecting = false;
          return;
        }

        // Initial scan for currently visible followers
        const initialCount = this.scanVisibleFollowers(container);
        this.sendProgress(initialCount, initialCount, `수집 중... ${initialCount}명`);

        // Attach listeners for manual-scroll collection
        this.startCollectionSession(container);

      } catch (error) {
        console.error('[Collect] Error:', error);
        this.sendComplete(false, `오류 발생: ${error.message}`);
        this.isCollecting = false;
        this.stopCollectionSession();
      }
    }

    isValidFollowerItem(item, existingFollowers) {
      if (!this.isProfileLink(item)) return null;

      const link = item.href || item.querySelector('a')?.href;
      if (!link) return null;

      const usernameMatch = link.match(/@([^/?]+)/);
      if (!usernameMatch) return null;

      const username = usernameMatch[1];
      if (existingFollowers.has(username)) return null;

      return username;
    }

    getFollowersContainer() {
      let container = null;

      const dialogRoot =
        document.querySelector('[role="dialog"][aria-modal="true"]') ||
        document.querySelector('[role="dialog"]');

      if (dialogRoot) {
        container = this.findScrollableElement(dialogRoot) || dialogRoot;
        console.log('[Collect] Using dialog as followers container:', container);
      }

      return container;
    }

    scanVisibleFollowers(listRoot) {
      if (!listRoot) return 0;

      const followerItems = listRoot.querySelectorAll('a[href*="/@"]');
      console.log(`[Collect] Scanning ${followerItems.length} potential follower links`);

      const batch = [];
      let newlyCollected = 0;

      for (const item of followerItems) {
        const username = this.isValidFollowerItem(item, this.collectedUsernames);
        if (!username) continue;

        if (!this.collectedUsernames.has(username)) {
          this.collectedUsernames.add(username);
          newlyCollected++;
        }

        // Notify popup to add to list
        chrome.runtime.sendMessage({ type: MESSAGE_TYPES.USER_COLLECTED, username }).catch(() => { });

        batch.push(username);
      }

      if (batch.length > 0) {
        console.log(`[Collect] Sending batch of ${batch.length} users`);
        chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.QUEUE_BLOCK_USERS,
          users: batch,
          autoStart: false
        }).catch(() => { });
      }

      return newlyCollected;
    }

    startCollectionSession(container) {
      if (this.followersScrollHandler) return;

      this.followersContainer = container || null;
      this.isCollecting = true;

      this.followersScrollHandler = () => {
        if (!this.isCollecting) return;
        const root = this.followersContainer || document;
        const newlyCollected = this.scanVisibleFollowers(root);

        // Debug/telemetry code removed; replace with console logs if needed.
      };

      // Attach to both the followers container (if any) and window to be robust
      if (this.followersContainer) {
        this.followersContainer.addEventListener('scroll', this.followersScrollHandler, { passive: true });
      }
      window.addEventListener('scroll', this.followersScrollHandler, { passive: true });
    }

    stopCollectionSession() {
      this.isCollecting = false;
      if (this.followersContainer && this.followersScrollHandler) {
        this.followersContainer.removeEventListener('scroll', this.followersScrollHandler);
      }
      if (this.followersScrollHandler) {
        window.removeEventListener('scroll', this.followersScrollHandler);
      }
      this.followersScrollHandler = null;
      this.followersContainer = null;
    }

    resumeCollectionSession() {
      if (this.isCollecting) return;
      const container = this.getFollowersContainer();
      if (!container) return;
      this.startCollectionSession(container);
    }

    async blockFollowersFromList(totalFollowers) {
      const total = totalFollowers || 0;
      const container = this.getFollowersContainer();
      const listRoot = container || document;

      const beforeCount = this.collectedUsernames.size;
      const newlyCollected = this.scanVisibleFollowers(listRoot);
      const afterCount = this.collectedUsernames.size;
      const effectiveTotal = total || afterCount;

      this.sendProgress(afterCount, effectiveTotal, `수집 중... ${afterCount}명`);

      return { blocked: newlyCollected, total: afterCount, cancelled: false };
    }





    findScrollableElement(root) {
      if (!root) return null;

      // Check if root itself is scrollable
      const style = window.getComputedStyle(root);
      if (style.overflowY === 'scroll' || style.overflowY === 'auto') {
        return root;
      }

      // Check children
      const candidates = root.querySelectorAll('div, ul, main');
      for (const el of candidates) {
        const style = window.getComputedStyle(el);
        if ((style.overflowY === 'scroll' || style.overflowY === 'auto') && el.scrollHeight > el.clientHeight) {
          return el;
        }
      }

      return null;
    }

    findElementByText(selector, labels) {
      const normalizedLabels = labels.map(label => label.toLowerCase());
      const elements = Array.from(document.querySelectorAll(selector));
      return elements.find(element => {
        const text = element.textContent?.trim().toLowerCase().replace(/\s+/g, ' ');
        return text && normalizedLabels.some(label => {
          if (text === label) {
            return true;
          }

          if (/^[a-z0-9]+$/.test(label)) {
            const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`\\b${escapedLabel}\\b`).test(text);
          }

          return text.includes(label);
        });
      });
    }


    isProfileLink(link) {
      // Threads posts use /post/ and /t/ paths, so exclude them from profile links.
      if (!link?.pathname) {
        return false;
      }

      const path = link.pathname;
      return path.startsWith('/@') && !path.includes('/post/') && !path.includes('/t/');
    }

    extractDisplayNameFromTitle(title) {
      if (!title) return null;
      const match = title.match(PROFILE_TITLE_REGEX);
      return match?.[1]?.trim() || null;
    }

    // Remove noise such as unread-count badges from tab title / og:title.
    // Example: "(1) Display Name (@handle)" -> "Display Name (@handle)"
    sanitizeTitle(raw) {
      if (!raw) return raw;
      let title = raw.trim();

      // Strip a leading "(number)" badge if present
      const unreadMatch = title.match(/^\(\d+\)\s*(.+)$/);
      if (unreadMatch) {
        title = unreadMatch[1];
      }

      return title;
    }

    getRandomInt(min, max) {
      min = Math.ceil(min);
      max = Math.floor(max);
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    async sleep(ms) {
      if (this.shouldCancel) throw new Error('CANCELLED');

      const start = Date.now();
      while (Date.now() - start < ms) {
        if (this.shouldCancel) throw new Error('CANCELLED');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    async waitIfPaused() {
      if (!this.isPaused) return;
      console.log('[Collect] Paused...');
      this.sendProgress(0, 0, '일시정지됨');

      // Allow user interaction while paused
      this.removeOverlay();

      while (this.isPaused) {
        if (this.shouldCancel) return;
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log('[Collect] Resumed...');

      // Restore overlay when resuming
      this.createOverlay();
      this.sendProgress(0, 0, '수집 중...');
    }

    sendProgress(current, total, status) {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.PROGRESS_UPDATE,
        current: current,
        total: total,
        status: status
      });
    }

    sendComplete(success, message) {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.OPERATION_COMPLETE,
        success: success,
        message: message
      });
    }

    sendCollectionComplete(count) {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.COLLECTION_COMPLETE,
        count: count
      });
    }
    createOverlay() {
      if (document.getElementById('ts-overlay')) return;

      const overlay = document.createElement('div');
      overlay.id = 'ts-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: 999999;
        display: flex;
        justify-content: center;
        align-items: center;
        color: white;
        font-size: 24px;
        font-weight: bold;
        pointer-events: auto;
        cursor: wait;
        backdrop-filter: blur(2px);
      `;
      overlay.innerHTML = `
        <div style="text-align: center; background: #1a1a1a; padding: 30px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
          <div style="font-size: 40px; margin-bottom: 16px;">🧹</div>
          <div>팔로워 수집 중입니다...</div>
          <div style="font-size: 16px; margin-top: 8px; color: #aaa;">화면을 조작하지 마세요.</div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    removeOverlay() {
      const overlay = document.getElementById('ts-overlay');
      if (overlay) {
        overlay.remove();
      }
    }
  }

  // Export to window for re-use
  window.ThreadsSweeperClass = ThreadsSweeper;

} // End of one-time definition block

// Initialize (Always run this part to re-hook listeners)
console.log('Threads Sweeper initializing instance...');
const sweeper = new window.ThreadsSweeperClass();

// Watch for SPA navigation
const observer = new MutationObserver(() => {
  sweeper.checkCurrentProfile();
});

observer.observe(document.body, { childList: true, subtree: true });
