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
  SET_MAX_PARALLEL: 'SET_MAX_PARALLEL',
  RATE_LIMIT_DETECTED: 'RATE_LIMIT_DETECTED'
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
  CONCURRENCY_SELECT: 'concurrency-select',
  REPORT_BEFORE_BLOCK_CHECKBOX: 'report-before-block-checkbox'
};

// ============================================
// App Phase - Centralized State Management
// ============================================
const AppPhase = {
  IDLE: 'idle',             // 초기 상태
  COLLECTING: 'collecting', // 수집 중
  READY: 'ready',           // 수집 완료, 차단 대기
  BLOCKING: 'blocking',     // 차단 중
  PAUSED: 'paused'          // 일시정지
};

class StateManager {
  constructor(onStateChange) {
    this.onStateChange = onStateChange;
    this._phase = AppPhase.IDLE;
    this._users = new Map();  // username -> { source, status, reportStatus, blockStatus, timestamp }
  }

  get phase() { return this._phase; }

  setPhase(newPhase) {
    const prev = this._phase;
    if (prev === newPhase) return;
    this._phase = newPhase;
    this.onStateChange('phase', { prev, next: newPhase });
  }

  // 사용자 추가
  addUser(username, source = 'auto') {
    if (this._users.has(username)) return false;
    this._users.set(username, {
      source,
      status: 'pending',  // pending | reported | blocked | failed
      reportStatus: 'pending', // pending | reported | failed | skipped
      blockStatus: 'pending',  // pending | blocked | failed
      timestamp: new Date().toISOString()
    });
    this.onStateChange('userAdded', { username, source });
    return true;
  }

  // 차단 결과 업데이트
  updateUserStatus(username, status) {
    const user = this._users.get(username);
    if (user) {
      user.status = status;
      this.onStateChange('userUpdated', { username, status });
    }
  }

  // Update report/block result independently while keeping block success as final success.
  updateUserResult(username, result) {
    const user = this._users.get(username);
    if (!user) return;

    if (result.reportSkipped) {
      user.reportStatus = 'skipped';
      user.reportError = null;
    } else {
      user.reportStatus = result.reportSuccess ? 'reported' : 'failed';
      user.reportError = result.reportError || null;
    }
    user.blockStatus = result.blockSuccess ? 'blocked' : 'failed';
    user.blockError = result.blockError || result.error || null;

    if (user.blockStatus === 'blocked') {
      user.status = 'blocked';
    } else if (user.reportStatus === 'reported') {
      user.status = 'reported';
    } else {
      user.status = 'failed';
    }

    this.onStateChange('userUpdated', { username, status: user.status });
  }

  // 전체 초기화
  reset() {
    this._users.clear();
    this._phase = AppPhase.IDLE;
    this.onStateChange('reset', {});
  }

  // 통계
  get counts() {
    let pending = 0, reported = 0, blocked = 0, failed = 0;
    for (const u of this._users.values()) {
      if (u.blockStatus === 'pending') pending++;
      if (u.reportStatus === 'reported') reported++;
      if (u.blockStatus === 'blocked') blocked++;
      else if (u.blockStatus === 'failed') failed++;
    }
    return { total: this._users.size, pending, reported, blocked, failed };
  }

  get pendingUsers() {
    return [...this._users.entries()]
      .filter(([_, u]) => u.status === 'pending')
      .map(([name]) => name);
  }

  get allUsers() {
    return [...this._users.entries()].map(([username, data]) => ({ username, ...data }));
  }
}

// ============================================

class PopupController {
  constructor() {
    this.currentTab = null;
    this.currentProfile = null;

    // Centralized State Manager
    this.stateManager = new StateManager((type, data) => this.handleStateChange(type, data));

    // UI Update Queue - prevents concurrent DOM updates
    this.updateQueue = [];
    this.isUpdating = false;

    this.init();
  }

