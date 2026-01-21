// Popup UI Controller

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
  START_BLOCKING: 'START_BLOCKING',
  PAUSE_COLLECTION: 'PAUSE_COLLECTION',
  RESUME_COLLECTION: 'RESUME_COLLECTION',
  GET_QUEUE_STATUS: 'GET_QUEUE_STATUS',
  COLLECTION_STARTED: 'COLLECTION_STARTED',
  COLLECTION_STOPPED: 'COLLECTION_STOPPED',
  SET_MAX_PARALLEL: 'SET_MAX_PARALLEL'
};

const DOM_IDS = {
  STATUS_INDICATOR: 'status-indicator',
  STATUS_TEXT: 'status-text',
  STATUS_DISCONNECTED: 'status-disconnected',
  STATUS_CONNECTED: 'status-connected',
  PROFILE_NAME: 'profile-name',
  PROFILE_HANDLE: 'profile-handle',
  BTN_BLOCK_FOLLOWERS: 'btn-block-followers',

  // Simplified Controls
  BLOCKING_CONTROLS: 'blocking-controls',
  COLLECTION_CONTROLS: 'collection-controls',

  PROGRESS_CURRENT: 'progress-current',
  PROGRESS_TOTAL: 'progress-total',
  USER_LIST_CONTAINER: 'user-list-container',

  // Dashboard Elements
  DASHBOARD_SECTION: 'dashboard-section',
  MANUAL_ADD_INPUT: 'manual-add-input',
  BTN_MANUAL_ADD: 'btn-manual-add',
  BTN_EXPORT_CSV: 'btn-export-csv',

  // Concurrency control
  CONCURRENCY_SELECT: 'concurrency-select'
};

class PopupController {
  constructor() {
    this.currentTab = null;
    this.currentProfile = null;
    this.isProcessing = false;
    this.isPaused = false;

    // Legacy array for CSV export compatibility
    this.collectedUsers = [];

    // State Manager - isolated state tracking
    this.state = {
      collected: new Map(),  // username -> { timestamp, source: 'auto'|'manual' }
      blocked: new Map(),    // username -> { success, timestamp }
      pending: new Set()     // usernames in block queue
    };

    // UI Update Queue - prevents concurrent DOM updates
    this.updateQueue = [];
    this.isUpdating = false;

    this.init();
  }

  async init() {
    this.bindElements();
    this.bindEvents();
    await this.checkCurrentPage();
    await this.restoreQueueState(); // Sync persistent queue
    this.syncConcurrencySetting();
  }

  bindElements() {
    // Status elements
    // Profile extraction improved
    this.statusDisconnected = document.getElementById(DOM_IDS.STATUS_DISCONNECTED);
    this.statusConnected = document.getElementById(DOM_IDS.STATUS_CONNECTED);
    this.profileName = document.getElementById(DOM_IDS.PROFILE_NAME);
    this.profileHandle = document.getElementById(DOM_IDS.PROFILE_HANDLE);

    // Action elements - removed btnBlockFollowers (unified into btnCollectionToggle)

    // Dashboard Elements
    this.dashboardSection = document.getElementById(DOM_IDS.DASHBOARD_SECTION);
    this.manualAddInput = document.getElementById(DOM_IDS.MANUAL_ADD_INPUT);
    this.btnManualAdd = document.getElementById(DOM_IDS.BTN_MANUAL_ADD);
    this.concurrencySelect = document.getElementById(DOM_IDS.CONCURRENCY_SELECT);

    // Simplified Controls
    this.blockingControls = document.getElementById('blocking-controls');
    // collectionControls removed - unified into profile card button
    this.btnBlockingToggle = document.getElementById('btn-blocking-toggle');
    this.btnCollectionToggle = document.getElementById('btn-collection-toggle');
    this.btnReset = document.getElementById('btn-reset');

    this.btnExportCsv = document.getElementById(DOM_IDS.BTN_EXPORT_CSV);

    this.progressCurrent = document.getElementById(DOM_IDS.PROGRESS_CURRENT);
    this.progressTotal = document.getElementById(DOM_IDS.PROGRESS_TOTAL);

    this.userListContainer = document.getElementById(DOM_IDS.USER_LIST_CONTAINER);
  }

