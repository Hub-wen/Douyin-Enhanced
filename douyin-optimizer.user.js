// ==UserScript==
// @name         抖音网页版优化 - 专业重构版
// @version      2.3.0
// @author       Hub-wen
// @description  全面恢复并增强功能：性能增强、16:9优化、自动清屏、最高清晰度、隐藏干扰项、快捷键支持。系统性重构，代码注释完善。
// @match        *://*.douyin.com/*
// @match        *://*.iesdouyin.com/*
// @exclude      *://lf-zt.douyin.com*
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addStyle
// @run-at       document-start
// @license      GPL-3.0
// ==/UserScript==

(function () {
    'use strict';

    /**
     * @description 脚本配置常量，包含本地存储键名、默认值及画质优先级
     */
    const CONFIG = {
        KEYS: {
            SIDE_BAR: "J_side_bar_show",
            HEADER: "J_header_show",
            SEARCH: "J_search_show",
            RATIO_169: "J_ratio_169",
            CLEAR_TIME: "J_clear_time",
            DANMU_SPEED: "J_danmu_speed"
        },
        DEFAULTS: {
            CLEAR_TIME: 2000,
            DANMU_SPEED: 10
        },
        RES_PRIORITY: ["超清 4K", "超清 2K", "超清 1080P", "高码率", "1080P", "720P", "540P", "智能", "自动"],
        MAX_RETRIES: 3,
        RETRY_DELAY: 500
    };

    /**
     * @description DOM 选择器集合，方便统一维护与排查
     */
    const SELECTORS = {
        VIDEO: "video",
        ACTIVE_CONTAINER: [
            "[data-e2e='feed-active-video']",
            ".slider-video.active",
            ".video-card-container.active",
            ".xgplayer-playing",
            ".video-container"
        ],
        CLEAR_BTN: [
            ".xg-switch:not(.xg-switch-checked)",
            ".immersive-player-switch:not(.xg-switch-checked)",
            "[data-e2e='video-player-immersive-switch']",
            ".xgplayer-clearscreen-control:not(.xg-switch-checked)"
        ],
        RES_BTN: ".xgplayer-setting-definition, .xgplayer-definition",
        RES_LIST: ".xgplayer-options-list, .xg-options-list, .xgplayer-settings-list",
        RES_ITEMS: ".item, .xgplayer-setting-item",
        SIDE_BAR: ".positionBox, [class*='side-bar'], [class*='SideBar']",
        HEADER: "#douyin-header, [class*='HeaderContainer']",
        SEARCH: "[data-e2e='search-input'], .search-container",
        DANMU: ".xgplayer-danmu-item",
        CONTROLS: ".xg-inner-controls.xg-pos"
    };

    /**
     * @description 脚本运行状态，从 localStorage 同步用户配置
     */
    const state = {
        showSide: localStorage.getItem(CONFIG.KEYS.SIDE_BAR) !== "false",
        showHeader: localStorage.getItem(CONFIG.KEYS.HEADER) !== "false",
        showSearch: localStorage.getItem(CONFIG.KEYS.SEARCH) !== "false",
        opt169: localStorage.getItem(CONFIG.KEYS.RATIO_169) === "true",
        clearTime: parseInt(localStorage.getItem(CONFIG.KEYS.CLEAR_TIME)) || CONFIG.DEFAULTS.CLEAR_TIME,
        danmuSpeed: parseInt(localStorage.getItem(CONFIG.KEYS.DANMU_SPEED)) || CONFIG.DEFAULTS.DANMU_SPEED,
        lastVideoSrc: null,
        isSwitchingRes: false,
        retryCount: 0,
        errors: [] // 存储最近的错误日志，用于“上报”
    };

    /**
     * @description 统一日志管理
     */
    const logger = {
        info: (msg) => console.log(`%c[抖音优化] ${msg}`, "color: #00ffa3; font-weight: bold;"),
        warn: (msg) => console.warn(`%c[抖音优化] ${msg}`, "color: #ffcc00; font-weight: bold;"),
        error: (msg, err) => {
            console.error(`%c[抖音优化] ${msg}`, "color: #ff4d4d; font-weight: bold;", err);
            state.errors.push({ time: new Date().toISOString(), msg, err: err?.message || err });
            if (state.errors.length > 50) state.errors.shift(); // 保持最近50条
        }
    };

    /**
     * @description 全局异常监控
     */
    const initGlobalErrorHandling = () => {
        window.addEventListener('error', (event) => {
            // 仅记录与本脚本相关的错误
            const isOurScript = event.filename && event.filename.includes('douyin-optimizer');
            const isUserScriptFile = event.filename && event.filename.includes('.user.js');

            if (isOurScript || (isUserScriptFile && !event.message.includes('trim'))) {
                logger.error("脚本运行环境异常", event.error || event.message);
            }
        }, true);

        window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason?.message || String(event.reason);
            // 忽略站点原生的、被插件拦截产生的“背景噪音”报错
            const noiseKeywords = [
                'Network request failed',
                'status: 0',
                'next_cursor',
                'Slardar',
                'zijieapi',
                'TypeError: Cannot read properties of undefined (reading \'trim\')'
            ];

            if (noiseKeywords.some(key => reason.includes(key))) return;

            logger.error("检测到潜在异常", event.reason);
        });
    };

    /**
     * @description 注入核心 CSS 样式，处理性能优化、比例调整及干扰项隐藏
     */
    const injectStyles = () => {
        const css = `
            /* --- 性能与渲染优化 --- */
            video, .xgplayer, .xg-video-container { 
                transform: translateZ(0) !important; 
                backface-visibility: hidden !important;
                will-change: transform;
            }
            
            /* --- UI 滚动条美化 --- */
            ::-webkit-scrollbar { width: 6px !important; height: 6px !important; }
            ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2) !important; border-radius: 10px !important; }
            * { scroll-behavior: smooth !important; }

            /* --- 弹幕速度修复：防止 transition 干扰 --- */
            ${SELECTORS.DANMU} { 
                animation-duration: ${state.danmuSpeed}s !important; 
                transition: none !important; 
            }

            /* --- 沉浸式视觉优化 --- */
            ${SELECTORS.CONTROLS} { 
                background: transparent !important; 
                background-image: none !important; 
            }
            
            /* --- 16:9 比例锁定逻辑 --- */
            ${state.opt169 ? `
                .xg-video-container { background-size: contain !important; }
                .xgplayer-video-wrap { background-color: #000 !important; }
                [data-e2e="feed-active-video"] .video-card-container,
                .slider-video.active .video-card-container {
                    aspect-ratio: 16 / 9 !important;
                    max-width: 90% !important;
                    margin: 0 auto !important;
                }
            ` : ''}

            /* --- 干扰项动态隐藏逻辑 --- */
            ${!state.showSide ? `
                ${SELECTORS.SIDE_BAR} { display: none !important; }
                [class*="MainContainer"], [class*="ContentContainer"] { margin-left: 0 !important; width: 100% !important; }
            ` : ''}
            
            ${!state.showHeader ? `
                ${SELECTORS.HEADER} { 
                    height: 0 !important; 
                    overflow: hidden !important; 
                    display: none !important; 
                }
                /* 修复顶栏隐藏后的布局偏移 */
                #douyin-header { display: none !important; }
                [class*="BodyContainer"], [class*="MainContainer"] { 
                    top: 0 !important; 
                    margin-top: 0 !important; 
                    padding-top: 0 !important; 
                }
                .isCssFullScreen .xg-video-container { top: 0 !important; }
            ` : ''}

            ${!state.showSearch ? `${SELECTORS.SEARCH} { visibility: hidden !important; }` : ''}

            /* --- 交互过渡限制：确保 UI 响应灵敏且不产生闪烁 --- */
            .xg-inner-controls, .xgplayer-setting-definition {
                transition: opacity 0.2s ease !important;
            }
        `;
        GM_addStyle(css);
    };

    /**
     * @description 节流与防抖工具函数
     */
    const utils = {
        throttle: (fn, delay) => {
            let last = 0;
            return (...args) => {
                const now = Date.now();
                if (now - last >= delay) {
                    fn(...args);
                    last = now;
                }
            };
        },
        debounce: (fn, delay) => {
            let timer = null;
            return (...args) => {
                clearTimeout(timer);
                timer = setTimeout(() => fn(...args), delay);
            };
        }
    };

    /**
     * @description 获取当前活跃的视频容器元素
     * @returns {HTMLElement|null}
     */
    const getActiveContainer = () => {
        // 优先从 state 中获取，减少 DOM 查询
        for (const selector of SELECTORS.ACTIVE_CONTAINER) {
            const el = document.querySelector(selector);
            if (el) {
                const container = el.closest(".video-card-container") || el;
                // 检查容器是否在视口内（初步判断）
                const rect = container.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) return container;
            }
        }
        return null;
    };

    /**
     * @description 核心逻辑：自动切换至当前视频的最高清晰度
     * @async
     */
    const switchMaxResolution = async () => {
        if (state.isSwitchingRes || window.location.href.includes("live")) return;

        const container = getActiveContainer();
        if (!container) return;

        state.isSwitchingRes = true;
        try {
            const resBtn = container.querySelector(SELECTORS.RES_BTN);
            if (!resBtn) {
                if (state.retryCount < CONFIG.MAX_RETRIES) {
                    state.retryCount++;
                    setTimeout(switchMaxResolution, CONFIG.RETRY_DELAY);
                }
                return;
            }

            state.retryCount = 0; // 重置重试计数

            // 1. 模拟鼠标进入以加载分辨率 DOM
            resBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            await new Promise(r => setTimeout(r, 400)); // 略微增加等待时间

            // 2. 在容器内查找画质列表
            const resList = container.querySelector(SELECTORS.RES_LIST) || document.querySelector(SELECTORS.RES_LIST);
            if (!resList) {
                logger.warn("未找到清晰度列表容器");
                return;
            }

            const items = Array.from(resList.querySelectorAll(SELECTORS.RES_ITEMS));
            if (items.length > 0) {
                // 过滤并排序
                const sortedItems = items
                    .filter(item => (item.textContent || "").trim().length > 0)
                    .sort((a, b) => {
                        const aText = (a.textContent || "").toUpperCase();
                        const bText = (b.textContent || "").toUpperCase();

                        // 精确匹配优先级
                        const aIndex = CONFIG.RES_PRIORITY.findIndex(p => aText.includes(p));
                        const bIndex = CONFIG.RES_PRIORITY.findIndex(p => bText.includes(p));

                        const aP = aIndex === -1 ? 999 : aIndex;
                        const bP = bIndex === -1 ? 999 : bIndex;

                        return aP - bP;
                    });

                const target = sortedItems[0];
                if (target && !target.classList.contains("selected") && !target.classList.contains("active")) {
                    target.click();
                    logger.info(`已自动切换至最高画质: ${(target.textContent || "").trim()}`);
                } else if (target) {
                    logger.info(`当前已是最高可用画质: ${(target.textContent || "").trim()}`);
                }
            }

            // 3. 模拟鼠标离开
            resBtn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        } catch (e) {
            logger.error("画质切换发生异常", e);
        } finally {
            state.isSwitchingRes = false;
        }
    };

    /**
     * @description 核心逻辑：自动触发清屏(沉浸模式)，修复失效问题
     * 采用多重选择器与状态校验，确保执行成功
     */
    const autoClear = () => {
        if (state.clearTime === 0) return;

        const container = getActiveContainer();
        if (!container) return;

        /**
         * 尝试查找并点击清屏按钮
         */
        const attemptClear = () => {
            let clearBtn = null;
            for (const selector of SELECTORS.CLEAR_BTN) {
                clearBtn = container.querySelector(selector);
                if (clearBtn) break;
            }

            if (clearBtn && !clearBtn.classList.contains("xg-switch-checked")) {
                clearBtn.click();
                logger.info("自动清屏指令已发送");

                // 验证是否成功，若未成功则在 500ms 后重试一次
                setTimeout(() => {
                    if (!clearBtn.classList.contains("xg-switch-checked")) {
                        clearBtn.click();
                        logger.info("自动清屏重试执行");
                    }
                }, 500);
            }
        };

        // 延迟执行，等待 player 控件渲染完成
        setTimeout(attemptClear, state.clearTime);
    };

    /**
     * @description 优化后的 MutationObserver，减少性能开销
     */
    const initObservers = () => {
        const handleVideoChange = utils.debounce(() => {
            if (document.hidden) return; // 页面隐藏时不执行逻辑

            try {
                const video = document.querySelector(SELECTORS.VIDEO);
                if (video && video.src && video.src !== state.lastVideoSrc) {
                    state.lastVideoSrc = video.src;
                    logger.info("检测到视频切换，准备应用配置...");

                    // 清除之前的重试状态
                    state.retryCount = 0;

                    // 延迟执行以确保 player 对象已完成初始化
                    setTimeout(() => {
                        switchMaxResolution();
                        autoClear();
                    }, 1500); // 增加到 1.5s，确保 DOM 完全就绪
                }
            } catch (e) {
                logger.error("观察者处理异常", e);
            }
        }, 500);

        // 尝试定位更精确的观察目标
        const targetNode = document.querySelector('[data-e2e="scroll-list"]') ||
            document.querySelector('#root') ||
            document.body;

        const observer = new MutationObserver((mutations) => {
            // 仅在 src 改变、节点增加或关键属性变化时触发
            const shouldTrigger = mutations.some(m =>
                m.type === 'attributes' && (m.attributeName === 'src' || m.attributeName === 'data-e2e') ||
                m.addedNodes.length > 0
            );

            if (shouldTrigger) {
                handleVideoChange();
            }
        });

        observer.observe(targetNode, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["src", "data-e2e", "class"] // 仅监听关键属性
        });

        // 初始页面加载时尝试执行一次
        setTimeout(handleVideoChange, 2000);

        // 降级处理：每隔 10 秒进行一次状态检查，防止 Observer 失效且降低频率
        setInterval(() => {
            if (document.hidden) return;
            const video = document.querySelector(SELECTORS.VIDEO);
            if (video && video.src && video.src !== state.lastVideoSrc) {
                handleVideoChange();
            }
        }, 10000);
    };

    /**
     * @description 统一处理设置切换逻辑，更新存储并刷新页面
     * @param {string} key CONFIG.KEYS 中的键名
     * @param {boolean} currentState 当前状态值
     */
    const toggleSetting = (key, currentState) => {
        localStorage.setItem(key, !currentState);
        location.reload();
    };

    /**
     * @description 初始化用户交互逻辑：快捷键监听与油猴菜单注册
     */
    const initInteractions = () => {
        // --- 1. 快捷键监听 ---
        window.addEventListener('keydown', (e) => {
            // 排除输入框，防止误触
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

            const key = e.key.toLowerCase();
            if (key === 'c') { // C: 切换清屏
                const container = getActiveContainer();
                const btn = container?.querySelector(".xg-switch") || container?.querySelector(".immersive-player-switch");
                btn?.click();
            }
            if (key === 's') toggleSetting(CONFIG.KEYS.SIDE_BAR, state.showSide);
            if (key === 'h') toggleSetting(CONFIG.KEYS.HEADER, state.showHeader);
        });

        // --- 2. 油猴菜单命令注册 ---
        GM_registerMenuCommand(state.opt169 ? "✅ 16:9 比例锁定 (已开启)" : "⬜ 16:9 比例锁定 (已关闭)", () => toggleSetting(CONFIG.KEYS.RATIO_169, state.opt169));
        GM_registerMenuCommand(state.showSide ? "✅ 显示侧边栏" : "⬜ 隐藏侧边栏", () => toggleSetting(CONFIG.KEYS.SIDE_BAR, state.showSide));
        GM_registerMenuCommand(state.showHeader ? "✅ 显示顶栏" : "⬜ 隐藏顶栏", () => toggleSetting(CONFIG.KEYS.HEADER, state.showHeader));
        GM_registerMenuCommand(state.showSearch ? "✅ 显示搜索框" : "⬜ 隐藏搜索框", () => toggleSetting(CONFIG.KEYS.SEARCH, state.showSearch));

        GM_registerMenuCommand(`⏳ 设置清屏延迟: ${state.clearTime}ms`, () => {
            const val = prompt("输入延迟(ms), 0为关闭:", state.clearTime);
            if (val !== null) {
                localStorage.setItem(CONFIG.KEYS.CLEAR_TIME, val);
                location.reload();
            }
        });

        GM_registerMenuCommand(`🚀 设置弹幕速度: ${state.danmuSpeed}s`, () => {
            const val = prompt("输入弹幕飞行时长(秒), 越大越慢:", state.danmuSpeed);
            if (val !== null) {
                localStorage.setItem(CONFIG.KEYS.DANMU_SPEED, val);
                location.reload();
            }
        });

        GM_registerMenuCommand("🔍 查看运行日志与健康状态", () => {
            if (state.errors.length === 0) {
                alert("当前运行状态良好，未检测到异常。");
            } else {
                const log = state.errors.map(e => `[${e.time}] ${e.msg}: ${e.err}`).join("\n\n");
                console.log("[抖音优化] 完整异常日志:", state.errors);
                alert(`最近检测到 ${state.errors.length} 条异常：\n\n${log}\n\n详细信息请查看控制台。`);
            }
        });

        GM_registerMenuCommand("♻️ 重置所有脚本设置", () => {
            if (confirm("确定要重置所有设置并清除本地存储吗？")) {
                Object.values(CONFIG.KEYS).forEach(key => localStorage.removeItem(key));
                location.reload();
            }
        });
    };

    /**
     * @description 脚本启动入口
     */
    const main = () => {
        initGlobalErrorHandling();
        injectStyles();
        initInteractions();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initObservers);
        } else {
            initObservers();
        }

        logger.info("脚本初始化完成，稳定性优化已生效");
    };

    // 启动脚本
    main();
})();
