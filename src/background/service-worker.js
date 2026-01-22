// Background Service Worker
// Handles background blocking queue and worker tab management

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
  GET_QUEUE_STATUS: 'GET_QUEUE_STATUS',
  COLLECTION_STARTED: 'COLLECTION_STARTED',
  COLLECTION_STOPPED: 'COLLECTION_STOPPED',
  SET_MAX_PARALLEL: 'SET_MAX_PARALLEL',
  RATE_LIMIT_DETECTED: 'RATE_LIMIT_DETECTED'
};


// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep message channel open for async
});

// Open Side Panel on icon click
chrome.action.onClicked.addListener((tab) => {
  // Open side panel in the current window
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Detect Window Closure
chrome.windows.onRemoved.addListener((windowId) => {
  // Legacy single-worker cleanup (backwards compatibility)
  if (automationWindowId && windowId === automationWindowId) {
    console.log('[Queue] Legacy automation window closed by user.');
    automationWindowId = null;
    activeTabId = null;
    isProcessingQueue = false; // processing will be restarted on resume/start
  }

  // Worker-pool cleanup
  const workerIndex = workers.findIndex(w => w && w.windowId === windowId);
  if (workerIndex !== -1) {
    console.log(`[Queue] Worker window #${workerIndex + 1} closed by user.`);
    workers[workerIndex] = { windowId: null, tabId: null, busy: false, currentUser: null, retire: false };
  }
  if (workerWindowIds.has(windowId)) {
    workerWindowIds.delete(windowId);
  }
});

async function handleMessage(message, sender, sendResponse) {
  switch (message.type) {
    case MESSAGE_TYPES.QUEUE_BLOCK_USERS:
      // Fix: Pass autoStart from message (default to true if undefined)
      // Fix: Handle null tab (popup)
      addToBlockQueue(message.users, sender.tab?.id || null, sender.tab?.url || null, message.autoStart);
      sendResponse({ success: true });
      break;

    case MESSAGE_TYPES.STOP_BLOCKING:
      await stopBlocking();
      sendResponse({ success: true });
      break;

    case MESSAGE_TYPES.PAUSE_BLOCKING:
      // Soft pause: stop assigning new jobs, but let in-flight jobs finish naturally.
      isProcessingQueue = false;
      console.log('[Queue] Paused by user.');
      sendResponse({ success: true });
      break;

    case MESSAGE_TYPES.RESUME_BLOCKING:
      if (!isProcessingQueue) {
        processBlockQueue();
      }
      sendResponse({ success: true });
      break;

    case MESSAGE_TYPES.START_BLOCKING:
      if (message.users && message.users.length > 0) {
        // Re-populate queue if provided (persistence fix)
        // Fix: Handle null tab (popup messages don't have sender.tab)
        addToBlockQueue(message.users, sender.tab?.id || null, sender.tab?.url || null, false);
      }
      if (!isProcessingQueue) {
        processBlockQueue();
      }
      sendResponse({ success: true });
      break;

    case MESSAGE_TYPES.GET_QUEUE_STATUS:
      sendResponse({
        success: true,
        count: blockQueue.length,
        isProcessing: isProcessingQueue,
        queue: blockQueue // Return full list for UI sync
      });
      break;

    case MESSAGE_TYPES.SET_MAX_PARALLEL: {
      const value = typeof message.value === 'number' ? message.value : 1;
      maxParallelWorkers = Math.max(1, Math.min(10, value));
      console.log('[Queue] Updated maxParallelWorkers =', maxParallelWorkers);
      if (workers.length > maxParallelWorkers) {
        for (let i = maxParallelWorkers; i < workers.length; i++) {
          closeWorker(i, 'max_parallel_reduced');
        }
      }
      if (workerWindowIds.size > maxParallelWorkers) {
        const keepIds = new Set(
          workers
            .slice(0, maxParallelWorkers)
            .filter(w => w && w.windowId)
            .map(w => w.windowId)
        );
        for (const windowId of [...workerWindowIds]) {
          if (!keepIds.has(windowId)) {
            try {
              await chrome.windows.remove(windowId);
            } catch (e) { /* ignore */ }
            workerWindowIds.delete(windowId);
          }
        }
      }
      sendResponse({ success: true, maxParallelWorkers });
      break;
    }

    case MESSAGE_TYPES.COLLECTION_STARTED:
      collectionWindowId = message.windowId;
      console.log(`[Window] Enforcing size on window ${collectionWindowId}`);
      sendResponse({ success: true });
      break;

    case MESSAGE_TYPES.COLLECTION_STOPPED:
    case MESSAGE_TYPES.PAUSE_COLLECTION: // Treat pause as stop for enforcement? Maybe keep enforcing?
      // User asked "during collection". If paused, maybe relax? 
      // Safest to stop enforcement on pause or stop to allow user control.
      if (collectionWindowId === message.windowId || !message.windowId) {
        console.log(`[Window] Stopped enforcing size on window ${collectionWindowId}`);
        collectionWindowId = null;
      }
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
}



// --- Background Blocking Logic ---

let blockQueue = [];
let isProcessingQueue = false;
let collectionWindowId = null; // Track window for size enforcement
let resizeTimeout = null;

// Enforce Window Size
chrome.windows.onBoundsChanged.addListener((window) => {
  if (collectionWindowId && window.id === collectionWindowId) {
    if (window.width < 1024) {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        console.log('[Window] Enforcing minimum width 1024px...');
        chrome.windows.update(window.id, { width: 1280, height: 900 }).catch(() => { });
      }, 500); // 500ms debounce
    }
  }
});

let activeTabId = null; // The tab inside the automation window (legacy)
let automationWindowId = null; // The dedicated window ID (legacy single-worker reference)
let mainPageUrl = 'https://www.threads.net/'; // Dynamic base URL

// Parallel worker pool configuration
let maxParallelWorkers = 1; // Updated via SET_MAX_PARALLEL (1~10)

// Each worker represents one automation window + active tab + current job
// workers[i] = { windowId, tabId, busy, currentUser, retire, resolver }
let workers = [];
let workerWindowIds = new Set();
let creatingWorkers = new Set();

function getActiveWorkerCount() {
  return workers.filter(w => !!w && w.busy).length;
}

async function ensureWorker(index) {
  if (index >= maxParallelWorkers) return null;
  if (creatingWorkers.has(index)) return null;
  if (workers[index] && workers[index].windowId && workers[index].tabId) {
    try {
      await chrome.windows.get(workers[index].windowId);
      await chrome.tabs.get(workers[index].tabId);
      return workers[index];
    } catch (e) {
      // Fall through to recreate
    }
  }

  console.log(`[Queue] Creating automation window #${index + 1} on ${mainPageUrl}...`);
  creatingWorkers.add(index);
  const win = await chrome.windows.create({
    url: mainPageUrl,
    type: 'popup',
    width: 375,
    height: 800,
    focused: index === 0 // Focus only first worker by default
  });
  workerWindowIds.add(win.id);

  const tabId = win.tabs[0].id;
  await waitForTabLoad(tabId);
  await new Promise(r => setTimeout(r, 2000)); // Warm up execution context
  creatingWorkers.delete(index);

  const worker = {
    windowId: win.id,
    tabId,
    busy: false,
    currentUser: null,
    retire: false,
    resolver: null
  };
  workers[index] = worker;
  return worker;
}

async function closeWorker(index, reason = 'cleanup') {
  const worker = workers[index];
  if (!worker) return;

  if (worker.busy) {
    worker.retire = true;
    console.log(`[Queue] Worker #${index + 1} marked for retirement (${reason}).`);
    return;
  }

  if (worker.windowId) {
    try {
      await chrome.windows.remove(worker.windowId);
    } catch (e) { /* ignore */ }
  }
  if (worker.windowId && workerWindowIds.has(worker.windowId)) {
    workerWindowIds.delete(worker.windowId);
  }
  workers[index] = { windowId: null, tabId: null, busy: false, currentUser: null, retire: false, resolver: null };
  console.log(`[Queue] Worker #${index + 1} closed (${reason}).`);
}

// Starts a job on a worker (non-blocking - runs in background)
function startWorkerJob(index) {
  if (index >= maxParallelWorkers) return;
  const worker = workers[index];
  if (!worker || worker.busy) return;
  if (blockQueue.length === 0) return;

  const username = blockQueue.shift();
  if (!username) return;

  worker.busy = true;
  worker.currentUser = username;

  console.log(`[Queue] Worker #${index + 1} starting job for ${username}. Remaining in queue: ${blockQueue.length}`);

  // Run job in background (don't await)
  executeBlockJob(index, worker, username);
}

// Executes the actual blocking job
async function executeBlockJob(index, worker, username) {
  try {
    const result = await runBlockJob(worker, username);

    // Check for rate limit detection
    if (result.isRateLimited) {
      console.error(`[Queue] Rate limit detected for ${username}. Stopping all operations.`);

      // Add current user back to the front of the queue
      blockQueue.unshift(username);

      // Stop all blocking operations
      await stopBlocking();

      // Notify popup about rate limit
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.RATE_LIMIT_DETECTED,
        error: result.error,
        code: result.code
      }).catch(() => { });

      return;
    }

    if (!result.success && result.error && result.error.includes('showing error page')) {
      console.warn(`[Queue] Error Page detected for ${username}. Skipping...`);
      notifyProgress(username, false, '페이지 로드 실패 (404/Network)');
    } else {
      console.log(`[Queue] Job finished for ${username}:`, result);
      notifyProgress(username, result.success, result.error);
    }
  } catch (error) {
    console.error(`[Queue] Critical error processing ${username} on worker #${index + 1}:`, error);
    notifyProgress(username, false, error.message);
  } finally {
    worker.busy = false;
    worker.currentUser = null;
    worker.resolver = null;

    if (worker.retire) {
      await closeWorker(index, 'retire');
      return;
    }

    // If there are still items in the queue and we are not paused/stopped, pick up the next job.
    if (isProcessingQueue && blockQueue.length > 0) {
      startWorkerJob(index);
    } else {
      console.log(`[Queue] Worker #${index + 1} idle. Queue length: ${blockQueue.length}`);
    }
  }
}

