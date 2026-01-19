// Content Script for Threads.com
// Handles page interaction, scraping, and blocking

class ThreadsSweeper {
  constructor() {
    this.isProcessing = false;
    this.shouldCancel = false;
    this.currentProfile = null;

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
      case 'GET_PROFILE_INFO':
        const profile = await this.getProfileInfo();
        sendResponse({ success: !!profile, profile });
        break;

      case 'BLOCK_FOLLOWERS':
        this.startBlockingFollowers();
        sendResponse({ success: true });
        break;

      case 'ARCHIVE_PROFILE':
        this.archiveProfile();
        sendResponse({ success: true });
        break;

      case 'CANCEL_OPERATION':
        this.shouldCancel = true;
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  }

  checkCurrentProfile() {
    // Check if we're on a profile page
    const url = window.location.href;
    const profileMatch = url.match(/threads\.com\/@([^/?]+)/);

    if (profileMatch) {
      this.currentUsername = profileMatch[1];
    }
  }

  async getProfileInfo() {
    try {
      const url = window.location.href;
      const profileMatch = url.match(/threads\.com\/@([^/?]+)/);

      if (!profileMatch) {
        return null;
      }

      const username = profileMatch[1];

      // Wait for profile elements to load
      await this.waitForElement('[class*="ProfileHeader"], header');

      // Try to get profile info from the page
      const profile = {
        username: username,
        displayName: this.getDisplayName(),
        followerCount: this.getFollowerCount(),
        profileUrl: `https://www.threads.com/@${username}`,
        bio: this.getBio()
      };

      this.currentProfile = profile;
      return profile;
    } catch (error) {
      console.error('Error getting profile info:', error);
      return null;
    }
  }

  getDisplayName() {
    // Try multiple selectors for display name
    const selectors = [
      'h1',
      '[class*="displayName"]',
      'header h2',
      '[data-pressable-container] span[dir="auto"]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim()) {
        return element.textContent.trim();
      }
    }

