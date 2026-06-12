// ==UserScript==
// @name         NGA大韭菜指数
// @namespace    http://tampermonkey.net/
// @version      2.0
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
// @connect      *
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
    const DEBUG_SERVER_URL = "http://127.0.0.1:7777/event";
    const DEBUG_SESSION_ID = "deepseek-no-response";
    const DEBUG_RUN_ID = "pre-fix";

    // ===================== Prompt =====================
    const PROMPT = `===== [金融身份鉴定 开始] =====
[背景] 你是一名资深的金融社区观察员和心理学专家。请根据用户在NGA等论坛的回帖内容，分析其在金融投资领域的身份标签和心理账户。
[强制规则] 请严格按以下模板格式输出，不要输出任何额外内容：

💻 用户 '{USERNAME}' 金融身份深度鉴定报告

[一] 核心身份标签 (多维判定)
▷ 身份总览：(请从以下列表中选择最符合的 3-4 个标签：韭菜 / 串子(前后语言逻辑/风格明显不一致) / 股神(收益超级高) / 亚洲T王(喜欢做T，不管赚不赚，不T一下就难受) / 庄家狗(老庄派来的眼线) / 情绪垃圾桶(容易受情绪影响买卖，追涨杀跌) / 复读机 / 老登(喜欢买红利股) / 小登(喜欢买科技股) / 价值投资者(分析专业且盈利) / 车头(推荐优质股票给他人) / 跟车选手(跟随"车头"买入股票) )
▷ 判定依据：(简述为什么贴上这些标签，引用原文逻辑)

[二] 割韭菜指数评估 (1-10分)
▷ 镰刀锋利度 [危害性]：(评分 1-10) 分析：(该用户收割他人情绪或财富的能力)
▷ 韭菜鲜嫩度 [受害性]：(评分 1-10) 分析：(该用户容易被他人收割或洗脑的程度)
▷ 综合危险等级：(低 / 中 / 高 / 极高)

[三] 行为模式分析
▷ 带节奏能力：(强 / 弱) 描述：(是否擅长利用情绪词、制造恐慌或狂热)
▷ 逻辑陷阱：(是否存在偷换概念、诉诸权威、虚假因果等逻辑谬误)
▷ 潜在动机：(引流 / 卖课 / 洗盘配合 / 单纯发泄 / 寻求认同)

[四] 独家锐评
▷ 毒舌结案陈词：(一句话总结，要犀利、一针见血)

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
            '<span><button id="footer-copy" style="display:none">复制结果</button> <button id="footer-clear" style="display:none">清空</button></span></div>';
        document.body.appendChild(drawer);

        document.getElementById("drawer-close").onclick = function () {
            drawer.classList.remove("open");
            GM_deleteValue(STORAGE_KEY);
        };
        document.getElementById("footer-copy").onclick = function () {
            var body = document.getElementById("drawer-body");
            navigator.clipboard.writeText(body.innerText).then(function () {
                document.getElementById("footer-status").textContent = "✅ 已复制到剪贴板";
            });
        };
        document.getElementById("footer-clear").onclick = function () {
            document.getElementById("drawer-body").innerHTML = '<span class="placeholder">已清空</span>';
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
            (function (uid, username, button) {
                button.onclick = function (e) {
                    e.preventDefault();
                    startAnalysis(uid, username, button);
                };
            })(uidMatch[1], author.textContent.trim(), btn);
            author.parentNode.insertBefore(btn, author.nextSibling);
        }
    }

    async function startAnalysis(uid, username, btn) {
        var cfg = getConfig();
        var traceId = "nga-" + uid + "-" + Date.now();
        // #region debug-point A:start-analysis
        debugReport("A", "nga-finance-identity.user.js:startAnalysis", "startAnalysis entered", {
            uid: uid,
            username: username,
            hasBaseUrl: !!cfg.baseUrl,
            hasApiKey: !!cfg.apiKey,
            model: cfg.model || ""
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
            var html = await new Promise(function (resolve, reject) {
                GM_xmlhttpRequest({
                    method: "GET", url: url,
                    overrideMimeType: "text/html; charset=gbk",
                    onload: function (res) {
                        // #region debug-point B:nga-fetch-onload
                        debugReport("B", "nga-finance-identity.user.js:startAnalysis", "nga fetch completed", {
                            status: res.status,
                            responseLength: (res.responseText || "").length
                        }, traceId);
                        // #endregion
                        res.status === 200 ? resolve(res.responseText) : reject("请求失败：" + res.status);
                    },
                    onerror: function () {
                        // #region debug-point B:nga-fetch-onerror
                        debugReport("B", "nga-finance-identity.user.js:startAnalysis", "nga fetch network error", {}, traceId);
                        // #endregion
                        reject("网络错误");
                    }
                });
            });

            var content = parsePost(html);
            // #region debug-point B:parsed-post
            debugReport("B", "nga-finance-identity.user.js:startAnalysis", "parsed post content", {
                contentLength: content.length
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

            await callAI(cfg, fullPrompt, username, traceId);
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

    function openDrawerWith(bodyHtml, status, username) {
        var drawer = document.getElementById("nga-finance-drawer");
        drawer.classList.add("open");
        document.getElementById("drawer-body").innerHTML = bodyHtml;
        document.getElementById("footer-status").textContent = status;
        document.getElementById("drawer-meta").textContent = "目标用户：" + username;
        document.getElementById("footer-copy").style.display = "none";
        document.getElementById("footer-clear").style.display = "none";
    }

    // ===================== 调用第三方 AI (OpenAI 兼容) =====================
    function callAI(cfg, prompt, username, traceId) {
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
                        bodyEl.textContent = bodyEl.dataset.raw;
                        bodyEl.scrollTop = bodyEl.scrollHeight;
                        if (bodyEl.dataset.raw) {
                            statusEl.textContent = "✅ 完成";
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