  // Reactive state change handler
  handleStateChange(type, data) {
    switch (type) {
      case 'phase':
        this.updateUIForPhase(data.next);
        break;
      case 'userAdded':
        this.renderUserItem(data.username, data.source);
        this.updateCounters();
        break;
      case 'userUpdated':
        this.renderUserStatus(data.username, data.status);
        this.updateCounters();
        break;
      case 'reset':
        this.renderEmptyState();
        this.updateCounters();
        this.updateUIForPhase(AppPhase.IDLE);
        break;
    }
  }

  // UI update based on phase
  updateUIForPhase(phase) {
    const btnCollection = this.btnCollectionToggle;
    const btnBlocking = this.btnBlockingToggle;
    const blockingControls = this.blockingControls;
    const startLabel = this.getBlockingStartLabel();
    const stopLabel = this.shouldReportBeforeBlock() ? '신고/차단 중지' : '차단 중지';

    switch (phase) {
      case AppPhase.IDLE:
        if (btnCollection) btnCollection.textContent = '📥 수집 시작';
        if (btnBlocking) btnBlocking.textContent = startLabel;
        if (blockingControls) blockingControls.classList.add('hidden');
        break;
      case AppPhase.COLLECTING:
        if (btnCollection) btnCollection.textContent = '⏸ 수집 중지';
        if (blockingControls) blockingControls.classList.add('hidden');
        break;
      case AppPhase.READY:
        if (btnCollection) btnCollection.textContent = '📥 수집 시작';
        if (btnBlocking) btnBlocking.textContent = startLabel;
        if (blockingControls) blockingControls.classList.remove('hidden');
        break;
      case AppPhase.BLOCKING:
        if (btnBlocking) btnBlocking.textContent = stopLabel;
        if (blockingControls) blockingControls.classList.remove('hidden');
        break;
      case AppPhase.PAUSED:
        if (btnBlocking) btnBlocking.textContent = startLabel;
        if (blockingControls) blockingControls.classList.remove('hidden');
        break;
    }
  }

  shouldReportBeforeBlock() {
    return !!this.reportBeforeBlockCheckbox?.checked;
  }

  getBlockingStartLabel() {
    return this.shouldReportBeforeBlock() ? '신고 후 차단 시작' : '차단 시작';
  }

  // Update counters from state
  updateCounters() {
    const { total, blocked, failed } = this.stateManager.counts;
    const phase = this.stateManager.phase;

    if (phase === AppPhase.COLLECTING) {
      if (this.progressCurrent) this.progressCurrent.textContent = '0';
      if (this.progressTotal) this.progressTotal.textContent = String(total);
    } else {
      // During report/block: show processed users / total users.
      if (this.progressCurrent) this.progressCurrent.textContent = String(blocked + failed);
      if (this.progressTotal) this.progressTotal.textContent = String(total);
    }
  }

  // Render user item in list
  renderUserItem(username, source) {
    const container = this.userListContainer;
    if (!container) return;

    // Remove empty state if present
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    if (document.getElementById(`user-${username}`)) return; // Already in DOM

    const item = document.createElement('div');
    item.id = `user-${username}`;
    item.className = 'user-item';
    item.dataset.source = source;
    item.textContent = `@${username}`;
    container.appendChild(item);
    container.scrollTop = container.scrollHeight;
  }

  // Render user status update
  renderUserStatus(username, status) {
    const item = document.getElementById(`user-${username}`);
    if (!item) return;

    const user = this.stateManager.allUsers.find(row => row.username === username);
    if (!user) return;

    item.classList.toggle('blocked', user.blockStatus === 'blocked');
    item.classList.toggle('failed', user.blockStatus === 'failed');
    item.classList.toggle('report-failed', user.reportStatus === 'failed' && user.blockStatus !== 'failed');

    const labels = [];
    if (user.reportStatus === 'reported') labels.push('신고 완료');
    if (user.reportStatus === 'failed') labels.push('신고 실패');
    if (user.blockStatus === 'blocked') labels.push('차단 완료');
    if (user.blockStatus === 'failed') labels.push('차단 실패');

    item.textContent = labels.length > 0
      ? `@${username} (${labels.join(' / ')})`
      : `@${username}`;
  }