    return this.currentUsername || 'Unknown';
  }

  getFollowerCount() {
    // Look for follower count in the page
    const text = document.body.innerText;
    const followerMatch = text.match(/(\d+(?:,\d+)*(?:\.\d+)?(?:[KMB]|천|만|억)?)\s*(?:followers|팔로워)/i);

    if (followerMatch) {
      return followerMatch[1];
    }

    // Try to find element with follower info
    const links = document.querySelectorAll('a[href*="followers"]');
    for (const link of links) {
      const text = link.textContent;
      const match = text.match(/(\d+(?:,\d+)*(?:\.\d+)?(?:[KMB]|천|만|억)?)/i);
      if (match) {
        return match[1];
      }
    }

    return 'N/A';
  }

  getBio() {
    // Try to get bio/description
    const bioSelectors = [
      '[class*="bio"]',
      '[class*="description"]',
      'header + div span[dir="auto"]'
    ];

    for (const selector of bioSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim()) {
        return element.textContent.trim();
      }
    }

    return '';
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
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.shouldCancel = false;

    try {
      const profile = this.currentProfile || await this.getProfileInfo();
      if (!profile) {
        this.sendComplete(false, '프로필 정보를 가져올 수 없습니다.');
        return;
      }

      const totalFollowers = this.parseFollowerCount(profile.followerCount);
      this.sendProgress(0, totalFollowers || 0, '팔로워 목록 열기 중...');

      // Click on followers link
      const followersLink = await this.waitForElement('a[href*="followers"]');
      if (!followersLink) {
        this.sendComplete(false, '팔로워 목록을 열 수 없습니다.');
        return;
      }

      followersLink.click();

      // Wait for followers modal/page to load
      await this.sleep(2000);

      // Block followers as they load
      const result = await this.blockFollowersFromList(totalFollowers);

      if (result.cancelled) {
        this.sendComplete(false, `차단 취소됨 (${result.blocked}/${result.total} 완료)`);
        return;
      }

      if (result.total === 0) {
        this.sendComplete(false, '팔로워를 찾을 수 없습니다.');
        return;
      }

      this.sendComplete(true, `${result.blocked}명의 팔로워를 차단했습니다.`);

    } catch (error) {
      console.error('Error blocking followers:', error);
      this.sendComplete(false, `오류 발생: ${error.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  async blockFollowersFromList(totalFollowers) {
    const followers = new Set();
    let blocked = 0;
    const total = totalFollowers || 0;

    this.sendProgress(0, total, '팔로워 목록 스크롤 중...');

    // Find the scrollable container
    const container = document.querySelector('[role="dialog"], [class*="modal"], main');

    let lastHeight = 0;
    let attempts = 0;
    const maxAttempts = 50;

    while (attempts < maxAttempts) {
      // Get all follower items currently visible
      const followerItems = document.querySelectorAll('[class*="UserListItem"], [data-pressable-container="true"] a[href^="/@"]');

      for (const item of followerItems) {
        if (this.shouldCancel) {
          return { cancelled: true, blocked, total: total || followers.size };
        }

        const link = item.href || item.querySelector('a')?.href;
        if (!link) continue;

        const usernameMatch = link.match(/@([^/?]+)/);
        if (!usernameMatch || followers.has(usernameMatch[1])) {
          continue;
        }

        followers.add(usernameMatch[1]);
        const itemContainer = item.closest('[class*="UserListItem"], [data-pressable-container="true"]') || item;
        const success = await this.blockUser({
          username: usernameMatch[1],
          profileUrl: link,
          element: itemContainer
        });

        if (success) {
          blocked++;
        }

        this.sendProgress(blocked, total || followers.size, `${usernameMatch[1]} 차단 완료`);

        // Rate limiting - wait between blocks
        await this.sleep(1000 + Math.random() * 500);
      }

      // Scroll down
      if (container) {
        container.scrollTop += 500;
      } else {
        window.scrollBy(0, 500);
      }

      await this.sleep(500);

      // Check if we've reached the bottom
      const currentHeight = container ? container.scrollHeight : document.body.scrollHeight;
      if (currentHeight === lastHeight) {
        attempts++;
      } else {
        attempts = 0;
        lastHeight = currentHeight;
      }

      this.sendProgress(blocked, total || followers.size, `${followers.size}명 발견...`);
    }

    return { blocked, total: total || followers.size, cancelled: false };
  }

  async blockUser(follower) {
    try {
      // Find the user's element and look for the three-dot menu or block button
      const userElement = follower.element || document.querySelector(`a[href="/@${follower.username}"]`);

      if (!userElement) {
        return false;
      }

      // Find the parent container
      const container = userElement.closest('[class*="UserListItem"], [data-pressable-container="true"]') || userElement;

      if (!container) {
        return false;
      }

      container.scrollIntoView({ block: 'center' });

      // Look for menu button (three dots)
      const menuButton = container.querySelector('[aria-label*="menu"], [aria-label*="More"], button[class*="more"]');

      if (menuButton) {
        menuButton.click();
        await this.sleep(300);

        // Look for block option
        const blockOption = this.findElementByText('[role="menuitem"], button', ['block', '차단']);

        if (blockOption) {
          blockOption.click();
          await this.sleep(300);

          // Confirm block if needed
          const confirmButton = this.findElementByText('button', ['block', '차단', 'confirm', '확인']);
          if (confirmButton) {
            confirmButton.click();
          }
        }
      }

      return true;
    } catch (error) {
      console.error(`Error blocking ${follower.username}:`, error);
      return false;
    }
  }

  async archiveProfile() {
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.shouldCancel = false;

    try {
      this.sendProgress(0, 4, '프로필 정보 수집 중...');

      const profile = await this.getProfileInfo();
      if (!profile) {
        this.sendComplete(false, '프로필 정보를 가져올 수 없습니다.');
        return;
      }

      this.sendProgress(1, 4, '게시물 수집 중...');

      // Collect threads
      const threads = await this.collectPosts({
        postType: 'thread',
        tabLabels: ['threads', '스레드', '게시물']
      });

      // Collect comments/replies
      const comments = await this.collectPosts({
        postType: 'comment',
        tabLabels: ['replies', '댓글', '답글']
      });

      const posts = [...threads, ...comments];

      this.sendProgress(2, 4, '스크린샷 캡처 중...');

      // Capture screenshots of posts
      const screenshots = await this.capturePostScreenshots(posts);

      this.sendProgress(3, 4, '데이터 저장 중...');

      // Save archive
      const archive = {
        id: `archive_${Date.now()}_${profile.username}`,
        username: profile.username,
        displayName: profile.displayName,
        profileUrl: profile.profileUrl,
        bio: profile.bio,
        followerCount: profile.followerCount,
        timestamp: new Date().toISOString(),
        posts: posts,
        threads: threads,
        comments: comments,
        screenshots: screenshots
      };

      // Send to background for storage
      chrome.runtime.sendMessage({
        type: 'SAVE_ARCHIVE',
        archive: archive
      });

      this.sendProgress(4, 4, '완료!');
      this.sendComplete(true, `@${profile.username}의 증거가 수집되었습니다.`);

    } catch (error) {
      console.error('Error archiving profile:', error);
      this.sendComplete(false, `오류 발생: ${error.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  async collectPosts(options = {}) {
    const { postType = 'thread', tabLabels = [] } = options;
    await this.switchToTab(tabLabels);
    const posts = [];
    const seen = new Set();

    // Scroll through the profile to load posts
    let lastHeight = 0;
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts && posts.length < 20) {
      // Find post elements
      const postElements = document.querySelectorAll('article, [class*="PostItem"], [data-pressable-container="true"][class*="post"]');

      for (const postEl of postElements) {
        // Get post link
        const postLink = postEl.querySelector('a[href*="/post/"]');
        const postUrl = postLink?.href;

        if (postUrl && !seen.has(postUrl)) {
          seen.add(postUrl);

          // Get post content
          const contentEl = postEl.querySelector('[class*="text"], [dir="auto"]');
          const content = contentEl?.textContent || '';

          // Get post timestamp
          const timeEl = postEl.querySelector('time, [class*="time"]');
          const timestamp = timeEl?.getAttribute('datetime') || timeEl?.textContent || '';

          posts.push({
            url: postUrl,
            content: content.substring(0, 500),
            timestamp: timestamp,
            type: postType,
            element: postEl
          });
        }
      }

      // Scroll down
      window.scrollBy(0, 800);
      await this.sleep(800);

      const currentHeight = document.body.scrollHeight;
      if (currentHeight === lastHeight) {
        attempts++;
      } else {
        attempts = 0;
        lastHeight = currentHeight;
      }
    }

    // Remove element references before sending (not serializable)
    return posts.map(p => ({
      url: p.url,
      content: p.content,
      timestamp: p.timestamp,
      type: p.type
    }));
  }

  async capturePostScreenshots(posts) {
    const screenshots = [];

    // We'll capture the visible viewport for now
    // Full screenshot implementation would require html2canvas

    // Scroll to top first
    window.scrollTo(0, 0);
    await this.sleep(500);

    // Request screenshot from background
    const response = await chrome.runtime.sendMessage({
      type: 'CAPTURE_SCREENSHOT'
    });

    if (response && response.screenshot) {
      screenshots.push({
        type: 'profile_overview',
        data: response.screenshot,
        timestamp: new Date().toISOString()
      });
    }

    return screenshots;
  }

  sendProgress(current, total, status) {
    chrome.runtime.sendMessage({
      type: 'PROGRESS_UPDATE',
      current: current,
      total: total,
      status: status
    });
  }

  sendComplete(success, message) {
    chrome.runtime.sendMessage({
      type: 'OPERATION_COMPLETE',
      success: success,
      message: message
    });
  }

  switchToTab(tabLabels) {
    if (!tabLabels || tabLabels.length === 0) {
      return Promise.resolve();
    }

    const tab = this.findElementByText('[role="tab"]', tabLabels)
      || this.findElementByText('a, button', tabLabels);
    if (!tab) {
      return Promise.resolve();
    }

    tab.click();
    return this.sleep(1000).then(() => {
      window.scrollTo(0, 0);
      return this.sleep(500);
    });
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

  parseFollowerCount(countText) {
    if (!countText) return null;

    const normalized = countText.replace(/,/g, '').replace(/\s+/g, '').trim();
    const match = normalized.match(/^(\d+(?:\.\d+)?)([kmb천만억])?$/i);

    if (!match) return null;

    const multipliers = { K: 1000, M: 1000000, B: 1000000000, 천: 1000, 만: 10000, 억: 100000000 };
    let value = parseFloat(match[1]);
    const unit = match[2]?.toUpperCase();

    if (unit && multipliers[unit]) {
      value *= multipliers[unit];
    }

    return Math.round(value);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Initialize
const sweeper = new ThreadsSweeper();

// Add floating action button on Threads profile pages
function addFloatingButton() {
  const url = window.location.href;
  if (!url.match(/threads\.com\/@[^/]+$/)) return;

  const existingBtn = document.getElementById('threads-sweeper-fab');
  if (existingBtn) return;

  const fab = document.createElement('div');
  fab.id = 'threads-sweeper-fab';
  fab.innerHTML = '🧹';
  fab.title = 'Threads Sweeper';

  fab.addEventListener('click', () => {
    // Open the extension popup programmatically isn't possible,
    // so we show a tooltip
    alert('Threads Sweeper를 사용하려면\n브라우저 툴바의 확장 프로그램 아이콘을 클릭하세요.');
  });

  document.body.appendChild(fab);
}

// Run on page load and navigation
addFloatingButton();

// Watch for SPA navigation
const observer = new MutationObserver(() => {
  addFloatingButton();
  sweeper.checkCurrentProfile();
});

observer.observe(document.body, { childList: true, subtree: true });
