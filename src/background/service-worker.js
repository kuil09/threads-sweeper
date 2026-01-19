// Background Service Worker
// Handles storage, screenshot capture, and PDF generation

import { StorageManager } from '../utils/storage.js';
import { PDFGenerator } from '../utils/pdf-generator.js';

const storage = new StorageManager();
const pdfGenerator = new PDFGenerator();

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep message channel open for async
});

async function handleMessage(message, sender, sendResponse) {
  switch (message.type) {
    case 'SAVE_ARCHIVE':
      try {
        await storage.saveArchive(message.archive);
        sendResponse({ success: true });

        // Notify popup that archive was saved
        chrome.runtime.sendMessage({ type: 'ARCHIVE_SAVED' });
      } catch (error) {
        console.error('Error saving archive:', error);
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'CAPTURE_SCREENSHOT':
      try {
        const screenshot = await captureScreenshot(sender.tab.id);
        sendResponse({ success: true, screenshot: screenshot });
      } catch (error) {
        console.error('Error capturing screenshot:', error);
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'GENERATE_PDF':
      try {
        await generatePDFReport(message.archiveIds);
        sendResponse({ success: true });
      } catch (error) {
        console.error('Error generating PDF:', error);
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'GET_ARCHIVE':
      try {
        const archive = await storage.getArchive(message.id);
        sendResponse({ success: true, archive: archive });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'GET_ALL_ARCHIVES':
      try {
        const archives = await storage.getAllArchives();
        sendResponse({ success: true, archives: archives });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
}

async function captureScreenshot(tabId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 100
    });
    return dataUrl;
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    return null;
  }
}

async function generatePDFReport(archiveIds) {
  const archives = [];

  for (const id of archiveIds) {
    const archive = await storage.getArchive(id);
    if (archive) {
      archives.push(archive);
    }
  }

  if (archives.length === 0) {
    throw new Error('No archives found');
  }

  const pdfBlob = await pdfGenerator.generate(archives);

  // Create download
  const url = URL.createObjectURL(pdfBlob);
  const filename = `threads_evidence_${new Date().toISOString().split('T')[0]}.pdf`;

  await chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: true
  });
}

// Context menu for quick actions
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'archive-profile',
    title: '이 프로필 증거 수집',
    contexts: ['page'],
    documentUrlPatterns: ['https://www.threads.com/@*']
  });

  chrome.contextMenus.create({
    id: 'block-followers',
    title: '이 계정의 팔로워 전체 차단',
    contexts: ['page'],
    documentUrlPatterns: ['https://www.threads.com/@*']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'archive-profile') {
    chrome.tabs.sendMessage(tab.id, { type: 'ARCHIVE_PROFILE' });
  } else if (info.menuItemId === 'block-followers') {
    chrome.tabs.sendMessage(tab.id, { type: 'BLOCK_FOLLOWERS' });
  }
});
