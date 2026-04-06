const rewriteBtn = document.getElementById("rewriteBtn");
const restoreBtn = document.getElementById("restoreBtn");
const upgradeBtn = document.getElementById("upgradeBtn");
const statusEl = document.getElementById("status");
const counterEl = document.getElementById("counter");
const loadingWrap = document.getElementById("loadingWrap");
const loadingText = document.getElementById("loadingText");

const DAILY_LIMIT = 20;

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getUsage() {
  const data = await chrome.storage.local.get(["usageDate", "usageCount"]);
  const today = getTodayKey();

  let usageDate = data.usageDate;
  let usageCount = data.usageCount || 0;

  if (usageDate !== today) {
    usageDate = today;
    usageCount = 0;
    await chrome.storage.local.set({ usageDate, usageCount });
  }

  return { usageDate, usageCount };
}

async function refreshCounter() {
  const { usageCount } = await getUsage();
  const remaining = Math.max(0, DAILY_LIMIT - usageCount);
  counterEl.textContent = `${remaining}/${DAILY_LIMIT} left today`;
}

async function incrementUsage() {
  const { usageCount } = await getUsage();
  await chrome.storage.local.set({ usageCount: usageCount + 1 });
}

function setStatus(message) {
  statusEl.textContent = message || "";
}

function showLoading(message) {
  loadingText.textContent = message;
  loadingWrap.classList.remove("hidden");
  statusEl.textContent = "";
}

function hideLoading() {
  loadingWrap.classList.add("hidden");
}

function setLoadingState(isLoading, message = "") {
  rewriteBtn.disabled = isLoading;
  restoreBtn.disabled = isLoading;
  upgradeBtn.disabled = isLoading;

  if (isLoading) {
    rewriteBtn.textContent = "Working...";
    showLoading(message || "Cooking the article...");
  } else {
    rewriteBtn.textContent = "Rewrite article";
    hideLoading();
  }
}

rewriteBtn.addEventListener("click", async () => {
  setStatus("");
  const { usageCount } = await getUsage();

  if (usageCount >= DAILY_LIMIT) {
    hideLoading();
    setStatus("You’re out of free rewrites for today. Upgrade for unlimited.");
    await refreshCounter();
    return;
  }

  setLoadingState(true, "Cooking the article...");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.runtime.sendMessage(
    { type: "REWRITE_ARTICLE", tabId: tab.id },
    async (response) => {
      setLoadingState(false);

      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message);
        return;
      }

      if (response?.ok) {
        await incrementUsage();
        await refreshCounter();
        setStatus("Done. Article rewritten.");
      } else {
        setStatus(response?.error || "Failed.");
      }
    }
  );
});

restoreBtn.addEventListener("click", async () => {
  setStatus("");
  setLoadingState(true, "Restoring the original article...");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.runtime.sendMessage(
    { type: "RESTORE_ARTICLE", tabId: tab.id },
    (response) => {
      setLoadingState(false);

      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message);
        return;
      }

      setStatus(response?.ok ? "Original restored." : (response?.error || "Failed."));
    }
  );
});

upgradeBtn.addEventListener("click", () => {
  hideLoading();
  setStatus("Upgrade screen coming next.");
});

refreshCounter();
hideLoading();
setStatus("");