function addToBlockQueue(users, tabId, currentUrl, autoStart = true) {
  // Update context if starting new batch
  if (!isProcessingQueue) {
    if (currentUrl) {
      try {
        const hostname = new URL(currentUrl).hostname;
        if (hostname.includes('threads.com')) {
          mainPageUrl = 'https://www.threads.com/';
        } else {
          mainPageUrl = 'https://www.threads.net/';
        }
      } catch (e) {
        mainPageUrl = 'https://www.threads.net/';
      }
    }
  }

  // Get currently processing users from all workers
  const currentlyProcessing = new Set(
    workers.filter(w => w && w.currentUser).map(w => w.currentUser)
  );

  // Filter duplicates (Strict: not in queue AND not currently being processed by any worker)
  const uniqueInput = [...new Set(users)]; // Deduplicate input batch first
  const newUsers = uniqueInput.filter(u =>
    !blockQueue.includes(u) && !currentlyProcessing.has(u)
  );

  blockQueue.push(...newUsers);

  const skippedCount = users.length - newUsers.length;
  console.log(`[Queue] Received ${users.length} users. Added ${newUsers.length}. Skipped ${skippedCount} duplicates. Total Queue: ${blockQueue.length}`);

  if (autoStart && !isProcessingQueue && blockQueue.length > 0) {
    processBlockQueue();
  }
}

