'use strict';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ senaiExtensionsSettings: null }, values => {
    if (values.senaiExtensionsSettings) return;
    chrome.storage.local.set({
      senaiExtensionsSettings: {
        modules: { moodle: true, drivePdf: true, kahoot: true },
        moodle: {
          importer: true,
          gradeReports: true,
          coursePendingChecks: true,
          categoryPendingChecks: true,
          pendingBadges: true,
          pendingDownloads: true,
          overwriteGrades: true,
          overwriteFeedback: true,
          flexibleNames: true
        },
        drivePdf: { includeBackground: true, compactMargins: false },
        kahoot: { replaceCurrent: true, validateBeforeRun: true, delayMs: 900 }
      }
    });
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SENAI_EXT_OPEN_MANAGE') {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    sendResponse({ ok: true });
  }
});