  // Render empty state
  renderEmptyState() {
    if (this.userListContainer) {
      this.userListContainer.innerHTML = '<div class="empty-state">대상이 없습니다.</div>';
    }
    if (this.progressTotal) this.progressTotal.textContent = '0';
    if (this.progressCurrent) this.progressCurrent.textContent = '0';
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
    this.reportBeforeBlockCheckbox = document.getElementById(DOM_IDS.REPORT_BEFORE_BLOCK_CHECKBOX);

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

    if (this.reportBeforeBlockCheckbox) {
      this.reportBeforeBlockCheckbox.addEventListener('change', () => this.updateUIForPhase(this.stateManager.phase));
    }

    // Concurrency control
    if (this.concurrencySelect) {
      this.concurrencySelect.addEventListener('change', async () => {
        await this.syncConcurrencySetting();
      });
    }

    // Listen for messages from background/content script
    chrome.runtime.onMessage.addListener((message) => {
      switch (message.type) {
        case MESSAGE_TYPES.PROGRESS_UPDATE:
          if (this.progressCurrent) this.progressCurrent.textContent = String(message.current || 0);
          if (this.progressTotal) this.progressTotal.textContent = String(message.total || 0);
          break;
        case MESSAGE_TYPES.OPERATION_COMPLETE:
          this.onOperationComplete(message.success, message.message);
          break;
        case MESSAGE_TYPES.COLLECTION_COMPLETE:
          this.onCollectionComplete(message.count);
          break;
        case MESSAGE_TYPES.ALL_BLOCKING_COMPLETE:
          this.onOperationComplete(true, '모든 차단 작업이 완료되었습니다.');
          break;
        case MESSAGE_TYPES.USER_COLLECTED:
          this.addUserToList(message.username);
          break;
        case MESSAGE_TYPES.BLOCK_RESULT:
          this.markUserProcessed(message.username, message);
          break;
        case MESSAGE_TYPES.RATE_LIMIT_DETECTED:
          this.onRateLimitDetected(message.error, message.code);
          break;
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

  // Unified handler for collection button (Start / Stop)
  async handleCollectionClick() {
    const phase = this.stateManager.phase;
    if (phase === AppPhase.COLLECTING) {
      await this.stopCollection();
    } else {
      await this.startCollection();
    }
  }

  async startCollection() {
    if (this.stateManager.phase === AppPhase.COLLECTING) return;

    // Set phase (triggers UI update via handleStateChange)
    this.stateManager.setPhase(AppPhase.COLLECTING);

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
      this.stateManager.setPhase(AppPhase.IDLE);
    }
  }

  async stopCollection() {
    // Tell content script to stop collection session
    await this.sendToContentScript({ type: MESSAGE_TYPES.PAUSE_COLLECTION }, false);

    // Inform background that collection window can stop enforcing size
    if (this.currentTab?.windowId) {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.COLLECTION_STOPPED, windowId: this.currentTab.windowId }).catch(() => { });
    }

    // Set phase to READY if we have collected users, otherwise IDLE
    const hasUsers = this.stateManager.counts.total > 0;
    this.stateManager.setPhase(hasUsers ? AppPhase.READY : AppPhase.IDLE);
  }

  onCollectionComplete(count) {
    // Stop size enforcement
    if (this.currentTab?.windowId) {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.COLLECTION_STOPPED, windowId: this.currentTab.windowId });
    }