async function stopBlocking() {
  console.log('[Queue] Stopping all blocking operations (full reset)');
  // Clear queue entirely
  blockQueue = [];
  isProcessingQueue = false;

  // Resolve all workers' jobs to cancel them (best-effort)
  for (const worker of workers) {
    if (worker && worker.resolver) {
      worker.resolver({ success: false, error: 'Stopped by user' });
      worker.resolver = null;
    }
  }

  // Close all worker windows
  for (const worker of workers) {
    if (worker && worker.windowId) {
      try {
        await chrome.windows.remove(worker.windowId);
      } catch (e) { /* ignore */ }
    }
  }
  for (const windowId of workerWindowIds) {
    try {
      await chrome.windows.remove(windowId);
    } catch (e) { /* ignore */ }
  }
  workers = [];
  workerWindowIds.clear();
  creatingWorkers.clear();

  // Legacy single-window cleanup
  if (automationWindowId) {
    try {
      await chrome.windows.remove(automationWindowId);
    } catch (e) { /* ignore */ }
    automationWindowId = null;
    activeTabId = null;
  }
}

// Main Processing Loop - Worker Pool
async function processBlockQueue() {
  if (isProcessingQueue) return;
  if (blockQueue.length === 0) return;

  isProcessingQueue = true;
  
  // Capture maxParallelWorkers at the start of processing to ensure consistent behavior.
  // This prevents mid-flight changes from affecting the current batch.
  const effectiveMaxWorkers = maxParallelWorkers;
  console.log('[Queue] Starting processing loop with worker pool. Queue length:', blockQueue.length, 'effectiveMaxWorkers:', effectiveMaxWorkers);

  try {
    // Calculate the number of workers to create: exactly the minimum of:
    // 1. User-selected concurrency (effectiveMaxWorkers)
    // 2. Number of users in the queue (no point in creating more workers than users)
    const initialWorkers = Math.min(effectiveMaxWorkers, blockQueue.length);
    console.log('[Queue] Initializing', initialWorkers, 'worker(s)...');

    // Create all workers first, THEN start processing.
    // This ensures only the selected number of windows open before any work begins.
    for (let i = 0; i < initialWorkers; i++) {
      await ensureWorker(i);
    }

    // Start jobs on all workers (non-blocking)
    for (let i = 0; i < initialWorkers; i++) {
      startWorkerJob(i);
    }

    // Wait until queue is empty and all workers are idle, or we are paused/stopped.
    while (isProcessingQueue && (blockQueue.length > 0 || getActiveWorkerCount() > 0)) {
      // If some workers are idle while queue still has items, assign new jobs to them.
      // Only use workers up to the initial count (effectiveMaxWorkers) - no dynamic expansion.
      if (blockQueue.length > 0) {
        for (let i = 0; i < initialWorkers; i++) {
          const worker = workers[i];
          if (worker && !worker.busy) {
            startWorkerJob(i);
          }
        }
      }
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (err) {
    console.error('[Queue] Fatal error in worker-pool loop:', err);
  } finally {
    const anyBusy = getActiveWorkerCount() > 0;
    const queueEmpty = blockQueue.length === 0;

    isProcessingQueue = false;

    // Auto-close worker windows only when work really finished (not paused).
    if (queueEmpty && !anyBusy) {
      console.log('[Queue] All blocking jobs completed. Cleaning up worker windows.');
      for (const worker of workers) {
        if (worker && worker.windowId) {
          try {
            await chrome.windows.remove(worker.windowId);
          } catch (e) { /* ignore */ }
        }
      }
      for (const windowId of workerWindowIds) {
        try {
          await chrome.windows.remove(windowId);
        } catch (e) { /* ignore */ }
      }
      workers = [];
      workerWindowIds.clear();
      creatingWorkers.clear();

      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.ALL_BLOCKING_COMPLETE }).catch(() => { });
    } else {
      console.log('[Queue] Processing loop exited (queue or workers still active).');
    }
  }
}

