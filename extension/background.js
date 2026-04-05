// VerifAI Browser Extension - Background Script
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "verifyWithVerifai",
    title: "Verify with VerifAI",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "verifyWithVerifai") {
    chrome.tabs.sendMessage(tab.id, { action: "verifySelection" });
  }
});