    // Transition to READY if we have users, otherwise IDLE
    const hasUsers = this.stateManager.counts.total > 0;
    this.stateManager.setPhase(hasUsers ? AppPhase.READY : AppPhase.IDLE);
  }

  async toggleBlocking() {
    const phase = this.stateManager.phase;

    // Case 1: Start blocking (from READY or PAUSED)
    if (phase === AppPhase.READY || phase === AppPhase.PAUSED) {
      await this.syncConcurrencySetting();

      // Check Queue Status from Background first
      const queueStatus = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_QUEUE_STATUS }).catch(() => null);
      const queueCount = queueStatus?.count || 0;
      const isQueueProcessing = queueStatus?.isProcessing || false;

      // If already processing in background (re-opened popup), just sync UI
      if (isQueueProcessing) {
        this.stateManager.setPhase(AppPhase.BLOCKING);
        this.updateCounters();
        return;
      }

      const pendingUsers = this.stateManager.pendingUsers;
      if (pendingUsers.length === 0 && queueCount === 0) {
        alert('차단할 대상이 없습니다.');
        return;
      }

      await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.START_BLOCKING,
        users: pendingUsers,
        reportBeforeBlock: this.shouldReportBeforeBlock()
      });

      this.stateManager.setPhase(AppPhase.BLOCKING);
      return;
    }

    // Case 2: Pause blocking (from BLOCKING)
    if (phase === AppPhase.BLOCKING) {
      await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.PAUSE_BLOCKING });
      this.stateManager.setPhase(AppPhase.PAUSED);

      // Immediately close the popup (side panel)
      window.close();
    }
  }

  async resetState() {
    // Stop everything
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.STOP_BLOCKING });
    // Ensure content script also stops (removes overlay)
    await this.sendToContentScript({ type: MESSAGE_TYPES.CANCEL_OPERATION }, false);

    // Reset state manager (triggers UI update via handleStateChange)
    this.stateManager.reset();
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
      this.stateManager.addUser(username, 'manual');
    }

    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.QUEUE_BLOCK_USERS,
      users: uniqueUsernames,
      autoStart: false
    });

    // Show blocking controls when users are added
    if (this.stateManager.counts.total > 0 && this.stateManager.phase === AppPhase.IDLE) {
      this.stateManager.setPhase(AppPhase.READY);
    }

    input.value = '';
  }

  onOperationComplete(success, message) {
    // Transition to READY if we have pending users, otherwise IDLE
    const hasUsers = this.stateManager.counts.pending > 0;
    this.stateManager.setPhase(hasUsers ? AppPhase.READY : AppPhase.IDLE);
  }

  onRateLimitDetected(error, code) {
    console.error('[Popup] Rate limit detected:', error, code);

    // Pause processing on rate limit
    this.stateManager.setPhase(AppPhase.PAUSED);

    // Alert user about rate limit
    const errorMessage = `Rate Limit 감지: 요청이 너무 빈번합니다.\n\n에러 메시지: ${error}\n에러 코드: ${code}\n\n잠시 후 다시 시도해주세요.`;
    alert(errorMessage);
  }

  // This function is now a simple wrapper for stateManager.addUser
  addUserToList(username, source = 'auto') {
    this.stateManager.addUser(username, source);

    // Ensure we're in READY phase when users are added (if not collecting/blocking)
    const phase = this.stateManager.phase;
    if (phase === AppPhase.IDLE && this.stateManager.counts.total > 0) {
      this.stateManager.setPhase(AppPhase.READY);
    }
  }

  markUserProcessed(username, result) {
    this.stateManager.updateUserResult(username, result);
  }

  // --- CSV Export ---
  downloadCSV() {
    const users = this.stateManager.allUsers;
    if (users.length === 0) {
      alert('수집된 데이터가 없습니다.');
      return;
    }

    const bom = '\uFEFF';
    let csvContent = bom + 'Username,ReportStatus,BlockStatus,Timestamp\n';
    users.forEach(row => {
      csvContent += `${row.username},${row.reportStatus},${row.blockStatus},${row.timestamp}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `threads_report_block_list_${new Date().toISOString().slice(0, 10)}.csv`);
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
          queue.forEach(username => this.stateManager.addUser(username, 'restored'));
        }

        // Sync processing state
        if (isProcessing) {
          this.stateManager.setPhase(AppPhase.BLOCKING);
        } else if (queue && queue.length > 0) {
          this.stateManager.setPhase(AppPhase.READY);
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
