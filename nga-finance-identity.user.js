// ==UserScript==
// @name         NGA大韭菜指数
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  一键抓取NGA用户回帖，分析其金融身份(韭菜、反串、大神)。通过自定义 OpenAI 兼容接口调用第三方 AI。
// @author       You
// @match        *://bbs.nga.cn/read.php?*
// @match        *://ngabbs.com/read.php?*
// @match        *://*.ngabbs.com/read.php?*
// @match        *://www.nga.cn/read.php?*
// @match        *://g.nga.cn/read.php?*
// @match        *://nga.178.com/read.php?*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// @connect      *
// @downloadURL  https://raw.githubusercontent.com/fuchaohan/nga-finance-identity/main/nga-finance-identity.user.js
// @updateURL    https://raw.githubusercontent.com/fuchaohan/nga-finance-identity/main/nga-finance-identity.user.js
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ===================== 核心配置 =====================
    const MAX_CONTENT_LEN = 12000;
    const MIN_CONTENT_LEN = 50;
    const STORAGE_KEY = "nga_finance_content";
    const RESULT_KEY = "nga_finance_result";

    // AI 接口配置 (持久化存储)
    const CFG_BASE_URL = "nga_finance_base_url";
    const CFG_API_KEY = "nga_finance_api_key";
    const CFG_MODEL = "nga_finance_model";

    // 默认值 (用户可通过油猴菜单修改)
    const DEFAULT_BASE_URL = "https://api.openai.com/v1";
    const DEFAULT_MODEL = "gpt-4o-mini";
    const FIXED_DISCLAIMER = "以上内容基于公开论坛发言的人工智能分析，仅供娱乐参考，不构成任何投资建议。";
    const DEBUG_SERVER_URL = "http://127.0.0.1:7777/event";
    const DEBUG_SESSION_ID = "deepseek-no-response";
    const DEBUG_RUN_ID = "pre-fix";
    var screenshotImageCache = Object.create(null);

    // ===================== Prompt =====================
    const PROMPT = `===== [金融身份鉴定 开始] =====
[背景] 你是一名资深的金融社区观察员和心理学专家。请根据用户在NGA等论坛的回帖内容，输出一份适合“暗黑卡片风格 UI”展示的结构化分析结果。
[目标用户] {USERNAME}
[强制规则]
1. 只能输出一个 JSON 对象，不要输出 markdown，不要输出解释，不要输出代码块标记。
2. 所有字段都必须存在，内容必须是中文。
3. 分数统一使用 0-5 的小数，保留 1 位，如 3.5。
4. ` +
`summaryTags 输出 3-4 个简短标签；identityTags 输出 4 个对象；behaviorPatterns 输出 4 个对象；riskList 输出 5 个对象。
5. 语言风格要犀利、像社区老哥锐评，但不要低俗辱骂。
6. ` +
`closingLine 必须输出一句短促、毒舌、一针见血的结案陈词。

[JSON 格式]
{
  "username": "{USERNAME}",
  "summaryTags": ["趋势分析师", "复盘控", "AI铁佬", "跟车选手"],
  "hotness": {
    "harvestScore": 3.5,
    "victimScore": 2.5,
    "overallLevel": "低",
    "summary": "综合危险等级：低"
  },
  "identityTags": [
    { "tag": "趋势分析师", "desc": "..." },
    { "tag": "复盘控", "desc": "..." },
    { "tag": "AI铁佬", "desc": "..." },
    { "tag": "跟车选手", "desc": "..." }
  ],
  "harvestAnalysis": "...",
  "behaviorPatterns": [
    { "title": "带节奏", "level": "中等", "desc": "..." },
    { "title": "逻辑陷阱", "level": "弱", "desc": "..." },
    { "title": "逻辑漏洞", "level": "高", "desc": "..." },
    { "title": "情绪控制", "level": "中等", "desc": "..." }
  ],
  "riskList": [
    { "title": "描述型标签1", "desc": "..." },
    { "title": "描述型标签2", "desc": "..." },
    { "title": "描述型标签3", "desc": "..." },
    { "title": "描述型标签4", "desc": "..." },
    { "title": "描述型标签5", "desc": "..." }
  ],
  "closingLine": "一句毒舌结案陈词",
  "disclaimer": "以上内容基于公开论坛发言的人工智能分析，仅供娱乐参考，不构成任何投资建议。"
}

以下是用户回帖内容：
`;

    const PROMPT_END = `\n\n===== [金融身份鉴定 结束] =====`;

    // ===================== 配置管理 =====================
    function getConfig() {
        return {
            baseUrl: (GM_getValue(CFG_BASE_URL, DEFAULT_BASE_URL) || "").replace(/\/+$/, ""),
            apiKey: GM_getValue(CFG_API_KEY, "") || "",
            model: GM_getValue(CFG_MODEL, DEFAULT_MODEL) || DEFAULT_MODEL
        };
    }

    function isConfigValid(cfg) {
        return cfg.baseUrl && cfg.apiKey && cfg.model;
    }

    function debugReport(hypothesisId, location, msg, data, traceId) {
        // #region debug-point Z:report-helper
        fetch(DEBUG_SERVER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId: DEBUG_SESSION_ID,
                runId: DEBUG_RUN_ID,
                hypothesisId: hypothesisId,
                location: location,
                msg: "[DEBUG] " + msg,
                data: data || {},
                traceId: traceId || "",
                ts: Date.now()
            })
        }).catch(function () {});
        // #endregion
    }

    function registerConfigMenu() {
        GM_registerMenuCommand("⚙️ 设置 Base URL", function () {
            var cur = GM_getValue(CFG_BASE_URL, DEFAULT_BASE_URL);
            var v = prompt("请输入 API Base URL (OpenAI 兼容)\n例如 https://api.openai.com/v1", cur);
            if (v !== null) { GM_setValue(CFG_BASE_URL, v.trim()); alert("已保存"); }
        });
        GM_registerMenuCommand("🔑 设置 API Key", function () {
            var cur = GM_getValue(CFG_API_KEY, "");
            var v = prompt("请输入 API Key", cur);
            if (v !== null) { GM_setValue(CFG_API_KEY, v.trim()); alert("已保存"); }
        });
        GM_registerMenuCommand("🧠 设置 Model", function () {
            var cur = GM_getValue(CFG_MODEL, DEFAULT_MODEL);
            var v = prompt("请输入模型名称", cur);
            if (v !== null) { GM_setValue(CFG_MODEL, v.trim()); alert("已保存"); }
        });
        GM_registerMenuCommand("🗑️ 清除所有配置", function () {
            if (confirm("确定清除 base_url / api_key / model 吗？")) {
                GM_deleteValue(CFG_BASE_URL);
                GM_deleteValue(CFG_API_KEY);
                GM_deleteValue(CFG_MODEL);
                alert("已清除");
            }
        });
    }

    // ===================== 样式 =====================
    GM_addStyle(`
        .nga-finance-btn {
            margin-left: 8px;
            padding: 1px 10px;
            background: #FF4081;
            color: #fff;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            transition: all 0.2s;
        }
        .nga-finance-btn:hover { background: #e52b6d; }
        .nga-finance-btn:disabled { background: #ccc; cursor: not-allowed; }

        #nga-finance-drawer {
            position: fixed; top: 0; right: 0; width: 480px; height: 100vh;
            background: #fff; box-shadow: -5px 0 25px rgba(0,0,0,0.2); z-index: 999999;
            transform: translateX(100%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            display: flex; flex-direction: column;
        }
        #nga-finance-drawer.open { transform: translateX(0); }
        #drawer-header {
            padding: 15px; border-bottom: 1px solid #eee; display: flex;
            justify-content: space-between; align-items: center; background: #fafafa; font-weight: bold;
        }
        #drawer-close { cursor: pointer; font-size: 22px; color: #999; user-select: none; }
        #drawer-meta {
            padding: 8px 15px; font-size: 11px; color: #888; background: #fafafa;
            border-bottom: 1px solid #eee;
        }
        #drawer-body {
            flex: 1; width: 100%; overflow-y: auto; background: #f0f2f5;
            padding: 15px; line-height: 1.7; font-size: 14px; color: #222;
            white-space: pre-wrap; word-wrap: break-word;
        }
        #drawer-body h1, #drawer-body h2, #drawer-body h3 { margin: 12px 0 6px; }
        #drawer-body .placeholder { color: #999; font-style: italic; }
        #drawer-footer {
            padding: 10px 15px; border-top: 1px solid #eee; font-size: 12px;
            color: #666; background: #fff; display: flex; justify-content: space-between; align-items: center;
        }
        #drawer-footer button {
            padding: 4px 10px; border: 1px solid #ddd; background: #fff;
            border-radius: 4px; cursor: pointer; font-size: 12px;
        }
        #drawer-footer button:hover { background: #f0f0f0; }
        .nga-finance-error { color: #d32f2f; }
        .nga-report-card {
            background:
                radial-gradient(circle at top left, rgba(255, 117, 24, 0.2), transparent 28%),
                radial-gradient(circle at top right, rgba(255, 0, 122, 0.14), transparent 25%),
                linear-gradient(180deg, #10101d 0%, #070812 100%);
            color: #f8f1ff;
            border-radius: 20px;
            padding: 14px;
            box-shadow: 0 10px 30px rgba(255, 0, 122, 0.18);
            border: 1px solid rgba(255, 255, 255, 0.06);
        }
        .nga-report-header {
            background: linear-gradient(135deg, #f84b63 0%, #ff9f1c 100%);
            border-radius: 16px;
            padding: 14px;
            display: flex;
            gap: 12px;
            align-items: center;
            color: #fff;
            box-shadow: 0 8px 18px rgba(255, 105, 78, 0.25);
        }
        .nga-report-avatar {
            width: 54px;
            height: 54px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 22px;
            color: #fff;
            background: rgba(255, 255, 255, 0.2);
            border: 2px solid rgba(255, 255, 255, 0.4);
            flex: 0 0 auto;
            overflow: hidden;
        }
        .nga-report-avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
        .nga-report-name {
            font-size: 22px;
            font-weight: 800;
            line-height: 1.1;
        }
        .nga-report-submeta {
            margin-top: 6px;
            font-size: 11px;
            opacity: 0.92;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        .nga-report-tabs {
            margin: 14px 0 8px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .nga-report-chip {
            background: linear-gradient(180deg, rgba(75, 99, 255, 0.28), rgba(100, 60, 255, 0.18));
            color: #d8ddff;
            border: 1px solid rgba(130, 138, 255, 0.26);
            border-radius: 999px;
            padding: 6px 12px;
            font-size: 12px;
            font-weight: 700;
        }
        .nga-report-chip.active {
            background: linear-gradient(180deg, rgba(255, 107, 107, 0.22), rgba(255, 140, 66, 0.2));
            color: #ffd1d1;
            border-color: rgba(255, 154, 102, 0.32);
        }
        .nga-report-section {
            margin-top: 16px;
            padding-top: 8px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        .nga-report-title {
            font-size: 15px;
            font-weight: 800;
            color: #ff5db0;
            margin-bottom: 10px;
        }
        .nga-score-row {
            display: grid;
            grid-template-columns: 62px 1fr 40px;
            gap: 8px;
            align-items: center;
            margin: 10px 0;
        }
        .nga-score-label {
            color: #b8b3d6;
            font-size: 12px;
        }
        .nga-score-track {
            height: 12px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.08);
            overflow: hidden;
        }
        .nga-score-fill {
            height: 100%;
            border-radius: 999px;
        }
        .nga-score-fill.harvest {
            background: linear-gradient(90deg, #ff4c87, #ff2f5f);
        }
        .nga-score-fill.victim {
            background: linear-gradient(90deg, #2ed3c6, #3ade77);
        }
        .nga-score-value {
            color: #ffb14a;
            font-weight: 800;
            text-align: right;
        }
        .nga-score-summary {
            display: inline-block;
            margin-top: 6px;
            padding: 5px 10px;
            border-radius: 999px;
            background: rgba(0, 214, 143, 0.15);
            border: 1px solid rgba(0, 214, 143, 0.28);
            color: #61f3bc;
            font-size: 12px;
            font-weight: 700;
        }
        .nga-tag-item,
        .nga-behavior-item {
            margin-bottom: 10px;
            line-height: 1.65;
            color: #d8d3ef;
            font-size: 13px;
        }
        .nga-item-badge {
            display: inline-block;
            margin-right: 8px;
            padding: 2px 8px;
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.06);
            color: #f7cfe8;
            border: 1px solid rgba(255, 255, 255, 0.08);
            font-size: 11px;
            font-weight: 700;
        }
        .nga-risk-item {
            display: grid;
            grid-template-columns: 22px 1fr;
            gap: 10px;
            margin-bottom: 12px;
        }
        .nga-risk-index {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: linear-gradient(180deg, #ff3f88, #ff7a00);
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 800;
        }
        .nga-risk-title {
            color: #fff0f6;
            font-weight: 700;
            margin-bottom: 2px;
        }
        .nga-risk-desc {
            color: #c7c2df;
            font-size: 13px;
            line-height: 1.55;
        }
        .nga-report-quote {
            margin-top: 14px;
            padding: 14px;
            border-radius: 12px;
            background: rgba(255, 0, 122, 0.08);
            border-left: 3px solid #ff3c8f;
            color: #ffe3f1;
            font-style: italic;
        }
        .nga-report-quote-title {
            margin-bottom: 6px;
            color: #ff8bc7;
            font-size: 12px;
            font-weight: 800;
            font-style: normal;
        }
        .nga-report-disclaimer {
            margin-top: 12px;
            color: #b8b3d6;
            font-size: 12px;
            line-height: 1.6;
        }
        .nga-report-footer {
            margin-top: 16px;
            padding-top: 10px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            color: #8f8aa8;
            font-size: 11px;
            display: flex;
            justify-content: space-between;
            gap: 8px;
            flex-wrap: wrap;
        }
    `);

    // ===================== 环境判断 =====================
    var host = window.location.host;
    var isNgaPage = host.indexOf("nga.cn") !== -1 || host.indexOf("ngabbs.com") !== -1 || host.indexOf("nga.178.com") !== -1;

    if (isNgaPage) {
        registerConfigMenu();
        initNgaLogic();
    }

    // ===================== NGA页面逻辑 =====================
    function initNgaLogic() {
        initDrawer();
        injectButtons();
        var debounceTimer = null;
        var observer = new MutationObserver(function () {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(injectButtons, 300);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function initDrawer() {
        if (document.getElementById("nga-finance-drawer")) return;
        var drawer = document.createElement("div");
        drawer.id = "nga-finance-drawer";
        drawer.innerHTML =
            '<div id="drawer-header"><span>金融身份鉴定</span><span id="drawer-close">&times;</span></div>' +
            '<div id="drawer-meta"></div>' +
            '<div id="drawer-body"><span class="placeholder">点击帖子中的「大韭菜指数」按钮开始…</span></div>' +
            '<div id="drawer-footer"><span id="footer-status">就绪</span>' +
            '<span><button id="footer-shot" style="display:none">截图</button> <button id="footer-copy" style="display:none">复制结果</button> <button id="footer-clear" style="display:none">清空</button></span></div>';
        document.body.appendChild(drawer);

        document.getElementById("drawer-close").onclick = function () {
            drawer.classList.remove("open");
            GM_deleteValue(STORAGE_KEY);
        };
        document.getElementById("footer-shot").onclick = function () {
            captureReportScreenshot();
        };
        document.getElementById("footer-copy").onclick = function () {
            var body = document.getElementById("drawer-body");
            navigator.clipboard.writeText(body.innerText).then(function () {
                document.getElementById("footer-status").textContent = "✅ 已复制到剪贴板";
            });
        };
        document.getElementById("footer-clear").onclick = function () {
            document.getElementById("drawer-body").innerHTML = '<span class="placeholder">已清空</span>';
            document.getElementById("footer-shot").style.display = "none";
            document.getElementById("footer-copy").style.display = "none";
            document.getElementById("footer-clear").style.display = "none";
            document.getElementById("footer-status").textContent = "就绪";
        };
    }

    function injectButtons() {
        var authors = document.querySelectorAll("a.userlink.author[href*='uid=']");
        for (var i = 0; i < authors.length; i++) {
            var author = authors[i];
            if (author.nextElementSibling && author.nextElementSibling.classList.contains("nga-finance-btn")) continue;
            var uidMatch = author.getAttribute("href").match(/uid=(\d+)/);
            if (!uidMatch) continue;
            var btn = document.createElement("button");
            btn.className = "nga-finance-btn";
            btn.textContent = "大韭菜指数";
            btn.dataset.avatarUrl = findAvatarUrl(author);
            btn.dataset.profileUrl = normalizeUrl(author.getAttribute("href") || author.href || "");
            (function (uid, username, button, authorEl) {
                button.onclick = function (e) {
                    e.preventDefault();
                    startAnalysis(uid, username, button, authorEl);
                };
            })(uidMatch[1], author.textContent.trim(), btn, author);
            author.parentNode.insertBefore(btn, author.nextSibling);
        }
    }

    async function startAnalysis(uid, username, btn, authorEl) {
        var cfg = getConfig();
        var traceId = "nga-" + uid + "-" + Date.now();
        var avatarUrl = btn.dataset.avatarUrl || "";
        var profileUrl = btn.dataset.profileUrl || "";
        // #region debug-point A:start-analysis
        debugReport("A", "nga-finance-identity.user.js:startAnalysis", "startAnalysis entered", {
            uid: uid,
            username: username,
            hasBaseUrl: !!cfg.baseUrl,
            hasApiKey: !!cfg.apiKey,
            model: cfg.model || "",
            hasAvatarUrl: !!avatarUrl,
            profileUrl: profileUrl
        }, traceId);
        // #endregion
        if (!isConfigValid(cfg)) {
            // #region debug-point A:invalid-config
            debugReport("A", "nga-finance-identity.user.js:startAnalysis", "config invalid", {
                baseUrl: cfg.baseUrl || "",
                hasApiKey: !!cfg.apiKey,
                model: cfg.model || ""
            }, traceId);
            // #endregion
            alert("请先在油猴菜单中配置 Base URL / API Key / Model");
            return;
        }

        btn.disabled = true;
        btn.textContent = "鉴定中...";
        openDrawerWith("⏳ 正在抓取用户回帖…", "抓取中", username);

        try {
            var ngaHost = window.location.host;
            var url = "https://" + ngaHost + "/thread.php?searchpost=1&authorid=" + uid;
            var postPromise = fetchNgaPage(url, traceId, "searchpost");
            var profilePromise = fetchUserProfileMeta(uid, ngaHost, authorEl, traceId, profileUrl);
            var results = await Promise.all([postPromise, profilePromise]);
            var html = results[0];
            var profileMeta = results[1];

            var content = parsePost(html);
            // #region debug-point B:parsed-post
            debugReport("B", "nga-finance-identity.user.js:startAnalysis", "parsed post content", {
                contentLength: content.length,
                profileMeta: profileMeta
            }, traceId);
            // #endregion
            if (content.length < MIN_CONTENT_LEN) throw new Error("回帖太少，无法鉴定");

            var fullPrompt = PROMPT.replace("{USERNAME}", username) + content;
            var limit = MAX_CONTENT_LEN - PROMPT_END.length;
            if (fullPrompt.length > limit) fullPrompt = fullPrompt.slice(0, limit) + "...(内容过长截断)";
            fullPrompt += PROMPT_END;
            // #region debug-point C:prompt-ready
            debugReport("C", "nga-finance-identity.user.js:startAnalysis", "prompt ready", {
                promptLength: fullPrompt.length,
                endpoint: cfg.baseUrl + "/chat/completions",
                model: cfg.model
            }, traceId);
            // #endregion

            document.getElementById("drawer-body").innerHTML = '<span class="placeholder">⏳ AI 分析中，请稍候…</span>';
            document.getElementById("footer-status").textContent = "请求 API: " + cfg.model;

            await callAI(cfg, fullPrompt, username, avatarUrl, profileMeta, traceId);
        } catch (err) {
            // #region debug-point E:start-analysis-catch
            debugReport("E", "nga-finance-identity.user.js:startAnalysis", "startAnalysis caught error", {
                message: err && err.message ? err.message : String(err)
            }, traceId);
            // #endregion
            document.getElementById("drawer-body").innerHTML = '<span class="nga-finance-error">❌ 错误：' + (err.message || err) + '</span>';
            document.getElementById("footer-status").textContent = "失败";
        } finally {
            btn.disabled = false;
            btn.textContent = "大韭菜指数";
        }
    }

    function fetchNgaPage(url, traceId, tag) {
        return new Promise(function (resolve, reject) {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                overrideMimeType: "text/html; charset=gbk",
                onload: function (res) {
                    // #region debug-point B:nga-fetch-onload
                    debugReport("B", "nga-finance-identity.user.js:fetchNgaPage", "nga page fetch completed", {
                        tag: tag || "",
                        status: res.status,
                        responseLength: (res.responseText || "").length
                    }, traceId);
                    // #endregion
                    res.status === 200 ? resolve(res.responseText) : reject(new Error("请求失败：" + res.status));
                },
                onerror: function () {
                    // #region debug-point B:nga-fetch-onerror
                    debugReport("B", "nga-finance-identity.user.js:fetchNgaPage", "nga page fetch network error", {
                        tag: tag || ""
                    }, traceId);
                    // #endregion
                    reject(new Error("网络错误"));
                }
            });
        });
    }

    function findAvatarUrl(author) {
        var containers = [
            author,
            author.parentElement,
            author.closest("td"),
            author.closest("tr"),
            author.closest("table"),
            author.closest("[id^='post']"),
            author.closest(".posterinfo")
        ];
        var bestScore = -1;
        var bestUrl = "";
        var seen = {};
        for (var i = 0; i < containers.length; i++) {
            var container = containers[i];
            if (!container) continue;
            var images = container.querySelectorAll("img");
            for (var j = 0; j < images.length; j++) {
                var img = images[j];
                var src = normalizeUrl(img.getAttribute("src") || img.currentSrc || "");
                if (!src || seen[src]) continue;
                seen[src] = true;
                var score = scoreAvatarImage(img, src);
                if (score > bestScore) {
                    bestScore = score;
                    bestUrl = src;
                }
            }
        }
        return bestScore >= 6 ? bestUrl : "";
    }

    function fetchUserProfileMeta(uid, ngaHost, author, traceId, profileUrl) {
        var localMeta = extractLocalProfileMeta(author);
        var profileUrls = buildProfileUrls(uid, ngaHost, profileUrl);
        // #region debug-point B:profile-meta-begin
        debugReport("B", "nga-finance-identity.user.js:fetchUserProfileMeta", "profile meta collection begin", {
            uid: uid,
            ngaHost: ngaHost,
            profileUrl: profileUrl,
            profileUrls: profileUrls,
            localMeta: localMeta
        }, traceId);
        // #endregion
        return collectRemoteProfileMeta(profileUrls, 0, {}, uid, traceId).then(function (remoteMeta) {
            var mergedMeta = mergeProfileMeta(localMeta, remoteMeta);
            // #region debug-point B:profile-meta-merged
            debugReport("B", "nga-finance-identity.user.js:fetchUserProfileMeta", "profile meta merged", {
                uid: uid,
                localMeta: localMeta,
                remoteMeta: remoteMeta,
                mergedMeta: mergedMeta
            }, traceId);
            // #endregion
            return mergedMeta;
        }).catch(function () {
            var fallbackMeta = mergeProfileMeta(localMeta, {});
            // #region debug-point B:profile-meta-fallback
            debugReport("B", "nga-finance-identity.user.js:fetchUserProfileMeta", "profile meta fallback to local", {
                uid: uid,
                localMeta: localMeta,
                fallbackMeta: fallbackMeta
            }, traceId);
            // #endregion
            return fallbackMeta;
        });
    }

    function buildProfileUrls(uid, ngaHost, profileUrl) {
        var urls = [];
        pushUniqueUrl(urls, profileUrl);
        pushUniqueUrl(urls, "https://" + ngaHost + "/nuke.php?func=ucp&uid=" + uid);
        pushUniqueUrl(urls, "https://nga.178.com/nuke.php?func=ucp&uid=" + uid);
        return urls;
    }

    function pushUniqueUrl(list, url) {
        var normalized = normalizeUrl(url);
        if (normalized && list.indexOf(normalized) === -1) list.push(normalized);
    }

    function collectRemoteProfileMeta(urls, index, accMeta, uid, traceId) {
        if (!urls || index >= urls.length) return Promise.resolve(accMeta || {});
        var currentUrl = urls[index];
        return fetchNgaPage(currentUrl, traceId, "ucp-" + index).then(function (html) {
            var parsedMeta = parseProfileMetaFromProfilePage(html);
            var nextMeta = mergeRemoteProfileMeta(accMeta, parsedMeta);
            // #region debug-point B:profile-meta-url-result
            debugReport("B", "nga-finance-identity.user.js:collectRemoteProfileMeta", "profile meta parsed from candidate url", {
                uid: uid,
                currentUrl: currentUrl,
                parsedMeta: parsedMeta,
                nextMeta: nextMeta,
                htmlPreview: String(html || "").slice(0, 500)
            }, traceId);
            // #endregion
            return collectRemoteProfileMeta(urls, index + 1, nextMeta, uid, traceId);
        }).catch(function () {
            // #region debug-point B:profile-meta-url-failed
            debugReport("B", "nga-finance-identity.user.js:collectRemoteProfileMeta", "profile meta candidate url failed", {
                uid: uid,
                currentUrl: currentUrl
            }, traceId);
            // #endregion
            return collectRemoteProfileMeta(urls, index + 1, accMeta, uid, traceId);
        });
    }

    function mergeRemoteProfileMeta(prevMeta, nextMeta) {
        var prev = prevMeta || {};
        var next = nextMeta || {};
        return {
            ipLocation: firstUsefulValue(next.ipLocation, prev.ipLocation, "未公开"),
            registerTime: firstUsefulValue(next.registerTime, prev.registerTime, "未知"),
            postCount: normalizePostCount(firstUsefulValue(next.postCount, prev.postCount, "未知")),
            userGroup: cleanUserGroup(firstUsefulValue(next.userGroup, prev.userGroup, "未知"))
        };
    }

    function extractLocalProfileMeta(author) {
        var rawText = collectProfileText(author);
        var compactText = compactMetaText(rawText);
        return {
            ipLocation: extractMetaValue(compactText, [
                /IP属地[:：]?([^\s|,，#]+)/i,
                /属地[:：]?([^\s|,，#]+)/i
            ], "未公开"),
            registerTime: extractMetaValue(compactText, [
                /注册(?:日期|时间)?[:：]?([0-9]{2,4}[-\/.年][0-9]{1,2}(?:[-\/.月][0-9]{1,2})?(?:日)?(?:[T\s][0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)?)/i
            ], "未知"),
            postCount: normalizePostCount(extractMetaValue(compactText, [
                /发帖数[:：]?([0-9][0-9,万千wW+]*)/i,
                /发帖[:：]?([0-9][0-9,万千wW+]*)/i,
                /帖子数[:：]?([0-9][0-9,万千wW+]*)/i
            ], "未知")),
            userGroup: extractMetaValue(compactText, [
                /用户组[:：]?([^|,，#]+)/i,
                /组别[:：]?([^|,，#]+)/i,
                /级别[:：]?([^|,，#]+)/i,
                /威望[:：]?([^|,，#]+)/i
            ], "未知")
        };
    }

    function collectProfileText(author) {
        var containers = [
            author,
            author.parentElement,
            author.closest("td"),
            author.closest("tr"),
            author.closest("table"),
            author.closest("[id^='post']"),
            author.closest(".posterinfo"),
            author.closest(".postauthor")
        ];
        var seen = {};
        var parts = [];
        for (var i = 0; i < containers.length; i++) {
            var container = containers[i];
            if (!container) continue;
            var text = (container.innerText || container.textContent || "").trim();
            if (!text || seen[text]) continue;
            seen[text] = true;
            parts.push(text);
        }
        return parts.join("\n");
    }

    function compactMetaText(text) {
        return String(text || "")
            .replace(/[\u00a0\u1680\u180e\u2000-\u200d\u202f\u205f\u3000]/g, " ")
            .replace(/\s+/g, "")
            .replace(/[|¦｜]/g, "|");
    }

    function parseProfileMetaFromProfilePage(html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        var rawText = doc.body ? (doc.body.innerText || doc.body.textContent || "") : html;
        var lines = extractNormalizedProfileLines(rawText);
        var text = lines.join("|");
        var lineMeta = extractProfileMetaFromLines(lines);
        var parsed = {
            ipLocation: extractMetaValue(text, [
                /(?:IP属地|IP地区|IP地域)[:：]?([^|#]+)/i
            ], lineMeta.ipLocation || "未公开"),
            registerTime: extractMetaValue(text, [
                /注册日期[:：]?([0-9]{2,4}[-\/.年][0-9]{1,2}(?:[-\/.月][0-9]{1,2})?(?:日)?(?:[T\s]?[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)?)/i,
                /注册时间[:：]?([0-9]{2,4}[-\/.年][0-9]{1,2}(?:[-\/.月][0-9]{1,2})?(?:日)?(?:[T\s]?[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)?)/i
            ], lineMeta.registerTime || "未知"),
            postCount: normalizePostCount(extractMetaValue(text, [
                /(?:发帖数|发帖|帖子数)[:：]?([0-9][0-9,万千wW+]*)/i
            ], lineMeta.postCount || "未知")),
            userGroup: extractMetaValue(text, [
                /用户组[:：]?([^|#]+)/i
            ], lineMeta.userGroup || "未知")
        };
        // #region debug-point B:profile-parse
        debugReport("B", "nga-finance-identity.user.js:parseProfileMetaFromProfilePage", "profile page parsed", {
            rawPreview: String(rawText || "").slice(0, 500),
            normalizedPreview: text.slice(0, 500),
            lineSample: lines.slice(0, 20),
            lineMeta: lineMeta,
            parsed: parsed,
            hasIpKeyword: text.indexOf("IP属地") !== -1,
            hasPostKeyword: text.indexOf("发帖数") !== -1 || text.indexOf("发帖") !== -1 || text.indexOf("帖子数") !== -1,
            hasUserGroupKeyword: text.indexOf("用户组") !== -1
        });
        // #endregion
        return parsed;
    }

    function extractNormalizedProfileLines(text) {
        return String(text || "")
            .split(/\r?\n+/)
            .map(function (line) { return compactMetaText(line); })
            .filter(function (line) { return !!line; });
    }

    function extractProfileMetaFromLines(lines) {
        var meta = {
            ipLocation: "未公开",
            registerTime: "未知",
            postCount: "未知",
            userGroup: "未知"
        };
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var nextLine = i + 1 < lines.length ? lines[i + 1] : "";
            if (meta.userGroup === "未知" && line.indexOf("用户组") === 0) {
                meta.userGroup = extractLineFieldValue(line, nextLine, "未知");
            } else if (meta.registerTime === "未知" && (line.indexOf("注册日期") === 0 || line.indexOf("注册时间") === 0)) {
                meta.registerTime = extractLineFieldValue(line, nextLine, "未知");
            } else if (meta.ipLocation === "未公开" && /^(IP属地|IP地区|IP地域)/.test(line)) {
                meta.ipLocation = extractLineFieldValue(line, nextLine, "未公开");
            } else if (meta.postCount === "未知" && /^(发帖数|发帖|帖子数)/.test(line)) {
                meta.postCount = normalizePostCount(extractLineFieldValue(line, nextLine, "未知"));
            }
        }
        return meta;
    }

    function extractLineFieldValue(line, nextLine, fallback) {
        var value = "";
        var match = String(line || "").match(/^[^:：]+[:：](.*)$/);
        if (match) value = match[1];
        if (!value && nextLine && nextLine.indexOf(":") === -1 && nextLine.indexOf("：") === -1) {
            value = nextLine;
        }
        value = sanitizeProfileValue(value);
        return value || fallback;
    }

    function extractMetaValue(text, patterns, fallback) {
        for (var i = 0; i < patterns.length; i++) {
            var match = String(text || "").match(patterns[i]);
            if (match && match[1]) {
                return sanitizeProfileValue(match[1]);
            }
        }
        return fallback;
    }

    function mergeProfileMeta(localMeta, remoteMeta) {
        var local = localMeta || {};
        var remote = remoteMeta || {};
        return {
            ipLocation: firstUsefulValue(remote.ipLocation, local.ipLocation, "未公开"),
            registerTime: firstUsefulValue(remote.registerTime, local.registerTime, "未知"),
            postCount: normalizePostCount(firstUsefulValue(local.postCount, remote.postCount, "未知")),
            userGroup: cleanUserGroup(firstUsefulValue(remote.userGroup, local.userGroup, "未知"))
        };
    }

    function firstUsefulValue() {
        for (var i = 0; i < arguments.length; i++) {
            var value = sanitizeProfileValue(arguments[i]);
            if (value && value !== "未知" && value !== "未公开") return value;
        }
        return arguments.length ? arguments[arguments.length - 1] : "";
    }

    function sanitizeProfileValue(value) {
        return String(value || "")
            .replace(/^[\s:：|/-]+/, "")
            .replace(/[\s|/]+$/, "")
            .replace(/(?:UID[:：]?\d+|用户信息|基础信息|状态)$/i, "")
            .trim();
    }

    function normalizePostCount(value) {
        var text = sanitizeProfileValue(value);
        if (!text || text === "未知") return "未知";
        return /帖$/.test(text) ? text : text + "帖";
    }

    function cleanUserGroup(value) {
        var text = sanitizeProfileValue(value);
        if (!text || text === "未知") return "未知";
        text = text.replace(/\(\d+\)$/, "").trim();
        return text || "未知";
    }

    function scoreAvatarImage(img, src) {
        if (!src || /^data:/i.test(src)) return -1;
        var score = 0;
        var hint = [
            img.className || "",
            img.id || "",
            img.getAttribute("alt") || "",
            img.getAttribute("title") || "",
            src
        ].join(" ").toLowerCase();
        var width = img.naturalWidth || img.width || parseInt(img.getAttribute("width"), 10) || 0;
        var height = img.naturalHeight || img.height || parseInt(img.getAttribute("height"), 10) || 0;
        if (/avatar|头像|head|face|photo/.test(hint)) score += 8;
        if (/uc_server|avatar\.php|portrait|upload/.test(hint)) score += 6;
        if (/icon|badge|medal|emot|smile|rank|star|level/.test(hint)) score -= 8;
        if (width >= 24 && width <= 180) score += 4;
        if (height >= 24 && height <= 180) score += 4;
        if (Math.abs(width - height) <= 12 && width > 0 && height > 0) score += 2;
        return score;
    }

    function normalizeUrl(url) {
        if (!url) return "";
        if (url.indexOf("//") === 0) return window.location.protocol + url;
        if (/^https?:\/\//i.test(url)) return url;
        try {
            return new URL(url, window.location.href).href;
        } catch (e) {
            return url;
        }
    }

    function openDrawerWith(bodyHtml, status, username) {
        var drawer = document.getElementById("nga-finance-drawer");
        drawer.classList.add("open");
        document.getElementById("drawer-body").innerHTML = bodyHtml;
        document.getElementById("footer-status").textContent = status;
        document.getElementById("drawer-meta").textContent = "目标用户：" + username;
        document.getElementById("footer-shot").style.display = "none";
        document.getElementById("footer-copy").style.display = "none";
        document.getElementById("footer-clear").style.display = "none";
    }

    // ===================== 调用第三方 AI (OpenAI 兼容) =====================
    function callAI(cfg, prompt, username, avatarUrl, profileMeta, traceId) {
        return new Promise(function (resolve, reject) {
            var endpoint = cfg.baseUrl + "/chat/completions";
            var body = JSON.stringify({
                model: cfg.model,
                stream: false,
                messages: [
                    { role: "system", content: "你是一名资深的金融社区观察员和心理学专家。" },
                    { role: "user", content: prompt }
                ]
            });

            var bodyEl = document.getElementById("drawer-body");
            var statusEl = document.getElementById("footer-status");
            bodyEl.innerHTML = "";
            bodyEl.dataset.raw = "";
            // #region debug-point C:call-ai-enter
            debugReport("C", "nga-finance-identity.user.js:callAI", "callAI entered", {
                endpoint: endpoint,
                model: cfg.model,
                bodyLength: body.length
            }, traceId);
            // #endregion

            GM_xmlhttpRequest({
                method: "POST",
                url: endpoint,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + cfg.apiKey
                },
                data: body,
                responseType: "json",
                onloadstart: function () {
                    // #region debug-point D:api-onloadstart
                    debugReport("D", "nga-finance-identity.user.js:callAI", "api connection opened", {}, traceId);
                    // #endregion
                    statusEl.textContent = "已连接，请求处理中…";
                },
                onload: function (res) {
                    var finalPayload = res.response !== undefined ? res.response : res.responseText;
                    var finalText = typeof finalPayload === "string" ? finalPayload : JSON.stringify(finalPayload || {});
                    // #region debug-point D:api-onload
                    debugReport("D", "nga-finance-identity.user.js:callAI", "api request completed", {
                        status: res.status,
                        statusText: res.statusText || "",
                        finalLength: finalText.length,
                        renderedLength: (bodyEl.dataset.raw || "").length
                    }, traceId);
                    // #endregion
                    if (res.status >= 200 && res.status < 300) {
                        bodyEl.dataset.raw = extractAssistantText(finalPayload);
                        if (bodyEl.dataset.raw) {
                            var structuredReport = tryParseReport(bodyEl.dataset.raw, username, avatarUrl, profileMeta);
                            if (structuredReport) {
                                bodyEl.innerHTML = renderReportCard(structuredReport, cfg.model);
                            } else {
                                bodyEl.textContent = bodyEl.dataset.raw;
                            }
                            bodyEl.scrollTop = bodyEl.scrollHeight;
                            statusEl.textContent = "✅ 完成";
                            document.getElementById("footer-shot").style.display = "inline-block";
                            document.getElementById("footer-copy").style.display = "inline-block";
                            document.getElementById("footer-clear").style.display = "inline-block";
                            // #region debug-point E:api-success
                            debugReport("E", "nga-finance-identity.user.js:callAI", "api success rendered", {
                                renderedLength: (bodyEl.dataset.raw || "").length
                            }, traceId);
                            // #endregion
                            resolve(bodyEl.dataset.raw);
                        } else {
                            bodyEl.innerHTML = '<span class="nga-finance-error">❌ 接口已返回，但内容为空。原始响应片段：' + escapeHtml(finalText.slice(0, 800)) + '</span>';
                            statusEl.textContent = "空响应";
                            // #region debug-point E:api-empty
                            debugReport("E", "nga-finance-identity.user.js:callAI", "api returned empty content", {
                                rawPreview: finalText.slice(0, 300)
                            }, traceId);
                            // #endregion
                            reject(new Error("接口返回成功，但内容为空"));
                        }
                    } else {
                        // 尝试解析错误体
                        var msg = res.status + " " + (res.statusText || "");
                        try {
                            var j = JSON.parse(finalText);
                            msg = (j.error && (j.error.message || j.error.code)) || j.message || msg;
                        } catch (e) { }
                        bodyEl.innerHTML = '<span class="nga-finance-error">❌ API 错误：' + escapeHtml(msg) + '</span>';
                        statusEl.textContent = "失败";
                        // #region debug-point E:api-error
                        debugReport("E", "nga-finance-identity.user.js:callAI", "api returned error", {
                            status: res.status,
                            message: msg
                        }, traceId);
                        // #endregion
                        reject(new Error(msg));
                    }
                },
                onerror: function (err) {
                    bodyEl.innerHTML = '<span class="nga-finance-error">❌ 网络错误：' + escapeHtml(err.error || "无法连接") + '</span>';
                    statusEl.textContent = "失败";
                    // #region debug-point E:api-network-error
                    debugReport("E", "nga-finance-identity.user.js:callAI", "api network error", {
                        error: err && err.error ? err.error : "unknown"
                    }, traceId);
                    // #endregion
                    reject(new Error("网络错误"));
                }
            });
        });
    }

    function extractAssistantText(payload) {
        var obj = payload;
        if (typeof obj === "string") {
            try {
                obj = JSON.parse(obj);
            } catch (e) {
                return "";
            }
        }
        if (!obj || !obj.choices || !obj.choices.length) return "";
        var choice = obj.choices[0] || {};
        if (choice.message && typeof choice.message.content === "string") return choice.message.content;
        if (Array.isArray(choice.message && choice.message.content)) {
            return choice.message.content.map(function (item) {
                return item && typeof item.text === "string" ? item.text : "";
            }).join("");
        }
        if (typeof choice.text === "string") return choice.text;
        return "";
    }

    function tryParseReport(text, fallbackUsername, fallbackAvatarUrl, fallbackProfileMeta) {
        var jsonText = extractJsonText(text);
        if (!jsonText) return null;
        try {
            return normalizeReport(JSON.parse(jsonText), fallbackUsername, fallbackAvatarUrl, fallbackProfileMeta);
        } catch (e) {
            return null;
        }
    }

    function extractJsonText(text) {
        if (!text) return "";
        var trimmed = String(text).trim();
        var fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenceMatch) trimmed = fenceMatch[1].trim();
        if (trimmed.charAt(0) === "{" && trimmed.charAt(trimmed.length - 1) === "}") return trimmed;
        var first = trimmed.indexOf("{");
        var last = trimmed.lastIndexOf("}");
        if (first !== -1 && last !== -1 && last > first) return trimmed.slice(first, last + 1);
        return "";
    }

    function normalizeReport(obj, fallbackUsername, fallbackAvatarUrl, fallbackProfileMeta) {
        var report = obj || {};
        var hotness = report.hotness || {};
        var profile = report.profile || fallbackProfileMeta || {};
        return {
            username: asText(report.username || fallbackUsername || "未知用户"),
            avatarUrl: normalizeAvatarUrl(report.avatarUrl || fallbackAvatarUrl || ""),
            profile: normalizeProfile(profile),
            summaryTags: normalizeStringArray(report.summaryTags, 4, ["趋势分析", "复盘控", "AI锐评", "跟车选手"]),
            hotness: {
                harvestScore: normalizeScore(hotness.harvestScore, 3.2),
                victimScore: normalizeScore(hotness.victimScore, 2.8),
                overallLevel: normalizeLevel(hotness.overallLevel),
                summary: asText(hotness.summary || "综合危险等级：中")
            },
            identityTags: normalizeObjectArray(report.identityTags, 4, function (item, i) {
                var fallback = ["趋势分析师", "复盘控", "AI铁佬", "跟车选手"][i] || ("标签" + (i + 1));
                return {
                    tag: asText(item && item.tag || fallback),
                    desc: asText(item && item.desc || "该标签暂无详细说明。")
                };
            }),
            harvestAnalysis: asText(report.harvestAnalysis || "该用户更偏向情绪表达和观点复读，暂未体现出强烈的“带人上车”能力。"),
            behaviorPatterns: normalizeObjectArray(report.behaviorPatterns, 4, function (item, i) {
                var titles = ["带节奏", "逻辑陷阱", "逻辑漏洞", "情绪控制"];
                return {
                    title: asText(item && item.title || titles[i] || ("行为项" + (i + 1))),
                    level: asText(item && item.level || "中等"),
                    desc: asText(item && item.desc || "暂无额外分析。")
                };
            }),
            riskList: normalizeObjectArray(report.riskList, 5, function (item, i) {
                return {
                    title: asText(item && item.title || ("风险标签" + (i + 1))),
                    desc: asText(item && item.desc || "暂无补充说明。")
                };
            }),
            closingLine: asText(report.closingLine || "你问哥值不值先看仓位，哥问你敢不敢先看脑子。"),
            disclaimer: asText(report.disclaimer || FIXED_DISCLAIMER)
        };
    }

    function normalizeStringArray(value, maxLen, fallback) {
        var arr = Array.isArray(value) ? value : [];
        var result = [];
        for (var i = 0; i < arr.length && result.length < maxLen; i++) {
            var text = asText(arr[i]);
            if (text) result.push(text);
        }
        while (result.length < Math.min(maxLen, fallback.length)) result.push(fallback[result.length]);
        return result;
    }

    function normalizeObjectArray(value, maxLen, mapper) {
        var arr = Array.isArray(value) ? value : [];
        var result = [];
        for (var i = 0; i < maxLen; i++) {
            result.push(mapper(arr[i], i));
        }
        return result;
    }

    function normalizeScore(value, fallback) {
        var n = parseFloat(value);
        if (isNaN(n)) n = fallback;
        if (n < 0) n = 0;
        if (n > 5) n = 5;
        return Math.round(n * 10) / 10;
    }

    function normalizeLevel(value) {
        var text = asText(value);
        if (text === "低" || text === "中" || text === "高" || text === "极高") return text;
        return "中";
    }

    function asText(value) {
        return value == null ? "" : String(value).trim();
    }

    function normalizeAvatarUrl(url) {
        var normalized = normalizeUrl(asText(url));
        return /^https?:\/\//i.test(normalized) ? normalized : "";
    }

    function normalizeProfile(profile) {
        var data = profile || {};
        return {
            ipLocation: asText(data.ipLocation || data.ip || "未公开"),
            registerTime: asText(data.registerTime || data.registeredAt || "未知"),
            postCount: normalizePostCount(data.postCount || data.posts || "未知"),
            userGroup: asText(data.userGroup || data.group || "未知")
        };
    }

    function renderReportCard(report, modelName) {
        var generatedAt = formatGeneratedAt(new Date());
        var avatarHtml = report.avatarUrl
            ? '<img src="' + escapeHtml(report.avatarUrl) + '" alt="' + escapeHtml(report.username) + '" crossorigin="anonymous" referrerpolicy="no-referrer">'
            : escapeHtml(report.username.slice(0, 1).toUpperCase());
        var submetaItems = [
            "📍 " + report.profile.ipLocation,
            "🗓️ " + report.profile.registerTime,
            "📝 " + report.profile.postCount,
            "👥 " + report.profile.userGroup
        ];
        var chipsHtml = report.summaryTags.map(function (tag, index) {
            return '<span class="nga-report-chip' + (index === 0 ? ' active' : '') + '">' + escapeHtml(tag) + '</span>';
        }).join("");
        var identityHtml = report.identityTags.map(function (item) {
            return '<div class="nga-tag-item"><span class="nga-item-badge">' + escapeHtml(item.tag) + '</span>' + escapeHtml(item.desc) + '</div>';
        }).join("");
        var behaviorHtml = report.behaviorPatterns.map(function (item) {
            return '<div class="nga-behavior-item"><span class="nga-item-badge">' + escapeHtml(item.title + " · " + item.level) + '</span>' + escapeHtml(item.desc) + '</div>';
        }).join("");
        var riskHtml = report.riskList.map(function (item, index) {
            return '<div class="nga-risk-item"><div class="nga-risk-index">' + (index + 1) + '</div><div><div class="nga-risk-title">' + escapeHtml(item.title) + '</div><div class="nga-risk-desc">' + escapeHtml(item.desc) + '</div></div></div>';
        }).join("");

        return '' +
            '<div class="nga-report-card">' +
                '<div class="nga-report-header">' +
                    '<div class="nga-report-avatar">' + avatarHtml + '</div>' +
                    '<div>' +
                        '<div class="nga-report-name">' + escapeHtml(report.username) + '</div>' +
                        '<div class="nga-report-submeta">' +
                            '<span>' + escapeHtml(submetaItems[0]) + '</span>' +
                            '<span>' + escapeHtml(submetaItems[1]) + '</span>' +
                            '<span>' + escapeHtml(submetaItems[2]) + '</span>' +
                            '<span>' + escapeHtml(submetaItems[3]) + '</span>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="nga-report-tabs">' + chipsHtml + '</div>' +
                '<div class="nga-report-section">' +
                    '<div class="nga-report-title">🎯 割韭菜指数评估</div>' +
                    renderScoreBar("镰刀锋利", report.hotness.harvestScore, "harvest") +
                    renderScoreBar("韭菜鲜嫩", report.hotness.victimScore, "victim") +
                    '<div class="nga-score-summary">' + escapeHtml(report.hotness.summary) + '</div>' +
                '</div>' +
                '<div class="nga-report-section">' +
                    '<div class="nga-report-title">🔴 核心身份标签</div>' +
                    identityHtml +
                '</div>' +
                '<div class="nga-report-section">' +
                    '<div class="nga-report-title">🔴 割韭菜程度分析</div>' +
                    '<div class="nga-tag-item">' + escapeHtml(report.harvestAnalysis) + '</div>' +
                '</div>' +
                '<div class="nga-report-section">' +
                    '<div class="nga-report-title">🔴 行为模式分析</div>' +
                    behaviorHtml +
                '</div>' +
                '<div class="nga-report-section">' +
                    '<div class="nga-report-title">🔴 交易体系警惕</div>' +
                    riskHtml +
                '</div>' +
                '<div class="nga-report-quote"><div class="nga-report-quote-title">毒舌结案陈词</div><div>' + escapeHtml(report.closingLine) + '</div></div>' +
                '<div class="nga-report-disclaimer">' + escapeHtml(FIXED_DISCLAIMER) + '</div>' +
                '<div class="nga-report-footer"><span>NGA大韭菜指数 · ' + escapeHtml(generatedAt) + ' · ' + escapeHtml(modelName || "未知模型") + '</span><span>第三方 AI 生成</span></div>' +
            '</div>';
    }

    function formatGeneratedAt(date) {
        var year = date.getFullYear();
        var month = pad2(date.getMonth() + 1);
        var day = pad2(date.getDate());
        var hour = pad2(date.getHours());
        var minute = pad2(date.getMinutes());
        return year + "-" + month + "-" + day + " " + hour + ":" + minute;
    }

    function pad2(value) {
        return value < 10 ? "0" + value : String(value);
    }

    function captureReportScreenshot() {
        var target = document.querySelector(".nga-report-card") || document.getElementById("drawer-body");
        var statusEl = document.getElementById("footer-status");
        if (!target) {
            statusEl.textContent = "❌ 没有可截图的内容";
            return;
        }
        if (typeof html2canvas !== "function") {
            statusEl.textContent = "❌ 截图组件加载失败";
            return;
        }
        if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
            statusEl.textContent = "❌ 当前浏览器不支持图片写入剪贴板";
            return;
        }
        statusEl.textContent = "📸 正在生成截图…";
        prepareImagesForScreenshot(target).then(function () {
            return html2canvas(target, {
                backgroundColor: null,
                useCORS: true,
                allowTaint: false,
                imageTimeout: 15000,
                scale: Math.max(2, window.devicePixelRatio || 1)
            });
        }).then(function (canvas) {
            return canvasToBlob(canvas).then(function (blob) {
                return navigator.clipboard.write([
                    new ClipboardItem({
                        "image/png": blob
                    })
                ]);
            });
        }).then(function () {
            statusEl.textContent = "✅ 截图已复制到剪贴板";
        }).catch(function (err) {
            statusEl.textContent = "❌ 截图复制失败";
            console.error("[NGA大韭菜指数] screenshot failed", err);
        });
    }

    function prepareImagesForScreenshot(container) {
        var images = Array.prototype.slice.call(container.querySelectorAll("img"));
        if (!images.length) return Promise.resolve();
        return Promise.all(images.map(prepareSingleImageForScreenshot)).then(function () {});
    }

    function prepareSingleImageForScreenshot(img) {
        return inlineImageForScreenshot(img).then(function () {
            return waitForImageReady(img);
        });
    }

    function inlineImageForScreenshot(img) {
        if (!img) return Promise.resolve();
        var src = img.currentSrc || img.getAttribute("src") || "";
        if (!src || /^data:/i.test(src)) return Promise.resolve();
        if (screenshotImageCache[src]) {
            img.src = screenshotImageCache[src];
            return Promise.resolve();
        }
        return fetchImageAsDataUrl(src).then(function (dataUrl) {
            if (!dataUrl) return;
            screenshotImageCache[src] = dataUrl;
            img.src = dataUrl;
        }).catch(function () {});
    }

    function waitForImageReady(img) {
        return new Promise(function (resolve) {
            if (!img) {
                resolve();
                return;
            }
            try {
                img.crossOrigin = "anonymous";
                img.referrerPolicy = "no-referrer";
            } catch (e) {}
            if (img.complete && img.naturalWidth > 0) {
                resolve();
                return;
            }
            var done = false;
            function finish() {
                if (done) return;
                done = true;
                img.removeEventListener("load", finish);
                img.removeEventListener("error", finish);
                resolve();
            }
            img.addEventListener("load", finish, { once: true });
            img.addEventListener("error", finish, { once: true });
            setTimeout(finish, 5000);
        });
    }

    function fetchImageAsDataUrl(url) {
        return new Promise(function (resolve, reject) {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                responseType: "blob",
                onload: function (res) {
                    var blob = res.response;
                    if (res.status < 200 || res.status >= 300 || !blob) {
                        reject(new Error("image fetch failed"));
                        return;
                    }
                    blobToDataUrl(blob).then(resolve).catch(reject);
                },
                onerror: function () {
                    reject(new Error("image fetch error"));
                }
            });
        });
    }

    function blobToDataUrl(blob) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                resolve(reader.result || "");
            };
            reader.onerror = function () {
                reject(new Error("blob to data url failed"));
            };
            reader.readAsDataURL(blob);
        });
    }

    function canvasToBlob(canvas) {
        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (blob) {
                if (blob) resolve(blob);
                else reject(new Error("canvas toBlob failed"));
            }, "image/png");
        });
    }

    function renderScoreBar(label, score, cls) {
        var percent = Math.max(0, Math.min(100, score / 5 * 100));
        return '' +
            '<div class="nga-score-row">' +
                '<div class="nga-score-label">' + escapeHtml(label) + '</div>' +
                '<div class="nga-score-track"><div class="nga-score-fill ' + cls + '" style="width:' + percent + '%"></div></div>' +
                '<div class="nga-score-value">' + score.toFixed(1) + '</div>' +
            '</div>';
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    // ===================== 解析回帖 =====================
    function parsePost(html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        var results = [];
        var rows = doc.querySelectorAll("tr.topicrow");
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var post = row.querySelector("div.postcontent");
            if (!post) continue;
            var text = post.textContent;

            var quotes = post.querySelectorAll("blockquote, .quote, .quote_content");
            for (var j = 0; j < quotes.length; j++) {
                text = text.replace(quotes[j].textContent, "");
            }
            text = text.replace(/\[在主题中的回复\]/g, "").trim();
            if (text && text.indexOf("超过限制") === -1) {
                var forumEl = row.querySelector("span.titleadd2 a");
                var forum = forumEl ? forumEl.textContent : "未知";
                results.push("[" + forum + "] " + text);
            }
        }
        return results.join("\n\n");
    }
})();