// Wraps the blocking process in a Promise
function runBlockJob(worker, username) {
  const tabId = worker.tabId;
  return new Promise(async (resolve) => {
    // Store resolver on worker so it can be cancelled independently
    worker.resolver = resolve;

    try {
      console.log(`[Queue] Processing ${username} on tab ${tabId}`);

      // 1. Setup load listener BEFORE navigation to avoid race conditions
      const loadPromise = new Promise(resolveLoad => {
        const listener = (tid, changeInfo) => {
          if (tid === tabId && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolveLoad();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        // Timeout safety for load
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolveLoad();
        }, 15000);
      });

      // 2. Navigate to user profile
      const baseUrl = mainPageUrl.replace(/\/$/, '');
      const targetUrl = `${baseUrl}/@${username}`;
      await chrome.tabs.update(tabId, { url: targetUrl });

      // 3. Wait for load completion
      await loadPromise;

      // 4. Inject blocking script and get result directly
      try {
        const [scriptResult] = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: performBlockAction,
          args: [username]
        });

        // executeScript returns the function's return value in result property
        const result = scriptResult?.result || { success: false, error: 'No result from script' };
        resolve(result);
        worker.resolver = null;

      } catch (scriptError) {
        if (scriptError.message.includes('showing error page')) {
          resolve({ success: false, error: 'showing error page' });
          worker.resolver = null;
          return;
        }
        resolve({ success: false, error: scriptError.message });
        worker.resolver = null;
      }

    } catch (error) {
      console.error(`[Queue] Setup error for ${username}:`, error);
      resolve({ success: false, error: error.message });
      worker.resolver = null;
    }
  });
}

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const listener = (tid, changeInfo) => {
      if (tid === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });
}