  bindEvents() {
    // Dashboard Actions
    if (this.btnManualAdd) {
      this.btnManualAdd.addEventListener('click', () => this.addUserToQueue());
    }
    if (this.manualAddInput) {
      this.manualAddInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.addUserToQueue();
      });
    }

    // Simplified Controls Events
    if (this.btnBlockingToggle) {
      this.btnBlockingToggle.addEventListener('click', () => this.toggleBlocking());
    }
    if (this.btnCollectionToggle) {
      this.btnCollectionToggle.addEventListener('click', () => this.handleCollectionClick());
    }
    if (this.btnReset) {
      this.btnReset.addEventListener('click', () => this.resetState());
    }

    if (this.btnExportCsv) {
      this.btnExportCsv.addEventListener('click', () => this.downloadCSV());
    }

    // Concurrency control
    if (this.concurrencySelect) {
      this.concurrencySelect.addEventListener('change', async () => {
        await this.syncConcurrencySetting();
      });
    }

    // Listen for progress updates from content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === MESSAGE_TYPES.PROGRESS_UPDATE) {
        this.updateProgress(message.current, message.total, message.status);
      } else if (message.type === MESSAGE_TYPES.OPERATION_COMPLETE) {
        this.onOperationComplete(message.success, message.message);
      } else if (message.type === MESSAGE_TYPES.COLLECTION_COMPLETE) {
        this.onCollectionComplete(message.count);
      } else if (message.type === MESSAGE_TYPES.ALL_BLOCKING_COMPLETE) {
        this.onOperationComplete(true, '모든 차단 작업이 완료되었습니다.');
      } else if (message.type === MESSAGE_TYPES.USER_COLLECTED) {
        this.addUserToList(message.username);
      } else if (message.type === MESSAGE_TYPES.BLOCK_RESULT) {
        this.markUserBlocked(message.username, message.success);
      }
    });

    // Listen for tab changes
    chrome.tabs.onActivated.addListener(() => this.debouncedCheckPage());
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.active) {
        this.debouncedCheckPage();
      }
    });
  }

  async syncConcurrencySetting() {
    if (!this.concurrencySelect) return;
    const value = parseInt(this.concurrencySelect.value, 10) || 1;
    try {
      await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SET_MAX_PARALLEL,
        value
      });
    } catch (e) {
      console.log('Failed to update max parallel workers:', e);
    }
  }

  debouncedCheckPage() {
    if (this.checkPageTimeout) clearTimeout(this.checkPageTimeout);
    this.checkPageTimeout = setTimeout(() => this.checkCurrentPage(), 200);
  }

  async ensureContentScriptLoaded(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/content.js']
      });
      await new Promise(resolve => setTimeout(resolve, 300));
      return true;
    } catch (err) {
      console.error('Failed to inject script:', err);
      return false;
    }
  }

  async checkCurrentPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.currentTab = tab;

      if (!tab?.url) {
        this.hideProfileInfo();
        return;
      }

      const isThreadsPage = ['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'].includes(new URL(tab.url).hostname);

      if (!isThreadsPage) {
        this.hideProfileInfo();
        return;
      }

      // this.setStatus('loading', 'Checking Threads page...');

      // Attempt to get profile info
      let response = await this.sendToContentScript({ type: MESSAGE_TYPES.GET_PROFILE_INFO });

      if (response && response.error === 'CONNECTION_FAILED') {
        this.hideProfileInfo();
        return;
      }

      if (response && response.success && response.profile) {
        this.currentProfile = response.profile;
        this.showProfileInfo(response.profile);
      } else {
        this.hideProfileInfo();
      }

    } catch (error) {
      console.error('Error checking page:', error);
      this.hideProfileInfo();
    }
  }

  hideProfileInfo() {
    if (this.statusConnected) this.statusConnected.classList.add('hidden');
    if (this.statusDisconnected) this.statusDisconnected.classList.remove('hidden');
    this.currentProfile = null;
  }

  // setStatus removed (legacy)

  showProfileInfo(profile) {
    if (this.statusDisconnected) this.statusDisconnected.classList.add('hidden');
    if (this.statusConnected) this.statusConnected.classList.remove('hidden');

    // For clarity and stability, always display the username as the primary label.
    const displayName = profile.username;

    if (this.profileName) this.profileName.textContent = displayName;
    if (this.profileHandle) this.profileHandle.textContent = `@${profile.username}`;
  }

  // Unified handler for collection button (Start / Pause / Resume)
  async handleCollectionClick() {
    // If not collecting, start collection
    if (!this.isCollecting) {
      await this.startCollection();
      return;
    }

    // If already collecting, stop collection
    await this.stopCollection();
  }

  async startCollection() {
    if (this.isCollecting) return;

    this.isProcessing = true;
    this.isCollecting = true;

    // UI updates for collection mode
    if (this.blockingControls) this.blockingControls.classList.add('hidden');

    // Update button text
    if (this.btnCollectionToggle) this.btnCollectionToggle.textContent = '⏸ 수집 중지';

    // During collection, the blocking header should show:
    // (0 / total collected so far). Initialize it here.
    if (this.progressCurrent) this.progressCurrent.textContent = '0';
    if (this.progressTotal) this.progressTotal.textContent = String(this.state.collected.size || 0);

    // Force Desktop Size (as requested) to ensure layout stability
    try {
      const win = await chrome.windows.getCurrent();
      if (win.width < 1024) {
        await chrome.windows.update(win.id, { width: 1280, height: 900 });
      }
    } catch (e) {
      console.log('Window resize failed:', e);
    }

    const response = await this.sendToContentScript({
      type: MESSAGE_TYPES.BLOCK_FOLLOWERS,
      username: this.currentProfile.username
    });

    if (response && response.error === 'CONNECTION_FAILED') {
      alert('페이지와 연결할 수 없습니다. 페이지를 새로고침 해주세요.');
      this.isProcessing = false;
      this.isCollecting = false;
      if (this.btnCollectionToggle) this.btnCollectionToggle.textContent = '📥 수집 시작';
    }
  }

  async stopCollection() {
    const btn = this.btnCollectionToggle;

    // Tell content script to stop collection session
    await this.sendToContentScript({ type: MESSAGE_TYPES.PAUSE_COLLECTION }, false);

    // Inform background that collection window can stop enforcing size
    if (this.currentTab?.windowId) {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.COLLECTION_STOPPED, windowId: this.currentTab.windowId }).catch(() => { });
    }

    this.isCollecting = false;
    this.isProcessing = false;

    // Reset collection button
    if (btn) btn.textContent = '📥 수집 시작';

    // Expose blocking controls so user can move to blocking phase
    if (this.blockingControls) this.blockingControls.classList.remove('hidden');
  }

  onCollectionComplete(count) {
    this.isProcessing = false;
    this.isCollecting = false;
    this.isPaused = false;

    // Reset collection button
    if (this.btnCollectionToggle) this.btnCollectionToggle.textContent = '📥 수집 시작';

    // Show blocking controls
    if (this.blockingControls) this.blockingControls.classList.remove('hidden');

    // Stop Enforcement
    if (this.currentTab?.windowId) {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.COLLECTION_STOPPED, windowId: this.currentTab.windowId });
    }

    // Reset Blocking Control
    if (this.btnBlockingToggle) {
      this.btnBlockingToggle.textContent = '차단 시작';
      this.btnBlockingToggle.classList.remove('hidden');
    }
  }

  async toggleBlocking() {
    const btn = this.btnBlockingToggle;

    // Case 1: Start (If not processing block queue yet)
    // We check this by seeing if isProcessing is false BUT we are in blocking mode
    if (!this.isProcessing && !this.isPaused) {
      await this.syncConcurrencySetting();
      // Check Queue Status from Background first
      const queueStatus = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_QUEUE_STATUS }).catch(() => null);
      const queueCount = queueStatus?.count || 0;
      const isQueueProcessing = queueStatus?.isProcessing || false;

      // If already processing in background (re-opened popup), just sync UI
      if (isQueueProcessing) {
        this.isProcessing = true;
        if (btn) btn.textContent = '차단 중지';
        // While blocking is already running, sync counters with the current state.
        this.updateBlockingCounters();
        return;
      }

      if (this.collectedUsers.length === 0 && queueCount === 0) {
        alert('차단할 대상이 없습니다.');
        return;
      }

      this.isProcessing = true;

      // Filter users that are not yet blocked (status === 'collected' or 'failed')
      const targetUsers = this.collectedUsers
        .filter(u => u.status !== 'blocked')
        .map(u => u.username);

      await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.START_BLOCKING,
        users: targetUsers
      });

      // Immediately after starting blocking, update counters as (processed count / total queue count).
      this.updateBlockingCounters();

      if (btn) btn.textContent = '차단 중지';
      return;
    }

    // Toggle pause / resume
    // If running (isProcessing=true, isPaused=false) -> pause
    // If paused (isProcessing=true, isPaused=true) -> resume
    if (this.isPaused) {
      // Resume: re-run blocking only for failed or unprocessed users
      // (re-queue all users where status !== 'blocked')
      const targetUsers = this.collectedUsers
        .filter(u => u.status !== 'blocked')
        .map(u => u.username);

      if (targetUsers.length > 0) {
        await chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.START_BLOCKING,
          users: targetUsers
        });

        this.isProcessing = true;
        this.isPaused = false;
        if (btn) btn.textContent = '차단 중지';
      } else {
        // If there is nothing to resume, go back to the initial state
        this.isProcessing = false;
        this.isPaused = false;
        if (btn) btn.textContent = '차단 시작';
      }
    } else {
      // Pause: temporarily stop processing the current queue (queue itself is preserved)
      await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.PAUSE_BLOCKING });
      this.isPaused = true;
      this.isProcessing = false;
      if (btn) btn.textContent = '차단 시작';

      // Immediately close the popup (side panel)
      window.close();
    }
  }

  async resetState() {
    // Stop everything
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.STOP_BLOCKING });
    // Ensure content script also stops (removes overlay)
    await this.sendToContentScript({ type: MESSAGE_TYPES.CANCEL_OPERATION }, false);

    this.isProcessing = false;
    this.isPaused = false;
    this.collectedUsers = []; // Clear all collected data

    if (this.userListContainer) {
      this.userListContainer.innerHTML = '<div class="empty-state">대상이 없습니다.</div>';
    }

    if (this.progressTotal) this.progressTotal.textContent = '0';
    if (this.progressCurrent) this.progressCurrent.textContent = '0';

    // Reset controls
    this.onCollectionComplete(0); // Trigger UI reset to "blocking ready" state
    if (this.btnBlockingToggle) this.btnBlockingToggle.textContent = '차단 시작';
  }

  async addUserToQueue() {
    const input = this.manualAddInput;
    if (!input) return;
    const rawValue = input.value;

    const usernames = rawValue.split(/[,\s\t]+/)
      .map(u => u.trim().replace(/^@/, ''))
      .filter(u => u.length > 0);

    // Deduplicate input immediately
    const uniqueUsernames = [...new Set(usernames)];

    if (uniqueUsernames.length === 0) {
      alert('사용자 이름을 입력해주세요.');
      return;
    }

    for (const username of uniqueUsernames) {
      this.addUserToList(username, 'manual');
    }

    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.QUEUE_BLOCK_USERS,
      users: uniqueUsernames,
      autoStart: false
    });

    input.value = '';
  }

  onOperationComplete(success, message) {
    this.isProcessing = false;
    this.isPaused = false;

    // Completion or Stop -> Reset UI to "Ready"
    // Ideally stay in current mode? Or defaults to Blocking mode since completion usually implies blocking done
    if (this.blockingControls) this.blockingControls.classList.remove('hidden');

    if (this.btnBlockingToggle) {
      this.btnBlockingToggle.textContent = '차단 시작';
    }

    // If queue is empty, hide the blocking controls
    // Check pending count
    const pendingCount = this.state.pending.size;
    if (pendingCount === 0 && this.blockingControls) {
      this.blockingControls.classList.add('hidden');
    }

    if (!success) {
      // alert(message); // Optional
    }
  }

  updateProgress(current, total, status) {
    // Compute effective current/total values for display.
    // - During collection: current is fixed at 0, total is the number of collected users.
    // - During blocking: current is the processed count, total is the queue size.
    const isCollecting = status && (status.includes('수집') || status.includes('Collecting'));

    let effectiveCurrent;
    let effectiveTotal;

    if (isCollecting) {
      // While collecting, the header should read "(0 / totalCollected)".
      effectiveCurrent = 0;
      // Prefer live state for total; fall back to reported total if present.
      const liveTotal = this.state.collected.size || this.collectedUsers.length;
      effectiveTotal = liveTotal > 0 ? liveTotal : (total || 0);
    } else {
      effectiveCurrent = current || 0;
      effectiveTotal = total || 0;

      // If the processed count exceeds the known total,
      // clamp the total up so that the header never shows e.g. (342/321).
      if (effectiveTotal > 0 && effectiveCurrent > effectiveTotal) {
        effectiveTotal = effectiveCurrent;
      }
    }

    if (this.progressCurrent) {
      this.progressCurrent.textContent = effectiveCurrent;
    }

    if (this.progressTotal) {
      this.progressTotal.textContent = effectiveTotal > 0 ? effectiveTotal : '...';
    }
  }

  addUserToList(username, source = 'auto') {
    // 1. Update state first (always succeeds)
    if (this.state.collected.has(username)) return; // Skip duplicate

    const timestamp = new Date().toISOString();
    this.state.collected.set(username, { timestamp, source });
    this.state.pending.add(username);

    // Legacy array sync for CSV export
    this.collectedUsers.push({ username, status: 'collected', timestamp });

    // 2. Queue UI update
    this.queueUpdate('add', { username, source });

    // Ensure blocking controls are visible when items are added
    if (this.blockingControls) {
      this.blockingControls.classList.remove('hidden');
    }
  }

  markUserBlocked(username, success) {
    // 1. Update state first
    this.state.blocked.set(username, { success, timestamp: new Date().toISOString() });
    this.state.pending.delete(username);

    // Legacy array sync for CSV/export
    const user = this.collectedUsers.find(u => u.username === username);
    if (user) {
      user.status = success ? 'blocked' : 'failed';
    }

    // 2. Queue UI update
    this.queueUpdate('block', { username, success });

    // After each blocked user, update the counters.
    this.updateBlockingCounters();
  }

  // Update counters to reflect "(processed count / total queue count)" for blocking progress.
  updateBlockingCounters() {
    const processed = this.state.blocked.size;                      // number of users already processed (success or failure)
    const total = this.state.pending.size + processed;              // total number of users currently in the queue

    if (this.progressCurrent) this.progressCurrent.textContent = processed;
    if (this.progressTotal) this.progressTotal.textContent = total;
  }

  // --- UI Update Queue ---
  queueUpdate(type, data) {
    this.updateQueue.push({ type, data, timestamp: Date.now() });
    this.processQueue();
  }

  async processQueue() {
    if (this.isUpdating) return;
    this.isUpdating = true;

    while (this.updateQueue.length > 0) {
      const { type, data } = this.updateQueue.shift();
      await this.applyUpdate(type, data);
    }

    this.isUpdating = false;
  }

  async applyUpdate(type, data) {
    const container = this.userListContainer;
    if (!container) return;

    // Remove empty state if present
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    if (type === 'add') {
      const { username, source } = data;
      if (document.getElementById(`user-${username}`)) return; // Already in DOM

      const item = document.createElement('div');
      item.id = `user-${username}`;
      item.className = 'user-item';
      item.dataset.source = source;
      item.textContent = `@${username}`;
      container.appendChild(item);
      container.scrollTop = container.scrollHeight;

      // While collecting, the header should show "(0 / totalCollected)".
      // Adding a user only affects the total, not the current.
      const totalCollected = this.state.collected.size;
      if (this.progressCurrent) this.progressCurrent.textContent = '0';
      if (this.progressTotal) this.progressTotal.textContent = String(totalCollected);
    } else if (type === 'block') {
      const { username, success } = data;
      const item = document.getElementById(`user-${username}`);

      if (item) {
        // Prevent duplicate status append
        if (!item.classList.contains('blocked') && !item.classList.contains('failed')) {
          if (success) {
            item.classList.add('blocked');
            item.textContent += ' (차단 완료)';
          } else {
            item.classList.add('failed');
            item.textContent += ' (실패)';
          }
        }
      }
    }

    // Small delay to prevent UI thrashing
    await new Promise(r => setTimeout(r, 10));
  }

  // Sync UI from state (for recovery/restore)
  syncUIFromState() {
    const container = this.userListContainer;
    if (!container) return;

    container.innerHTML = '';

    if (this.state.collected.size === 0) {
      container.innerHTML = '<div class="empty-state">대상이 없습니다.</div>';
      if (this.blockingControls) this.blockingControls.classList.add('hidden');
      return;
    }

    // Check if there are any pending items to decide blocking control visibility
    if (this.state.pending.size > 0) {
      if (this.blockingControls) this.blockingControls.classList.remove('hidden');
    } else {
      if (!this.isProcessing && this.blockingControls) this.blockingControls.classList.add('hidden');
    }

    for (const [username, info] of this.state.collected) {
      const item = document.createElement('div');
      item.id = `user-${username}`;
      item.className = 'user-item';
      item.dataset.source = info.source;
      item.textContent = `@${username}`;

      // Apply blocked status if exists
      const blockInfo = this.state.blocked.get(username);
      if (blockInfo) {
        if (blockInfo.success) {
          item.classList.add('blocked');
          item.textContent += ' (차단 완료)';
        } else {
          item.classList.add('failed');
          item.textContent += ' (실패)';
        }
      }

      container.appendChild(item);
    }

    if (this.progressCurrent) {
      this.progressCurrent.textContent = this.state.collected.size;
    }
  }

  downloadCSV() {
    if (this.collectedUsers.length === 0) {
      alert('수집된 데이터가 없습니다.');
      return;
    }

    const bom = '\uFEFF';
    let csvContent = bom + 'Username,Status,Timestamp\n';
    this.collectedUsers.forEach(row => {
      csvContent += `${row.username},${row.status},${row.timestamp}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `threads_block_list_${new Date().toISOString().slice(0, 10)}.csv`);
    link.setAttribute('target', '_blank');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async sendToContentScript(message, retry = true) {
    try {
      const response = await chrome.tabs.sendMessage(this.currentTab.id, message);
      return response;
    } catch (error) {
      const isConnectionError = error.message.includes('Could not establish connection') ||
        error.message.includes('Receiving end does not exist');

      if (isConnectionError && retry) {
        console.log('Connection failed, attempting to inject content script...');
        const loaded = await this.ensureContentScriptLoaded(this.currentTab.id);
        if (loaded) {
          return await this.sendToContentScript(message, false);
        }
      }

      console.error('Error sending message to content script:', error);

      if (isConnectionError) {
        return { error: 'CONNECTION_FAILED' };
      }
      return null;
    }
  }
  async restoreQueueState() {
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_QUEUE_STATUS });

      if (response && response.success) {
        const { queue, isProcessing } = response;

        // Populate list
        if (queue && queue.length > 0) {
          queue.forEach(username => this.addUserToList(username));
        }

        // Sync processing state
        if (isProcessing) {
          this.isProcessing = true;
          if (this.btnBlockingToggle) this.btnBlockingToggle.textContent = '차단 중지';

          if (this.blockingControls) this.blockingControls.classList.remove('hidden');
        } else {
          // If items exist but not processing, ensure controls are visible so user can start
          if (queue && queue.length > 0) {
            if (this.blockingControls) this.blockingControls.classList.remove('hidden');
          }
        }
      }
    } catch (error) {
      console.log('Queue sync failed (Background might be inactive):', error);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
