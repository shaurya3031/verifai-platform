// VerifAI Browser Extension - Content Script
console.log('🛡️ VerifAI Guardian Active');

// Listen for selection or context menu triggers from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "verifySelection") {
        const selectedText = window.getSelection().toString();
        if (selectedText) {
            console.log('🔍 VerifAI: Verifying selection...', selectedText);
            // In a real extension, this would open a side panel or inject a tooltip
            alert(`VerifAI is analyzing: "${selectedText}"\n\nRedirecting to dashboard...`);
            window.open(`http://localhost:3000?claim=${encodeURIComponent(selectedText)}`, '_blank');
        }
    }
});