function notifyProgress(username, success, error) {
  // Notify Popup
  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.BLOCK_RESULT,
    username,
    success,
    error
  }).catch(() => { });
}

// This function is injected into the page
async function performBlockAction(username) {
  console.log(`[Block Script] Started for ${username}`);

  const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const activeSleep = (min, max) => sleep(getRandomInt(min, max));

  // Verification timeout for checking Unblock button
  const UNBLOCK_VERIFICATION_TIMEOUT = 5000;

  // --- Helpers ---

  const waitFor = async (finder, timeout = 5000, name = 'Element') => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = finder();
      if (el) return el;
      await activeSleep(300, 800);
    }
    throw new Error(`${name} not found after ${timeout}ms`);
  };

  const getMenuButtonStrategies = () => {
    // English, Korean, and other common variations
    const allowedLabels = [
      'More', 'More options', 'See more',
      '더 보기', '옵션 더 보기', '설정', '더보기',
      'Menu', '메뉴'
    ];

    // Explicitly exclude common adjacent buttons to be safe
    const excludedLabels = [
      'Notification', 'Notifications', 'Turn on notifications',
      '알림', '알림 설정', '알림 켜기', '알림 끄기',
      'Back', '뒤로', 'Close', '닫기',
      'Share', '공유', '공유하기'
    ];

    const hasAllowedLabel = (el) => {
      const label = el.getAttribute('aria-label') || el.querySelector('svg')?.getAttribute('aria-label') || el.getAttribute('title');
      if (!label) return false;
      return allowedLabels.some(l => label.includes(l));
    };

    const hasExcludedLabel = (el) => {
      const label = el.getAttribute('aria-label') || el.querySelector('svg')?.getAttribute('aria-label') || el.getAttribute('title');
      if (!label) return false;
      return excludedLabels.some(l => label.includes(l));
    };

    // Helper to find the best button in a container
    const findBestButtonInContainer = (container, ignoreButtons = []) => {
      if (!container) return null;

      const buttons = Array.from(container.querySelectorAll('div[role="button"], button'));

      // 1. Exact Positive Match (High Confidence)
      const exactMatch = buttons.find(btn => !ignoreButtons.includes(btn) && hasAllowedLabel(btn));
      if (exactMatch) return exactMatch;

      // 2. Fallback: Find buttons with SVG that are NOT excluded
      // If multiple, normally "More" is the last one (Right-most).
      const candidates = buttons.filter(btn => {
        if (ignoreButtons.includes(btn)) return false;

        // precise label check: if it HAS a label, it must NOT be excluded.
        // if it has NO label, we keep it as candidate.
        if (hasExcludedLabel(btn)) return false;

        const hasSvg = !!btn.querySelector('svg');
        return hasSvg;
      });

      if (candidates.length > 0) {
        // Return the LAST candidate (Right-most assumption for "More" menu)
        return candidates[candidates.length - 1];
      }
      return null;
    };

    // Strategy 1: Find by Instagram icon proximity
    const findByInstagramProximity = () => {
      const instagramLinks = Array.from(document.querySelectorAll('a[href*="instagram.com"]'));
      for (const link of instagramLinks) {
        // Go up to the container (usually row)
        const container = link.closest('div').parentElement?.parentElement;
        const btn = findBestButtonInContainer(container);
        if (btn) return btn;
      }
      return null;
    };

    // Strategy 2: Find by Follow button proximity
    const findByFollowProximity = () => {
      const followButtons = Array.from(document.querySelectorAll('div[role="button"], button'));
      const followBtn = followButtons.find(b => {
        const text = b.innerText?.trim();
        return text === 'Follow' || text === '팔로우' || text === 'Following' || text === '팔로잉';
      });
      if (!followBtn) return null;

      const container = followBtn.closest('div').parentElement?.parentElement;
      return findBestButtonInContainer(container, [followBtn]);
    };

    // Strategy 3: Find by position and SVG (fallback)
    const findByPosition = () => {
      const root = document.querySelector('main, [role="main"]') || document.body;
      const candidates = Array.from(root.querySelectorAll('div[role="button"], button'));

      const matched = candidates.filter(el => {
        if (hasExcludedLabel(el)) return false;

        const isMatch = hasAllowedLabel(el);
        const hasSvg = !!el.querySelector('svg');

        // If no text, but has SVG and is in the header area (top-rightish of profile card)
        if (isMatch || (hasSvg && !el.innerText)) {
          const rect = el.getBoundingClientRect();
          // Exclude sticky header area (> 50px from top) but keep it generally top-ish
          // Profile menu is usually to the right (left > 200)
          return rect.width > 0 && rect.height > 0 && rect.top > 50 && rect.left > 200;
        }
        return false;
      });

      if (matched.length > 0) {
        // Sort by Top (highest first) -> Left (leftmost first)?
        // Actually we want the top-most, right-most button.
        // Primary sort: Top. Secondary sort: Left (descending for right-most).
        matched.sort((a, b) => {
          const rectA = a.getBoundingClientRect();
          const rectB = b.getBoundingClientRect();
          if (Math.abs(rectA.top - rectB.top) > 10) {
            return rectA.top - rectB.top; // Top first
          }
          return rectB.left - rectA.left; // Right first (Descending left)
        });

        console.log('[Block Script] Found button via Position Strategy');
        return matched[0];
      }
      return null;
    };

    return [findByInstagramProximity, findByFollowProximity, findByPosition];
  };

  const findMenuButton = () => {
    const strategies = getMenuButtonStrategies();
    for (const strategy of strategies) {
      const btn = strategy();
      if (btn) return btn;
    }
    return null;
  };

  const findUnblockButton = () => {
    // Strategy: Find any visible element that CONTAINS "Unblock" text.
    // We broaden the search to catch cases where role="button" might be missing or nested.
    const unblockTexts = ['차단 해제', '차단해제', 'Unblock'];

    // Broad candidate list: Buttons, generic divs/spans that might be buttons
    const candidates = document.querySelectorAll('div[role="button"], button, div[role="menuitem"], span, div');

    for (const el of candidates) {
      // Optimization: Skip elements with too many children (container likely)
      // We want leaf-like nodes or buttons
      if (el.childElementCount > 3) continue;

      const text = el.innerText?.trim() || '';
      if (!text) continue;

      // Check if text matches any unblock string
      const isMatch = unblockTexts.some(t => text === t || text === t + '...');

      // Relaxed check: Includes, but short length to avoid capturing huge blocks
      const includesMatch = unblockTexts.some(t => text.includes(t));

      if (includesMatch && text.length < 20) {
        // Validation: must be visible
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          console.log(`[Block Script] Found Unblock button: "${text}"`, el);
          return el;
        }
      }
    }
    return null;
  };

  const findBlockButton = () => {
    // Strategy: Search specifically for "Block" related actions.
    // Menus in Threads (and Instagram web) are often appended to the end of <body>.
    // They might not always have role="menu" or "dialog".

    // 1. Get all potential button candidates in the document
    // Focusing on the end of the document where modals usually live is good, but let's scan all visible.
    const candidates = Array.from(document.querySelectorAll('div[role="button"], button, span[dir="auto"], div[dir="auto"]'));

    // Filter for Block text
    const blockCandidates = candidates.filter(el => {
      const text = el.innerText?.trim();
      if (!text) return false;

      // Must contain Block-related text (English and Korean)
      const isBlockText = text.includes('Block') || text.includes('block') ||
        text === '차단' || text === '차단하기' || text.includes('차단');

      // Must NOT contain Unblock or other false positives
      const isNotUnblock = !text.includes('Unblock') && !text.includes('Blocked') &&
        !text.includes('차단 해제') && !text.includes('차단해제');

      return isBlockText && isNotUnblock;
    });

    if (blockCandidates.length === 0) return null;

    // Refinement: Threads "Block" button is usually RED.
    // We can use this to disambiguate if multiple found, or validatate.
    // rgb(255, 48, 64) is a common red color in Meta apps.

    const isRed = (el) => {
      const style = window.getComputedStyle(el);
      return style.color.includes('255, 48, 64') || style.color.includes('255, 0, 0') || style.color === 'red';
    };

    // Prioritize RED buttons
    const redCandidate = blockCandidates.find(el => isRed(el));
    if (redCandidate) {
      console.log('[Block Script] Found Block button (Red Style)', redCandidate);
      return redCandidate.closest('div[role="button"], button') || redCandidate;
    }

    // Fallback: Return the last one found (menus are usually last in DOM)
    // Make sure it's visible
    const visibleCandidates = blockCandidates.filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    if (visibleCandidates.length > 0) {
      const best = visibleCandidates[visibleCandidates.length - 1]; // Last added
      console.log('[Block Script] Found Block button (Text Match)', best);
      return best.closest('div[role="button"], button') || best;
    }

    return null;
  };

  const findConfirmButton = () => {
    // Confirm dialog is also appended to body.
    // We look for a "Block" action in a dialog context.

    // Try to find the dialog container first
    const dialogs = document.querySelectorAll('[role="dialog"]');
    let root = document.body;
    if (dialogs.length > 0) {
      root = dialogs[dialogs.length - 1];
    }

    const buttons = root.querySelectorAll('div[role="button"], button');
    for (const btn of buttons) {
      const text = btn.innerText?.trim(); // use innerText to get visible text
      if (!text) continue;

      // Strict Block confirmation
      if (
        (text === 'Block' || text === '차단' || text === '차단하기')
      ) {
        // Avoid "Cancel"
        return btn;
      }
    }
    return null;
  };

  // --- Rate Limit Detection ---

  const originalFetch = window.fetch;
  let rateLimitDetected = false;
  let rateLimitError = null;
  let rateLimitCode = null;

  try {
    // Intercept fetch to monitor GraphQL responses
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);

      // Check if this is a GraphQL request
      const url = args[0];
      if (url && url.toString().includes('/api/graphql')) {
        // Clone response to read it without consuming the original
        const clonedResponse = response.clone();
        try {
          const data = await clonedResponse.json();

          // Check for rate limit errors
          if (data.errors && Array.isArray(data.errors)) {
            for (const error of data.errors) {
              // Check for error code 1675004 or "rate limit" in message
              if (error.code === 1675004 ||
                (error.message && error.message.toLowerCase().includes('rate limit'))) {
                console.error('[Block Script] Rate limit detected:', error);
                rateLimitDetected = true;
                rateLimitError = error.message || 'Rate limit exceeded';
                rateLimitCode = error.code || 1675004;
                break;
              }
            }
          }
        } catch (e) {
          // Ignore JSON parse errors
        }
      }

      return response;
    };

    // --- Execution ---

    const initialDelay = getRandomInt(1500, 3000);
    console.log(`[Block Script] Waiting ${initialDelay}ms before starting...`);
    await sleep(initialDelay);

    // Early check for rate limit detection
    if (rateLimitDetected) {
      console.error('[Block Script] Rate limit detected before blocking, aborting.');
      return { success: false, error: rateLimitError, isRateLimited: true, code: rateLimitCode };
    }

    // 1. Check for "Unblock" button immediately on profile
    if (findUnblockButton()) {
      console.log('[Block Script] User already blocked (Unblock button on header). Success.');
      return { success: true, error: null };
    }

    // 2. Open Menu
    console.log('[Block Script] Looking for menu button...');
    const menuBtn = await waitFor(findMenuButton, 10000, 'Menu button');
    menuBtn.click();
    await activeSleep(1200, 2000);

    // 3. Check for "Unblock" button in menu (or profile if it appeared)
    if (findUnblockButton()) {
      console.log('[Block Script] User already blocked (Unblock option in menu/profile). Success.');
      return { success: true, error: null };
    }

    // 4. Look for Block option
    console.log('[Block Script] Looking for block option...');
    let blockBtn;
    try {
      blockBtn = await waitFor(findBlockButton, 3000, 'Block button');
    } catch (e) {
      // Block button not found. Verify if already blocked by checking for Unblock button.
      console.warn('[Block Script] Block button not found. Checking if already blocked...');
      try {
        await waitFor(findUnblockButton, UNBLOCK_VERIFICATION_TIMEOUT, 'Unblock button for verification');
        console.log('[Block Script] VERIFIED: Unblock button found. Already blocked. Success.');
        return { success: true, error: null };
      } catch (verifyError) {
        // Neither Block nor Unblock button found - actual error
        console.error('[Block Script] Neither Block nor Unblock button found. Cannot verify status.');
        throw new Error('Block button not found and could not verify if already blocked');
      }
    }

    blockBtn.click();
    await activeSleep(800, 1500);

    // Check for rate limit after clicking block button
    if (rateLimitDetected) {
      console.error('[Block Script] Rate limit detected after clicking block button.');
      return { success: false, error: rateLimitError, isRateLimited: true, code: rateLimitCode };
    }

    // 5. Confirm Block
    console.log('[Block Script] Looking for confirm button...');
    const confirmBtn = await waitFor(findConfirmButton, 8000, 'Confirm button');
    console.log('[Block Script] Clicking confirm');
    confirmBtn.click();

    // 6. Wait for Dialog Close & Verify
    console.log('[Block Script] Waiting for dialog to close...');

    const isDialogGone = () => !document.querySelector('[role="dialog"]');

    // We try to wait for the dialog to close, but we don't fail immediately if it times out via throw.
    // Instead we catch the error and Proceed to verification.
    try {
      await waitFor(isDialogGone, 5000, 'Dialog close');
      console.log('[Block Script] Dialog closed normally.');
    } catch (e) {
      console.warn('[Block Script] Dialog did not close in time (or Success toast appeared). verifying status...');
    }

    // Increase wait time to allow API response to complete
    await activeSleep(2000, 3000);

    // Check for rate limit after confirmation
    if (rateLimitDetected) {
      console.error('[Block Script] Rate limit detected after confirmation.');
      return { success: false, error: rateLimitError, isRateLimited: true, code: rateLimitCode };
    }

    // 7. Final Verification - Wait for Unblock button to appear
    console.log('[Block Script] Waiting for Unblock button to verify block success...');
    try {
      await waitFor(findUnblockButton, UNBLOCK_VERIFICATION_TIMEOUT, 'Unblock button verification');
      console.log('[Block Script] VERIFIED: Unblock button found. Block Successful.');
      return { success: true, error: null };
    } catch (e) {
      // Unblock button not found after waiting - this is a failure
      console.error('[Block Script] VERIFICATION FAILED: Unblock button not found after block attempt.');
      throw new Error('Verification Failed: Unblock button not found after block attempt');
    }



  } catch (error) {
    console.error('[Block Script] Error:', error);
    // Check if rate limit was detected during error handling
    if (rateLimitDetected) {
      return { success: false, error: rateLimitError, isRateLimited: true, code: rateLimitCode };
    }
    return { success: false, error: error.message };
  } finally {
    // Always restore original fetch
    window.fetch = originalFetch;
  }
}


