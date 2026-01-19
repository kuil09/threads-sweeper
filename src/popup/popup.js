// Popup UI Controller
import { StorageManager } from '../utils/storage.js';

class PopupController {
  constructor() {
    this.storage = new StorageManager();
    this.currentTab = null;
    this.currentProfile = null;
    this.isProcessing = false;

    this.init();
  }

  async init() {
    await this.bindElements();
    await this.bindEvents();
    await this.checkCurrentPage();
    await this.loadArchiveList();
  }

  bindElements() {
    // Status elements
    this.statusIndicator = document.getElementById('status-indicator');
    this.statusText = document.getElementById('status-text');

    // Profile elements
    this.profileSection = document.getElementById('profile-section');
    this.profileName = document.getElementById('profile-name');
    this.profileHandle = document.getElementById('profile-handle');
    this.followerCount = document.getElementById('follower-count');

    // Action elements
    this.actionsSection = document.getElementById('actions-section');
    this.btnBlockFollowers = document.getElementById('btn-block-followers');
    this.btnArchive = document.getElementById('btn-archive');

    // Progress elements
    this.progressSection = document.getElementById('progress-section');
    this.progressFill = document.getElementById('progress-fill');
    this.progressCurrent = document.getElementById('progress-current');
    this.progressTotal = document.getElementById('progress-total');
    this.progressStatus = document.getElementById('progress-status');
    this.btnCancel = document.getElementById('btn-cancel');

    // Archive elements
    this.archiveList = document.getElementById('archive-list');
    this.btnExportPdf = document.getElementById('btn-export-pdf');
    this.btnClearArchive = document.getElementById('btn-clear-archive');
  }

