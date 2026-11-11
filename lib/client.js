window.__ModuleLoader__.load({
	id: "@npmc_5/dsh-tool-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const { Switch, Input } = require("@deepseek-ai/dsh-client-ui-primitives");

		const NS = "tool-manager";
		const API = "/api/npmc_5/tool-manager";
		const CORE_TOOLS = new Set(["bash", "read", "write", "edit"]);
		const STYLE_ID = "dtt-style";
		/*
		 * Bootstrap probe: every catalog response carries the preset roster, and
		 * the host now answers preset-less GETs with 400 — so the very first
		 * request borrows a throwaway preset id (an unknown id only yields a
		 * broken baseline the page discards) purely to lift the roster.
		 */
		const ROSTER_PROBE = "__dtt-roster__";

		const dictionaries = {
			ko: {
				"nav": "툴 매니저",
				"title": "툴 매니저",
				"intro": "끈 도구는 스키마·조회·실행 전부에서 숨겨집니다. 토글은 프리셋별로 관리되며, 각 프리셋 목록에는 그 프리셋이 기본으로 켜는 도구만 표시됩니다. 스위치를 끄면 해당 프리셋에서만 도구가 숨겨지고, '전부 활성화' 버튼으로 그 프리셋의 모든 도구를 다시 켜거나, '전부 비활성화' 버튼으로 모두 끌 수 있습니다. 새 세션(및 새 서브에이전트)부터 적용 — 진행 중인 세션은 프리픽스 캐시 보호를 위해 그대로 유지됩니다.",
				"preset.title": "프리셋",
				"preset.broken": "불러오기 실패",
				"preset.locked": "저장 중에는 프리셋을 바꿀 수 없습니다.",
				"preset.none": "사용 가능한 프리셋이 없습니다.",
				"chip.default": "·기본",
				"chip.brokenMark": "!",
				"search": "도구 검색",
				"filter.disabled": "끈 것만 보기",
				"empty": "표시할 도구가 없습니다.",
				"loading": "…",
				"notReady": "아직 구성할 도구 목록이 없습니다. 세션을 시작한 뒤 다시 열어주세요.",
				"loadFailed": "목록을 불러오지 못했습니다.",
				"retry": "다시 시도",
				"confirm.core": "{name} 은(는) 핵심 도구입니다. 끄면 대부분의 작업이 막힙니다. 계속할까요?",
				"error.action": "적용 실패: {error}",
				"count.disabled": "꺼진 도구 {count}개",
				"enableAll": "전부 활성화",
				"enableAll.count": "전부 활성화 ({count})",
				"enableAll.confirm": "이 프리셋의 토글 {count}개를 지우고 모든 도구를 다시 켤까요?",
				"disableAll": "전부 비활성화",
				"disableAll.confirm": "이 프리셋의 도구 {count}개를 모두 끌까요? 새 세션부터 적용됩니다.",
				"baseline.note": "아래 목록은 이 프리셋이 기본으로 켜는 도구입니다. 프리셋이 원래 끄는 도구는 목록에 나타나지 않습니다.",
				"detail.source": "출처",
				"detail.sourceUnknown": "출처 미상",
				"row.tokensTitle": "컨텍스트 {tokens} 토큰 ({tokenizer} 실측) — 이 도구 정의가 프롬프트에 차지하는 토큰. 켜져 있으면 매 요청 프리픽스에 반복 포함됩니다.",
				"row.tokensLoading": "토크나이저 로딩 중… (첫 로드는 수 초 걸립니다)",
				"tokens.summary": "활성 {count}개 · {tokens} 토큰",
				"tokens.summaryTitle": "활성 도구 전체 블록(도구별 정의 + 안내 헤더)을 실제 토크나이저로 측정한 컨텍스트 토큰. 매 요청의 프리픽스에 반복 포함되는 비용입니다.",
				"tokens.unavailable": "토크나이저를 불러올 수 없어 토큰 수를 표시하지 않습니다: {error}",
				"detail.parameters": "파라미터",
				"detail.noParameters": "파라미터 없음",
				"detail.required": "필수",
				"detail.oneOf": "허용값",
				"detail.default": "기본값",
			},
			en: {
				"nav": "Tool Manager",
				"title": "Tool Manager",
				"intro": "Turning a switch off hides that tool — schema, lookup, and execution alike. Toggles are managed per preset: each preset's list shows exactly the tools that preset enables by default, and turning one off hides it for that preset only. Use 'Enable all' to turn every tool back on, or 'Disable all' to turn them all off. Takes effect for NEW sessions (and new subagents); live sessions keep their tool surface to protect the prefix cache.",
				"preset.title": "Preset",
				"preset.broken": "failed to load",
				"preset.locked": "Preset cannot be changed while saving.",
				"preset.none": "No presets available.",
				"chip.default": "·default",
				"chip.brokenMark": "!",
				"search": "Search tools",
				"filter.disabled": "Disabled only",
				"empty": "No tools to show.",
				"loading": "…",
				"notReady": "No tool catalog yet. Start a session, then reopen this page.",
				"loadFailed": "Failed to load the tool list.",
				"retry": "Retry",
				"confirm.core": "{name} is a core tool. Disabling it blocks most work. Continue?",
				"error.action": "Failed to apply: {error}",
				"count.disabled": "{count} disabled",
				"enableAll": "Enable all",
				"enableAll.count": "Enable all ({count})",
				"enableAll.confirm": "Clear {count} toggle(s) and re-enable every tool in this preset?",
				"disableAll": "Disable all",
				"disableAll.confirm": "Disable all {count} tools in this preset? Takes effect for new sessions.",
				"baseline.note": "This is the tool set the preset enables by default; tools the preset itself disables never appear here.",
				"detail.source": "Source",
				"detail.sourceUnknown": "unknown source",
				"row.tokensTitle": "{tokens} context tokens (measured with {tokenizer}) — what this tool definition occupies in the prompt; repeated in every request prefix while enabled.",
				"row.tokensLoading": "loading tokenizer… (first load takes a few seconds)",
				"tokens.summary": "{count} enabled · {tokens} tokens",
				"tokens.summaryTitle": "Context tokens of the whole active tool block (per-tool definitions + instruction header), measured with the real tokenizer. This is the recurring prefix cost in every request.",
				"tokens.unavailable": "Tokenizer unavailable, so token counts are hidden: {error}",
				"detail.parameters": "Parameters",
				"detail.noParameters": "No parameters",
				"detail.required": "required",
				"detail.oneOf": "Allowed",
				"detail.default": "Default",
			},
		};

		const api = (path, options) => fetch(baseHref() + API + path, options).then(async (response) => {
			const body = await response.json().catch(() => null);
			if (!response.ok || !body || body.ok === false) {
				throw new Error(body?.error ?? `HTTP ${String(response.status)}`);
			}
			return body.data;
		});

		const baseHref = () => {
			const base = document.querySelector("base[href]");
			if (base === null) return "";
			try {
				return new URL(base.getAttribute("href"), window.location.href).pathname.replace(/\/+$/, "");
			} catch {
				return "";
			}
		};

		const injectStyles = () => {
			if (document.getElementById(STYLE_ID) !== null || document.head === null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			/* Token vocabulary mirrors the native settings pages (ui-settings-subagent). */
			style.textContent = [
				".dtt-page{display:grid;gap:12px;min-width:0}",
				".dtt-intro{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8a8a8f)}",
				".dtt-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
				".dtt-toolbar .dtt-search{flex:1;min-width:180px}",
				".dtt-count{color:var(--dsw-alias-label-tertiary,#8a8a8f);font-size:11px;font-weight:500;white-space:nowrap}",
				".dtt-chip{border:.5px solid var(--dsw-alias-border-l3,#d4d4d8);background:0 0;color:var(--dsw-alias-label-secondary,#6b6b70);border-radius:999px;padding:3px 10px;font-size:12px;line-height:1.5;cursor:pointer}",
				".dtt-chip:hover{background:var(--dsw-alias-bg-layer-4,rgba(0,0,0,.05))}",
				".dtt-chip[aria-pressed=true]{color:var(--dsw-alias-brand-primary,#4c6ef5);border-color:var(--dsw-alias-brand-primary,#4c6ef5)}",
				".dtt-chip.is-broken{text-decoration:line-through;opacity:.7}",
				".dtt-chip.is-locked,.dtt-chip:disabled{opacity:.5;cursor:default}",
				".dtt-reset{border:.5px solid var(--dsw-alias-border-l3,#d4d4d8);background:0 0;color:var(--dsw-alias-state-error-primary,#ef7272);border-radius:999px;padding:3px 10px;font-size:12px;line-height:1.5;cursor:pointer}",
				".dtt-reset:hover{background:var(--dsw-alias-state-error-bg,rgba(239,114,114,.12))}",
				".dtt-reset:disabled{opacity:.5;cursor:default}",
				".dtt-disable{border-color:var(--dsw-alias-state-error-primary,#ef7272);background:var(--dsw-alias-state-error-bg,rgba(239,114,114,.12))}",
				".dtt-disable:hover{background:rgba(239,114,114,.28)}",
				".dtt-list{border:.5px solid var(--dsw-alias-border-l4,#e4e4e7);border-radius:var(--dsw-radius-lg,12px);gap:2px;min-width:0;margin:0;padding:4px;display:grid}",
				".dtt-row{grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;min-width:0;padding:6px 10px;border-radius:var(--dsw-radius-md,8px);display:grid}",
				".dtt-row:hover{background:var(--dsw-alias-bg-layer-4,rgba(0,0,0,.05))}",
				".dtt-row-main{grid-template-columns:minmax(0,auto) minmax(0,1fr);align-items:baseline;gap:8px;min-width:0;display:grid;cursor:pointer}",
				".dtt-row-name{color:var(--dsw-alias-label-primary,#222226);font-size:13px;line-height:1.5;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);white-space:nowrap}",
				".dtt-row-desc{color:var(--dsw-alias-label-tertiary,#8a8a8f);font-size:11px;line-height:1.5;text-overflow:ellipsis;white-space:nowrap;display:block;overflow:hidden}",
				".dtt-row.is-off .dtt-row-name{color:var(--dsw-alias-label-tertiary,#8a8a8f)}",
				".dtt-switch-cell{display:inline-flex;align-items:center}",
				".dtt-row.is-open{background:var(--dsw-alias-bg-layer-4,rgba(0,0,0,.05))}",
				".dtt-row-main:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c6ef5);outline-offset:2px}",
				".dtt-detail{grid-column:1/-1;display:grid;gap:8px;min-width:0;margin:2px 0 4px;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l4,#e4e4e7);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-4,rgba(0,0,0,.05))}",
				".dtt-detail-source{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;min-width:0}",
				".dtt-detail-label{color:var(--dsw-alias-label-tertiary,#8a8a8f);font-size:10px;font-weight:600}",
				".dtt-detail-source-value{color:var(--dsw-alias-label-secondary,#6b6b70);font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:1.5;overflow-wrap:anywhere}",
				".dtt-detail-source-value.is-unknown{color:var(--dsw-alias-label-tertiary,#8a8a8f);font-style:italic}",
				/* Tiny per-row token figure: right-aligned mono number, meaning on hover. */
				".dtt-row-tokens{color:var(--dsw-alias-label-tertiary,#8a8a8f);font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:9px;line-height:1.4;white-space:nowrap;text-align:right;align-self:center;justify-self:end;padding-left:4px}",
				".dtt-row.is-off .dtt-row-tokens{opacity:.55}",
				".dtt-detail-params{display:grid;gap:4px;min-width:0}",
				".dtt-detail-pre{margin:0;padding:8px 10px;max-height:240px;overflow:auto;background:var(--dsw-alias-bg-layer-4,rgba(0,0,0,.05));border-radius:var(--dsw-radius-md,8px);color:var(--dsw-alias-label-primary,#222226);font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:1.5;white-space:pre}",
				".dtt-detail-noparams{color:var(--dsw-alias-label-tertiary,#8a8a8f);font-size:11px;line-height:1.5}",
				".dtt-detail-desc{margin:0;color:var(--dsw-alias-label-secondary,#6b6b70);font-size:11px;line-height:1.6;white-space:pre-wrap;overflow-wrap:break-word;min-width:0}",
				".dtt-param-list{display:grid;gap:6px;min-width:0}",
				".dtt-param{display:grid;gap:2px;min-width:0}",
				".dtt-param-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}",
				".dtt-param-name{color:var(--dsw-alias-label-primary,#222226);font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:1.5;overflow-wrap:anywhere}",
				".dtt-param-required{color:var(--dsw-alias-state-warning-primary,#b7791f);border:.5px solid currentColor;border-radius:999px;padding:0 6px;font-size:10px;font-weight:600;line-height:1.6;white-space:nowrap}",
				".dtt-param-type{color:var(--dsw-alias-label-tertiary,#8a8a8f);border:.5px solid var(--dsw-alias-border-l3,#d4d4d8);border-radius:999px;padding:0 6px;font-size:10px;line-height:1.6;white-space:nowrap}",
				".dtt-param-desc{color:var(--dsw-alias-label-tertiary,#8a8a8f);font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:break-word;min-width:0}",
				".dtt-param-meta{display:flex;align-items:center;gap:4px;flex-wrap:wrap;min-width:0}",
				".dtt-param-metalabel{color:var(--dsw-alias-label-tertiary,#8a8a8f);font-size:10px;font-weight:600}",
				".dtt-param-enum{color:var(--dsw-alias-label-secondary,#6b6b70);background:var(--dsw-alias-bg-layer-4,rgba(0,0,0,.05));border-radius:4px;padding:1px 6px;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10px;line-height:1.6;white-space:nowrap}",
				".dtt-param-default{color:var(--dsw-alias-label-secondary,#6b6b70);background:var(--dsw-alias-bg-layer-4,rgba(0,0,0,.05));border-radius:4px;padding:1px 6px;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10px;line-height:1.6;overflow-wrap:anywhere}",
				".dtt-param-nested{margin-top:2px;padding-left:14px;border-left:2px solid var(--dsw-alias-border-l3,#d4d4d8);display:grid;gap:6px;min-width:0}",
				".dtt-empty{color:var(--dsw-alias-label-tertiary,#8a8a8f);justify-self:center;padding:20px 12px;font-size:12px;line-height:1.5;margin:0}",
				".dtt-error{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary,#ef7272)}",
				".dtt-error button{color:var(--dsw-alias-brand-primary,#4c6ef5);cursor:pointer;background:0 0;border:0;padding:0;margin-left:8px}",
			].join("\n");
			document.head.append(style);
		};

		/*
		 * Schema-aware parameter renderer for the detail panel. Pretty-prints
		 * { type:"object", properties, required } schemas: one row per property
		 * (required first), type chip, description, enum/default meta, and
		 * recursion into nested objects capped at depth 3 — anything without
		 * usable `properties` (or past the cap) falls back to the raw JSON <pre>.
		 */
		const paramTypeLabel = (prop) => {
			const type = prop?.type;
			if (type === "array") {
				const itemType = prop?.items?.type;
				return itemType != null && itemType !== "" ? `array of ${String(itemType)}` : "array";
			}
			return type != null && type !== "" ? String(type) : "any";
		};

		const SCHEMA_DEPTH_CAP = 3;

		function SchemaView(props) {
			const schema = props.schema;
			const depth = props.depth ?? 0;
			const t = props.t;
			const properties = schema != null && typeof schema === "object" && !Array.isArray(schema)
				&& schema.properties != null && typeof schema.properties === "object" && !Array.isArray(schema.properties)
				? schema.properties
				: null;
			/* No usable properties, or past the recursion cap: raw JSON fragment. */
			if (properties === null || depth > SCHEMA_DEPTH_CAP) {
				return React.createElement("pre", { className: "dtt-detail-pre" }, JSON.stringify(schema, null, 2));
			}
			const requiredSet = new Set(Array.isArray(schema.required) ? schema.required : []);
			const names = Object.keys(properties);
			/* Insertion order, required keys first. */
			const ordered = [...names.filter((name) => requiredSet.has(name)), ...names.filter((name) => !requiredSet.has(name))];
			if (ordered.length === 0) {
				return React.createElement("pre", { className: "dtt-detail-pre" }, JSON.stringify(schema, null, 2));
			}
			return React.createElement("div", { className: "dtt-param-list" },
				ordered.map((name) => {
					const raw = properties[name];
					const prop = raw != null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
					const required = requiredSet.has(name);
					const hasNested = prop.type === "object" && prop.properties != null && typeof prop.properties === "object" && !Array.isArray(prop.properties);
					const hasEnum = Array.isArray(prop.enum) && prop.enum.length > 0;
					const hasDefault = prop.default !== void 0;
					return React.createElement("div", { className: "dtt-param", key: name },
						React.createElement("div", { className: "dtt-param-head" },
							React.createElement("span", { className: "dtt-param-name" }, name),
							required ? React.createElement("span", { className: "dtt-param-required" }, t("detail.required")) : null,
							React.createElement("span", { className: "dtt-param-type" }, paramTypeLabel(prop)),
						),
						prop.description ? React.createElement("div", { className: "dtt-param-desc" }, prop.description) : null,
						hasEnum || hasDefault ? React.createElement("div", { className: "dtt-param-meta" },
							hasEnum ? React.createElement(React.Fragment, null,
								React.createElement("span", { className: "dtt-param-metalabel" }, t("detail.oneOf")),
								prop.enum.map((value, index) => React.createElement("span", { className: "dtt-param-enum", key: index }, String(value))),
							) : null,
							hasDefault ? React.createElement(React.Fragment, null,
								React.createElement("span", { className: "dtt-param-metalabel" }, t("detail.default")),
								React.createElement("code", { className: "dtt-param-default" }, typeof prop.default === "object" && prop.default !== null ? JSON.stringify(prop.default) : String(prop.default)),
							) : null,
						) : null,
						hasNested ? React.createElement("div", { className: "dtt-param-nested" },
							React.createElement(SchemaView, { schema: { type: "object", properties: prop.properties, required: prop.required }, depth: depth + 1, t }),
						) : null,
					);
				}),
			);
		}

		function ToolsSection(props) {
			const t = props.t;
			const [state, setState] = React.useState({ loading: true, error: null, ready: true, tools: [], presets: [], overrides: [], broken: null, tokenStats: null });
			const [preset, setPreset] = React.useState("");
			/* Always-current selected preset; read by in-flight writes so a chip
			 * switch that lands before a POST resolves cannot retarget the write. */
			const presetRef = React.useRef("");
			const [query, setQuery] = React.useState("");
			const [onlyDisabled, setOnlyDisabled] = React.useState(false);
			/* Name of the tool whose detail panel is expanded — one at a time;
			 * null collapses all. Reset when the preset changes. */
			const [selectedTool, setSelectedTool] = React.useState(null);
			const [actionError, setActionError] = React.useState(null);
			const [resetting, setResetting] = React.useState(false);
			const pendingRef = React.useRef(new Set());
			const [pendingTools, setPendingTools] = React.useState(() => new Set());
			const revision = React.useRef(0);
			/* Flipped false on unmount; post-await setState calls check it so a
			 * closed page never writes to an unmounted component. */
			const aliveRef = React.useRef(true);
			React.useEffect(() => () => { aliveRef.current = false; }, []);
			/* True while any write (toggle, enable-all, disable-all) is in
			 * flight: locks the preset chips, the tool switches, and the bulk
			 * buttons so the scope cannot change mid-write. */
			const writeLocked = pendingTools.size > 0 || resetting;

		const load = React.useCallback(async (selectedPreset) => {
				/* The host answers preset-less catalog GETs with 400 — always name one. */
				const current = ++revision.current;
				setState((previous) => ({ ...previous, loading: true, error: null }));
				try {
					const data = await api(`/catalog?preset=${encodeURIComponent(selectedPreset)}`, { cache: "no-store" });
					if (current === revision.current && aliveRef.current) setState({
						loading: false,
						error: null,
						ready: data.ready !== false,
						tools: data.tools ?? [],
						presets: data.presets ?? [],
						overrides: data.overrides ?? [],
						broken: data.broken ?? null,
						tokenStats: data.tokenStats ?? null,
					});
				} catch (error) {
					if (current === revision.current && aliveRef.current) setState((previous) => ({ ...previous, loading: false, error: String(error?.message ?? error) }));
				}
			}, []);

			/* Bootstrap: the roster rides on every catalog response, so the first
			 * request probes with a throwaway preset id (preset-less GETs are 400;
			 * an unknown id only yields a broken baseline that is discarded here)
			 * and auto-selects the default preset, else the first one. Until it
			 * lands, the page shows the empty state and fires nothing else. */
			const loadRoster = React.useCallback(async () => {
				const current = ++revision.current;
				setState((previous) => ({ ...previous, loading: true, error: null }));
				try {
					const data = await api(`/catalog?preset=${encodeURIComponent(ROSTER_PROBE)}`, { cache: "no-store" });
					if (current !== revision.current || !aliveRef.current) return;
					const roster = (Array.isArray(data?.presets) ? data.presets : []).filter((entry) => typeof entry?.id === "string" && entry.id !== "");
					if (aliveRef.current) setState((previous) => ({ ...previous, loading: false, presets: roster }));
					if (roster.length > 0) {
						const preferred = roster.find((entry) => entry.isDefault === true) ?? roster[0];
						presetRef.current = preferred.id;
						setPreset(preferred.id);
					}
				} catch (error) {
					if (current === revision.current && aliveRef.current) setState((previous) => ({ ...previous, loading: false, error: String(error?.message ?? error) }));
				}
			}, []);

			React.useEffect(() => {
				loadRoster();
			}, [loadRoster]);

			React.useEffect(() => {
				if (preset !== "") load(preset);
			}, [load, preset]);

			/*
			 * Tokenizer first-load poll: the host pays a one-time tokenizer
			 * download+parse on the first catalog request, answering
			 * tokenStats.status "loading" until it lands. Re-request the
			 * catalog while that status holds so the token figures appear
			 * without a manual refresh; stop on any final status.
			 */
			React.useEffect(() => {
				if (preset === "" || state.tokenStats?.status !== "loading") return;
				const timer = setTimeout(() => { void load(preset); }, 2500);
				return () => clearTimeout(timer);
			}, [state.tokenStats?.status, preset, load]);

			/* Safety net: keep the ref glued to the selected preset even if a
			 * selection changes outside the chip onClick handlers. */
			React.useEffect(() => {
				presetRef.current = preset;
			}, [preset]);

			const toggle = async (tool) => {
				if (writeLocked) return;
				if (pendingRef.current.has(tool.name)) return;
				/* Snapshot the live selection: presetRef is updated synchronously
				 * by the chip onClick, so a chip switch during this write can never
				 * retarget the POST or the follow-up load to the wrong preset. */
				const targetPreset = presetRef.current;
				if (targetPreset === "") return;
				const intended = !tool.disabled;
				if (intended && CORE_TOOLS.has(tool.name) && !window.confirm(t("confirm.core", { name: tool.name }))) return;
				pendingRef.current.add(tool.name);
				setPendingTools(new Set(pendingRef.current));
				setActionError(null);
				setState((previous) => ({ ...previous, tools: previous.tools.map((row) => row.name === tool.name ? { ...row, disabled: intended } : row) }));
				try {
					await api("/set", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ name: tool.name, disabled: intended, preset: targetPreset }),
					});
					/*
					 * The catalog GET waits for the serialized settings write, so this
					 * re-read returns the post-write truth and confirms the flip.
					 */
					await load(targetPreset);
				} catch (error) {
					if (aliveRef.current) setActionError(t("error.action", { error: String(error?.message ?? error) }));
					await load(targetPreset);
				} finally {
					pendingRef.current.delete(tool.name);
					if (aliveRef.current) setPendingTools(new Set(pendingRef.current));
				}
			};

			const resetToDefault = async () => {
				if (resetting) return;
				/* Live selection, not the render-time closure (see toggle). */
				const targetPreset = presetRef.current;
				if (targetPreset === "") return;
				if (!window.confirm(t("enableAll.confirm", { count: String(state.overrides.length) }))) return;
				setResetting(true);
				setActionError(null);
				try {
					await api("/reset", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ preset: targetPreset }),
					});
					/* Read-your-writes: re-fetch the catalog after the reset write. */
					await load(targetPreset);
				} catch (error) {
					if (aliveRef.current) setActionError(t("error.action", { error: String(error?.message ?? error) }));
				} finally {
					if (aliveRef.current) setResetting(false);
				}
			};

			/* Bulk disable: one POST to /bulk (disabled:true) switches off every
			 * tool in the preset's baseline snapshot; the host answers failures
			 * with {ok:false,error}, which api() already turns into a throw. */
			const disableAll = async () => {
				if (resetting) return;
				/* Live selection, not the render-time closure (see toggle). */
				const targetPreset = presetRef.current;
				if (targetPreset === "") return;
				if (!window.confirm(t("disableAll.confirm", { count: String(state.tools.length) }))) return;
				setResetting(true);
				setActionError(null);
				try {
					await api("/bulk", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ preset: targetPreset, disabled: true }),
					});
					/* Read-your-writes: re-fetch the catalog after the bulk write. */
					await load(targetPreset);
				} catch (error) {
					if (aliveRef.current) setActionError(t("error.action", { error: String(error?.message ?? error) }));
				} finally {
					if (aliveRef.current) setResetting(false);
				}
			};

			const needle = query.trim().toLowerCase();
			const rows = state.tools.filter((tool) => (!onlyDisabled || tool.disabled) && (needle === "" || tool.name.toLowerCase().includes(needle) || tool.description.toLowerCase().includes(needle)));
			const disabledCount = state.tools.filter((tool) => tool.disabled).length;
			const overrideCount = state.overrides.length;
			/*
			 * Context-token summary: exact real-tokenizer count of the whole
			 * active tool block (definitions + instruction header) from the
			 * host; hidden until the tokenizer is ready and at least one tool
			 * is enabled.
			 */
			const enabledCount = state.tools.length - disabledCount;
			const tokenSummary = state.tokenStats?.enabledTotal != null && enabledCount > 0
				? React.createElement("span", { className: "dtt-count", title: t("tokens.summaryTitle") }, t("tokens.summary", { count: String(enabledCount), tokens: state.tokenStats.enabledTotal.toLocaleString() }))
				: null;
			/* The bulk buttons render only once a preset is selected. When
			 * overrides exist, "Enable all" shows how many toggles it clears. */
			const enableAllLabel = overrideCount > 0
				? t("enableAll.count", { count: String(overrideCount) })
				: t("enableAll");
			/* Bulk actions additionally need a settled, healthy catalog: no load
			 * in flight, not broken, and past the bootstrap probe. Search/filter
			 * stay interactive regardless. */
			const bulkDisabled = writeLocked || state.loading || state.broken !== null || state.ready === false;

			return React.createElement("div", { className: "dtt-page" },
				React.createElement("p", { className: "dtt-intro" }, t("intro")),
				React.createElement("div", { className: "dtt-toolbar", role: "group", "aria-label": t("preset.title") },
					state.presets.map((entry) => {
						const label = entry.isDefault ? `${entry.name} ${t("chip.default")}` : entry.name;
						return React.createElement("button", {
							type: "button",
							key: entry.id,
							className: `dtt-chip${entry.broken ? " is-broken" : ""}${writeLocked ? " is-locked" : ""}`,
							disabled: writeLocked,
							"aria-pressed": String(preset === entry.id),
							title: writeLocked ? t("preset.locked") : entry.broken ? `${entry.name}: ${t("preset.broken")} — ${entry.broken}` : undefined,
							onClick: () => {
								/* Re-clicking the active chip is a no-op: setPreset would
								 * bail out without re-running the load effect, so clearing
								 * the view here would wedge the page on an empty list. */
								if (presetRef.current === entry.id) return;
								presetRef.current = entry.id;
								/* Drop the previous preset's rows/counts immediately so no
								 * stale row, count, or confirm number from the old preset
								 * can be seen (or acted on) while the new catalog loads. */
								setState((previous) => ({ ...previous, tools: [], overrides: [], loading: true, broken: null, error: null }));
								/* Different preset, different rows: collapse any open
								 * detail panel so it cannot leak across presets. */
								setSelectedTool(null);
								setPreset(entry.id);
							},
						}, entry.broken ? `${label} ${t("chip.brokenMark")}` : label);
					}),
				),
				preset === "" ? (
					state.error !== null
						? React.createElement("p", { className: "dtt-error", role: "alert" }, `${t("loadFailed")} `, state.error, " ", React.createElement("button", { type: "button", onClick: () => loadRoster() }, t("retry")))
						: state.loading
							? React.createElement("p", { className: "dtt-empty" }, t("loading"))
							: React.createElement("p", { className: "dtt-empty" }, t("preset.none"))
				) : React.createElement(React.Fragment, null,
					React.createElement("div", { className: "dtt-toolbar" },
						React.createElement(Input, {
							type: "search",
							className: "dtt-search",
							placeholder: t("search"),
							"aria-label": t("search"),
							value: query,
							onChange: (event) => setQuery(event.target.value),
						}),
						React.createElement("button", {
							type: "button",
							className: "dtt-chip",
							"aria-pressed": String(onlyDisabled),
							onClick: () => setOnlyDisabled(!onlyDisabled),
						}, t("filter.disabled")),
						disabledCount > 0 ? React.createElement("span", { className: "dtt-count" }, t("count.disabled", { count: String(disabledCount) })) : null,
						tokenSummary,
						React.createElement("button", {
							type: "button",
							className: "dtt-reset",
							disabled: bulkDisabled,
							onClick: () => { void resetToDefault(); },
						}, enableAllLabel),
						React.createElement("button", {
							type: "button",
							className: "dtt-reset dtt-disable",
							disabled: bulkDisabled,
							onClick: () => { void disableAll(); },
						}, t("disableAll")),
					),
					state.broken === null
						? React.createElement("p", { className: "dtt-intro" }, t("baseline.note"))
						: null,
					actionError !== null ? React.createElement("p", { className: "dtt-error", role: "alert" }, actionError) : null,
					/* Tokenizer never became available (offline, bad path): explain the missing figures once. */
					state.tokenStats?.status === "unavailable" ? React.createElement("p", { className: "dtt-intro" }, t("tokens.unavailable", { error: state.tokenStats.error ?? "" })) : null,
					state.error !== null ? React.createElement("p", { className: "dtt-error", role: "alert" }, `${t("loadFailed")} `, state.error, " ", React.createElement("button", { type: "button", onClick: () => load(preset) }, t("retry"))) : null,
					state.broken !== null
						? React.createElement("p", { className: "dtt-error", role: "alert" }, state.broken)
						: state.ready === false
							? React.createElement("p", { className: "dtt-empty" }, t("notReady"))
							: rows.length === 0
								? React.createElement("p", { className: "dtt-empty" }, state.loading && state.tools.length === 0 ? t("loading") : t("empty"))
								: React.createElement("div", { className: "dtt-list", role: "list" }, rows.map((tool) => {
									const expanded = selectedTool === tool.name;
									const toggleDetail = () => setSelectedTool(expanded ? null : tool.name);
									return React.createElement("div", { className: `dtt-row${tool.disabled ? " is-off" : ""}${expanded ? " is-open" : ""}`, key: tool.name, role: "listitem" },
										React.createElement("div", {
											className: "dtt-switch-cell",
											/* The switch owns its click: never let it bubble out
											 * into the row's detail toggle. */
											onClick: (event) => event.stopPropagation(),
										},
											React.createElement(Switch, {
												checked: !tool.disabled,
												label: tool.name,
												disabled: writeLocked || state.loading || pendingTools.has(tool.name),
												onChange: () => toggle(tool),
											}),
										),
										React.createElement("div", {
											className: "dtt-row-main",
											role: "button",
											tabIndex: 0,
											"aria-expanded": String(expanded),
											onClick: toggleDetail,
											onKeyDown: (event) => {
												if (event.key !== "Enter" && event.key !== " ") return;
												event.preventDefault();
												toggleDetail();
											},
										},
											React.createElement("span", { className: "dtt-row-name" }, tool.name),
											React.createElement("span", { className: "dtt-row-desc", title: tool.description }, tool.description),
										),
										/*
										 * Context tokens for THIS tool definition, counted by the
										 * host with the model family's real tokenizer on the text the
										 * serving template renders per tool. Shown as a tiny right-aligned
										 * number in the LIST row (v0.6.1); the meaning lives on hover, and
										 * the toolbar carries the exact whole-block total.
										 */
										React.createElement("span", {
											className: "dtt-row-tokens",
											title: tool.tokens != null && tool.tokens.prompt != null
												? t("row.tokensTitle", { tokens: tool.tokens.prompt.toLocaleString(), tokenizer: state.tokenStats?.tokenizer ?? "" })
												: state.tokenStats?.status === "loading" ? t("row.tokensLoading") : undefined,
										}, tool.tokens != null && tool.tokens.prompt != null
											? tool.tokens.prompt.toLocaleString()
											: state.tokenStats?.status === "loading" ? "…" : ""),
										expanded ? React.createElement("div", { className: "dtt-detail" },
											React.createElement("div", { className: "dtt-detail-source" },
												React.createElement("span", { className: "dtt-detail-label" }, t("detail.source")),
												tool.sourcePlugin != null && tool.sourcePlugin !== ""
													? React.createElement("span", { className: "dtt-detail-source-value" }, tool.sourcePlugin)
													: React.createElement("span", { className: "dtt-detail-source-value is-unknown" }, t("detail.sourceUnknown")),
											),
										React.createElement("div", { className: "dtt-detail-params" },
												React.createElement("span", { className: "dtt-detail-label" }, t("detail.parameters")),
												tool.parameters != null
													? React.createElement(SchemaView, { schema: tool.parameters, depth: 0, t })
													: React.createElement("span", { className: "dtt-detail-noparams" }, t("detail.noParameters")),
											),
											tool.description ? React.createElement("p", { className: "dtt-detail-desc" }, tool.description) : null,
										) : null,
									);
								})),
				),
			);
		}

		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, dictionaries), "tool-manager: dictionaries");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "tool-manager",
				order: 60,
				label: () => t("nav"),
				inject: () => ({ t }),
			}, ToolsSection));
			injectStyles();
		}

		const inject = ["locale", "slots"];

		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
