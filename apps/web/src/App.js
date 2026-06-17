import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
export default function App() {
    const [state, setState] = useState(null);
    const [error, setError] = useState(null);
    const [busyAction, setBusyAction] = useState(null);
    const apiBase = '';
    useEffect(() => {
        let cancelled = false;
        async function loadState() {
            try {
                const response = await fetch(`${apiBase}/api/state`);
                const data = (await response.json());
                if (!cancelled) {
                    setState(data);
                    setError(null);
                }
            }
            catch (err) {
                if (!cancelled) {
                    setError(err.message);
                }
            }
        }
        void loadState();
        const timer = window.setInterval(() => {
            void loadState();
        }, 3000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, []);
    async function runAction(action) {
        const endpoint = action === 'burst' ? `${apiBase}/api/actions/burst` : `${apiBase}/api/upgrades/processor`;
        try {
            setBusyAction(action);
            const response = await fetch(endpoint, { method: 'POST' });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error ?? '操作失败');
            }
            setState(data);
            setError(null);
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setBusyAction(null);
        }
    }
    return (_jsxs("main", { className: "app-shell", children: [_jsxs("section", { className: "hero-panel", children: [_jsx("p", { className: "eyebrow", children: "\u6302\u673A\u8D44\u6E90\u5FAA\u73AF" }), _jsx("h1", { children: "\u7528 Token \u5582\u732B" }), _jsx("p", { className: "lede", children: "TokenTracker \u8BB0\u5F55\u5230\u7684\u771F\u5B9E Token \u7528\u91CF\u4F1A\u8F6C\u5316\u4E3A\u732B\u7CAE\u3002\u6D88\u8017\u732B\u7CAE\u5347\u7EA7\u5904\u7406\u5668\uFF0C\u8BA9\u6BCF\u6B21\u540C\u6B65\u5230\u7684\u65B0 Token \u6536\u76CA\u66F4\u9AD8\u3002" })] }), _jsxs("section", { className: "grid", children: [_jsxs("article", { className: "panel stat-panel", children: [_jsx("span", { className: "label", children: "\u5C0F\u732B" }), _jsx("strong", { children: state?.player.kittenName ?? '加载中...' })] }), _jsxs("article", { className: "panel stat-panel accent", children: [_jsx("span", { className: "label", children: "\u732B\u7CAE" }), _jsx("strong", { children: state?.player.food ?? '--' })] }), _jsxs("article", { className: "panel stat-panel", children: [_jsx("span", { className: "label", children: "\u5DF2\u8FFD\u8E2A Token" }), _jsx("strong", { children: state?.player.totalTokens ?? '--' })] }), _jsxs("article", { className: "panel stat-panel", children: [_jsx("span", { className: "label", children: "\u4E0A\u6B21\u5582\u98DF" }), _jsx("strong", { children: state?.player.lastFedAt ? new Date(state.player.lastFedAt).toLocaleTimeString() : '--' })] }), _jsxs("article", { className: "panel action-panel", children: [_jsxs("div", { className: "panel-header", children: [_jsx("span", { className: "label", children: "\u64CD\u4F5C" }), _jsxs("span", { children: ["\u540C\u6B65\u5468\u671F ", Math.round((state?.progression.passiveIntervalMs ?? 30000) / 1000), " \u79D2"] })] }), _jsx("button", { disabled: busyAction !== null, onClick: () => void runAction('burst'), type: "button", children: busyAction === 'burst' ? '同步中...' : '同步真实 Token' }), _jsx("button", { className: "secondary", disabled: busyAction !== null || (state?.player.food ?? 0) < (state?.progression.nextProcessorCost ?? 0), onClick: () => void runAction('upgrade'), type: "button", children: busyAction === 'upgrade'
                                    ? '升级中...'
                                    : `升级处理器（${state?.progression.nextProcessorCost ?? '--'} 猫粮）` })] }), _jsxs("article", { className: "panel progression-panel", children: [_jsxs("div", { className: "panel-header", children: [_jsx("span", { className: "label", children: "\u6210\u957F" }), _jsx("span", { children: "\u5347\u7EA7\u5FAA\u73AF" })] }), _jsxs("div", { className: "progress-row", children: [_jsx("span", { children: "\u5904\u7406\u5668\u7B49\u7EA7" }), _jsx("strong", { children: state?.player.processorLevel ?? '--' })] }), _jsxs("div", { className: "progress-row", children: [_jsx("span", { children: "\u7D2F\u8BA1\u6D88\u8017\u732B\u7CAE" }), _jsx("strong", { children: state?.player.lifetimeFoodSpent ?? '--' })] }), _jsx("p", { className: "hint", children: "\u6BCF\u63D0\u5347 1 \u7EA7\u5904\u7406\u5668\uFF0CTokenTracker \u540C\u6B65\u5230\u7684\u6BCF\u7C7B\u65B0\u589E Token \u90FD\u4F1A\u989D\u5916\u83B7\u5F97 +2 \u732B\u7CAE\u3002" })] }), _jsxs("article", { className: "panel log-panel", children: [_jsxs("div", { className: "panel-header", children: [_jsx("span", { className: "label", children: "Token \u4E8B\u4EF6" }), _jsxs("span", { children: [state?.events.length ?? 0, " \u6761\u8BB0\u5F55"] })] }), error ? _jsx("p", { className: "error", children: error }) : null, _jsx("ul", { children: state?.events.map((event) => (_jsxs("li", { children: [_jsxs("span", { children: [event.kind, " \u7C7B +", event.foodGained, " \u732B\u7CAE"] }), _jsxs("strong", { children: [event.tokenCount, " Token"] })] }, event.id))) })] })] })] }));
}
