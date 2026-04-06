console.log("EZ News service-worker loaded");

const API_BASE = "https://ez-news-backend.onrender.com";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "REWRITE_ARTICLE") {
    handleRewrite(message.tabId, sendResponse);
    return true;
  }

  if (message.type === "RESTORE_ARTICLE") {
    handleRestore(message.tabId, sendResponse);
    return true;
  }
});

async function handleRewrite(tabId, sendResponse) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        function isVisible(el) {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0" &&
            el.offsetHeight > 0 &&
            el.offsetWidth > 0
          );
        }

        function cleanText(text) {
          return (text || "")
            .replace(/\s+/g, " ")
            .replace(/\u00A0/g, " ")
            .trim();
        }

        function isBadParagraph(p) {
          const text = cleanText(p.innerText);
          if (!text) return true;
          if (text.length < 35) return true;

          const classBlob = [
            p.className || "",
            p.parentElement?.className || "",
            p.closest("[class]")?.className || ""
          ]
            .join(" ")
            .toLowerCase();

          const badWords = [
            "caption",
            "promo",
            "related",
            "newsletter",
            "subscribe",
            "advert",
            "ad-",
            "footer",
            "byline",
            "timestamp",
            "share",
            "social",
            "comment",
            "cookie",
            "banner",
            "nav",
            "menu",
            "read-more",
            "most-read",
            "trending",
            "liveblog",
            "live-blog"
          ];

          if (badWords.some(word => classBlob.includes(word))) return true;

          return false;
        }

        function paragraphScore(p) {
          const text = cleanText(p.innerText);
          let score = text.length;
          if (text.length > 80) score += 50;
          if (text.length > 150) score += 50;
          if (/[.!?]/.test(text)) score += 20;
          return score;
        }

        function scoreContainer(container) {
          if (!container || !isVisible(container)) return 0;

          const paragraphs = Array.from(container.querySelectorAll("p"))
            .filter(isVisible)
            .filter(p => !isBadParagraph(p));

          if (!paragraphs.length) return 0;

          let score = 0;
          for (const p of paragraphs) score += paragraphScore(p);

          if (container.tagName.toLowerCase() === "article") score += 200;

          const cls = ((container.className || "") + " " + (container.id || "")).toLowerCase();
          const goodHints = ["article", "story", "content", "post", "body", "main"];
          if (goodHints.some(h => cls.includes(h))) score += 100;

          return score;
        }

        function getBestContainer() {
          const candidates = new Set();
          const selectors = [
            "article",
            '[role="article"]',
            "main",
            '[class*="article"]',
            '[class*="story"]',
            '[class*="content"]',
            '[class*="post"]',
            '[class*="body"]',
            '[id*="article"]',
            '[id*="story"]',
            '[id*="content"]',
            '[itemprop="articleBody"]'
          ];

          for (const selector of selectors) {
            document.querySelectorAll(selector).forEach(el => candidates.add(el));
          }

          document.querySelectorAll("p").forEach(p => {
            if (p.parentElement) candidates.add(p.parentElement);
            if (p.parentElement?.parentElement) candidates.add(p.parentElement.parentElement);
          });

          let best = null;
          let bestScore = 0;

          for (const candidate of candidates) {
            const score = scoreContainer(candidate);
            if (score > bestScore) {
              bestScore = score;
              best = candidate;
            }
          }

          return best;
        }

        function getNodePath(el) {
          const path = [];
          let current = el;

          while (current && current !== document.body) {
            const parent = current.parentElement;
            if (!parent) break;

            const siblings = Array.from(parent.children);
            const index = siblings.indexOf(current);

            path.unshift({
              tag: current.tagName,
              index
            });

            current = parent;
          }

          return path;
        }

        function getHeadlineElement() {
          const h1s = Array.from(document.querySelectorAll("h1")).filter(isVisible);
          if (!h1s.length) return null;
          h1s.sort((a, b) => cleanText(b.innerText).length - cleanText(a.innerText).length);
          return h1s[0];
        }

        const headlineEl = getHeadlineElement();
        const container = getBestContainer();

        if (!headlineEl && !container) {
          return { ok: false };
        }

        const paragraphNodes = container
          ? Array.from(container.querySelectorAll("p"))
              .filter(isVisible)
              .filter(p => !isBadParagraph(p))
          : [];

        return {
          ok: true,
          headline: headlineEl ? cleanText(headlineEl.innerText) : "",
          bodyText: paragraphNodes.map(p => cleanText(p.innerText)).join("\n\n"),
          headlinePath: headlineEl ? getNodePath(headlineEl) : null,
          paragraphPaths: paragraphNodes.map(getNodePath),
          originalParagraphs: paragraphNodes.map(p => cleanText(p.innerText))
        };
      }
    });

    if (!result?.ok || (!result.headline && !result.bodyText)) {
      sendResponse({ ok: false, error: "Could not detect article text." });
      return;
    }

    await chrome.storage.local.set({
      [`original_${tabId}`]: {
        headline: result.headline,
        bodyParagraphs: result.originalParagraphs,
        headlinePath: result.headlinePath,
        paragraphPaths: result.paragraphPaths
      }
    });

    const res = await fetch(`${API_BASE}/rewrite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: result.headline || "",
        text: result.bodyText || "",
        url: ""
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      sendResponse({ ok: false, error: `Backend request failed: ${errText}` });
      return;
    }

    const data = await res.json();
    const rewrittenHeadline = (data.headline || "").trim();
    const rewrittenBody = (data.body || "").trim();

    await chrome.scripting.executeScript({
      target: { tabId },
      args: [rewrittenHeadline, rewrittenBody],
      func: (rewrittenHeadline, rewrittenBody) => {
        const h1s = Array.from(document.querySelectorAll("h1"));
        if (h1s.length && rewrittenHeadline) {
          h1s.sort((a, b) => (b.innerText || "").length - (a.innerText || "").length);
          h1s[0].textContent = rewrittenHeadline;
        }
      }
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      args: [result.paragraphPaths, rewrittenBody],
      func: (paragraphPaths, rewrittenBody) => {
        function resolvePath(path) {
          let current = document.body;
          for (const step of path) {
            if (!current || !current.children || !current.children[step.index]) return null;
            current = current.children[step.index];
          }
          return current;
        }

        let rewrittenParagraphs = rewrittenBody
          .split(/\n\s*\n/)
          .map(p => p.trim())
          .filter(Boolean);

        const originalNodes = paragraphPaths
          .map(resolvePath)
          .filter(Boolean);

        if (!originalNodes.length) return;

        if (rewrittenParagraphs.length === 1 && originalNodes.length > 1) {
          const words = rewrittenParagraphs[0].split(/\s+/);
          const chunkSize = Math.ceil(words.length / originalNodes.length);
          rewrittenParagraphs = [];

          for (let i = 0; i < originalNodes.length; i++) {
            rewrittenParagraphs.push(
              words.slice(i * chunkSize, (i + 1) * chunkSize).join(" ")
            );
          }
        }

        if (rewrittenParagraphs.length < originalNodes.length) {
          const joined = rewrittenParagraphs.join(" ");
          const words = joined.split(/\s+/);
          const chunkSize = Math.ceil(words.length / originalNodes.length);
          rewrittenParagraphs = [];

          for (let i = 0; i < originalNodes.length; i++) {
            rewrittenParagraphs.push(
              words.slice(i * chunkSize, (i + 1) * chunkSize).join(" ")
            );
          }
        }

        for (let i = 0; i < originalNodes.length; i++) {
          originalNodes[i].textContent = rewrittenParagraphs[i] || "";
        }
      }
    });

    sendResponse({ ok: true });
  } catch (err) {
    sendResponse({ ok: false, error: String(err) });
  }
}

async function handleRestore(tabId, sendResponse) {
  try {
    const storageKey = `original_${tabId}`;
    const data = await chrome.storage.local.get([storageKey]);
    const original = data[storageKey];

    if (!original) {
      sendResponse({ ok: false, error: "No original article stored for this tab." });
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      args: [original],
      func: (original) => {
        function resolvePath(path) {
          let current = document.body;
          for (const step of path) {
            if (!current || !current.children || !current.children[step.index]) return null;
            current = current.children[step.index];
          }
          return current;
        }

        if (original.headlinePath && original.headline) {
          const headlineEl = resolvePath(original.headlinePath);
          if (headlineEl) {
            headlineEl.textContent = original.headline;
          }
        }

        if (Array.isArray(original.paragraphPaths) && Array.isArray(original.bodyParagraphs)) {
          for (let i = 0; i < original.paragraphPaths.length; i++) {
            const node = resolvePath(original.paragraphPaths[i]);
            if (node) {
              node.textContent = original.bodyParagraphs[i] || "";
            }
          }
        }
      }
    });

    sendResponse({ ok: true });
  } catch (err) {
    sendResponse({ ok: false, error: String(err) });
  }
}