  bindEvents() {
    this.btnBlockFollowers.addEventListener('click', () => this.startBlockFollowers());
    this.btnArchive.addEventListener('click', () => this.startArchive());
    this.btnCancel.addEventListener('click', () => this.cancelOperation());
    this.btnExportPdf.addEventListener('click', () => this.exportPdf());
    this.btnClearArchive.addEventListener('click', () => this.clearArchive());

    // Listen for progress updates from content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'PROGRESS_UPDATE') {
        this.updateProgress(message.current, message.total, message.status);
      } else if (message.type === 'OPERATION_COMPLETE') {
        this.onOperationComplete(message.success, message.message);
      } else if (message.type === 'ARCHIVE_SAVED') {
        this.loadArchiveList();
      }
    });
  }

  async checkCurrentPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.currentTab = tab;

      if (!tab.url) {
        this.setStatus('inactive', 'Threads 페이지가 아닙니다');
        return;
      }
      let isThreadsPage = false;
      try {
        const currentUrl = new URL(tab.url);
        isThreadsPage = currentUrl.hostname === 'threads.com' || currentUrl.hostname === 'www.threads.com';
      } catch (error) {
        isThreadsPage = false;
      }

      if (!isThreadsPage) {
        this.setStatus('inactive', 'Threads 페이지가 아닙니다');
        return;
      }

      this.setStatus('loading', 'Threads 페이지 확인 중...');

      // Send message to content script to get profile info
      const response = await this.sendToContentScript({ type: 'GET_PROFILE_INFO' });

      if (response && response.success && response.profile) {
        this.currentProfile = response.profile;
        this.showProfileInfo(response.profile);
        this.setStatus('active', 'Threads 프로필 페이지');
      } else {
        this.setStatus('inactive', '프로필 페이지로 이동해주세요');
      }
    } catch (error) {
      console.error('Error checking page:', error);
      this.setStatus('inactive', '페이지 확인 실패');
    }
  }

  setStatus(type, text) {
    this.statusIndicator.className = `status-indicator ${type}`;
    this.statusText.textContent = text;
  }

  showProfileInfo(profile) {
    this.profileSection.classList.remove('hidden');
    this.actionsSection.classList.remove('hidden');

    this.profileName.textContent = profile.displayName || profile.username;
    this.profileHandle.textContent = `@${profile.username}`;
    this.followerCount.textContent = `팔로워: ${profile.followerCount || '확인 중...'}`;
  }

  async startBlockFollowers() {
    if (this.isProcessing) return;

    const confirmed = confirm(
      `${this.currentProfile?.username}의 팔로워를 전체 차단하시겠습니까?\n\n` +
      '이 작업은 취소할 수 없습니다.'
    );

    if (!confirmed) return;

    this.isProcessing = true;
    this.showProgress();

    await this.sendToContentScript({
      type: 'BLOCK_FOLLOWERS',
      username: this.currentProfile.username
    });
  }

  async startArchive() {
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.showProgress();
    this.updateProgress(0, 1, '증거 수집 중...');

    await this.sendToContentScript({
      type: 'ARCHIVE_PROFILE',
      username: this.currentProfile.username
    });
  }

  showProgress() {
    this.actionsSection.classList.add('hidden');
    this.progressSection.classList.remove('hidden');
  }

  hideProgress() {
    this.progressSection.classList.add('hidden');
    this.actionsSection.classList.remove('hidden');
    this.isProcessing = false;
  }

  updateProgress(current, total, status) {
    const percent = total > 0 ? (current / total) * 100 : 0;
    this.progressFill.style.width = `${percent}%`;
    this.progressCurrent.textContent = current;
    this.progressTotal.textContent = total;
    this.progressStatus.textContent = status;
  }

  async cancelOperation() {
    await this.sendToContentScript({ type: 'CANCEL_OPERATION' });
    this.hideProgress();
  }

  onOperationComplete(success, message) {
    this.hideProgress();
    alert(message);
    if (success) {
      this.loadArchiveList();
    }
  }

  async loadArchiveList() {
    const archives = await this.storage.getAllArchives();

    if (archives.length === 0) {
      this.archiveList.innerHTML = '<p class="empty-text">저장된 증거가 없습니다</p>';
      this.btnExportPdf.disabled = true;
      this.btnClearArchive.disabled = true;
      return;
    }

    this.btnExportPdf.disabled = false;
    this.btnClearArchive.disabled = false;

    this.archiveList.innerHTML = archives.map(archive => `
      <div class="archive-item" data-id="${archive.id}">
        <input type="checkbox" class="archive-checkbox" data-id="${archive.id}">
        <div class="archive-item-info">
          <span class="archive-item-name">@${archive.username}</span>
          <span class="archive-item-date">${this.formatDate(archive.timestamp)}</span>
        </div>
        <div class="archive-item-actions">
          <button class="archive-item-btn view-btn" data-id="${archive.id}">보기</button>
          <button class="archive-item-btn delete" data-id="${archive.id}">삭제</button>
        </div>
      </div>
    `).join('');

    // Bind archive item events
    this.archiveList.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.viewArchive(e.target.dataset.id));
    });

    this.archiveList.querySelectorAll('.delete').forEach(btn => {
      btn.addEventListener('click', (e) => this.deleteArchive(e.target.dataset.id));
    });
  }

  formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  async viewArchive(id) {
    const archive = await this.storage.getArchive(id);
    if (archive) {
      // Open in new tab or show in popup
      console.log('Archive:', archive);
      alert(`유저: @${archive.username}\n수집일시: ${this.formatDate(archive.timestamp)}\n게시물 수: ${archive.posts?.length || 0}개`);
    }
  }

  async deleteArchive(id) {
    if (confirm('이 증거를 삭제하시겠습니까?')) {
      await this.storage.deleteArchive(id);
      await this.loadArchiveList();
    }
  }

  async exportPdf() {
    const checkboxes = this.archiveList.querySelectorAll('.archive-checkbox:checked');
    const selectedIds = Array.from(checkboxes).map(cb => cb.dataset.id);

    if (selectedIds.length === 0) {
      alert('PDF로 내보낼 증거를 선택해주세요.');
      return;
    }

    // Send to background script for PDF generation
    chrome.runtime.sendMessage({
      type: 'GENERATE_PDF',
      archiveIds: selectedIds
    });
  }

  async clearArchive() {
    if (confirm('저장된 모든 증거를 삭제하시겠습니까?\n\n이 작업은 취소할 수 없습니다.')) {
      await this.storage.clearAllArchives();
      await this.loadArchiveList();
    }
  }

  async sendToContentScript(message) {
    try {
      const response = await chrome.tabs.sendMessage(this.currentTab.id, message);
      return response;
    } catch (error) {
      console.error('Error sending message to content script:', error);
      return null;
    }
  }
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
