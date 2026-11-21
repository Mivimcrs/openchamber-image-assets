(() => {
  // deps/@openchamber/sdk/dist/api-version.js
  var OPENCHAMBER_SDK_CHANNEL = "openchamber.sdk";
  var OPENCHAMBER_SDK_API_VERSION = 1;

  // deps/@openchamber/sdk/dist/scrollbar-style.js
  var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
  var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
  function installGuestScrollbarActivity(doc) {
    const root = doc.documentElement;
    if (root.hasAttribute("data-oc-scrollbar-activity"))
      return;
    root.setAttribute("data-oc-scrollbar-activity", "");
    const timers = /* @__PURE__ */ new WeakMap();
    doc.addEventListener("scroll", (event) => {
      const target = event.target === doc ? root : event.target;
      if (!(target instanceof Element))
        return;
      if (!target.hasAttribute("data-oc-scrolling"))
        target.setAttribute("data-oc-scrolling", "");
      const pending = timers.get(target);
      if (pending !== void 0)
        clearTimeout(pending);
      timers.set(target, setTimeout(() => {
        timers.delete(target);
        target.removeAttribute("data-oc-scrolling");
      }, 1e3));
    }, { capture: true, passive: true });
  }
  var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;

  // deps/@openchamber/sdk/dist/workspace.js
  var GUEST_STORAGE_KEY_MAX = 128;
  var GUEST_STORAGE_VALUE_BYTES = 65536;

  // deps/@openchamber/sdk/dist/shells.js
  var GUEST_SHELL_ID_MAX = 128;
  var GUEST_SHELL_OUTPUT_TAIL_MAX = 65536;

  // deps/@openchamber/sdk/dist/status-controls.js
  var GUEST_STATUS_CONTROLS_MAX = 4;
  var GUEST_STATUS_CONTROL_ID = /^[a-z][a-z0-9-]{0,39}$/;
  var GUEST_STATUS_CONTROL_LABEL_MAX = 60;
  var GUEST_STATUS_CONTROL_OPTIONS_MAX = 16;
  var GUEST_STATUS_CONTROL_VALUE_MAX = 80;
  var isControlObject = (value) => Object(value) === value && !Array.isArray(value);
  var hasOnlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
  var isLabel = (value) => String(value) === value && value.length >= 1 && value.length <= GUEST_STATUS_CONTROL_LABEL_MAX;
  var isValue = (value) => String(value) === value && value.length >= 1 && value.length <= GUEST_STATUS_CONTROL_VALUE_MAX;
  var isGuestStatusControls = (controls) => {
    if (!Array.isArray(controls) || controls.length > GUEST_STATUS_CONTROLS_MAX)
      return false;
    const ids = /* @__PURE__ */ new Set();
    for (const control of controls) {
      if (!isControlObject(control) || !GUEST_STATUS_CONTROL_ID.test(control.id) || !isLabel(control.label))
        return false;
      if (control.disabled !== void 0 && control.disabled !== true && control.disabled !== false)
        return false;
      if (ids.has(control.id))
        return false;
      ids.add(control.id);
      if (control.kind === "button") {
        if (!hasOnlyKeys(control, ["kind", "id", "label", "disabled"]))
          return false;
        continue;
      }
      if (control.kind !== "select" || !hasOnlyKeys(control, ["kind", "id", "label", "value", "options", "disabled"]))
        return false;
      if (!isValue(control.value) || !Array.isArray(control.options) || control.options.length < 1 || control.options.length > GUEST_STATUS_CONTROL_OPTIONS_MAX)
        return false;
      const values = /* @__PURE__ */ new Set();
      for (const option of control.options) {
        if (!isControlObject(option) || !hasOnlyKeys(option, ["value", "label"]) || !isValue(option.value) || !isLabel(option.label) || values.has(option.value))
          return false;
        values.add(option.value);
      }
      if (!values.has(control.value))
        return false;
    }
    return true;
  };

  // deps/@openchamber/sdk/dist/manifest.js
  var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
  var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);

  // deps/@openchamber/sdk/dist/session-events.js
  var GUEST_SESSION_EVENT_TYPES = [
    "turn-finished",
    "turn-failed",
    "permission-asked",
    "question-asked",
    "turn-started",
    "session-created",
    "session-archived",
    "session-deleted"
  ];
  var SESSION_EVENTS_IDLE_MS = 10 * 6e4;
  var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);

  // deps/@openchamber/sdk/dist/service-host.js
  var SERVICE_SCHEDULE_IDLE_MS = 10 * 6e4;
  var MENTIONS_IDLE_MS = 10 * 6e4;

  // deps/@openchamber/sdk/dist/file-editor.js
  var GUEST_FILE_EDITOR_CONTENT_MAX = 2e7;
  var GUEST_FILE_EDITOR_VERSION_MAX = 256;
  var fileEditorPayloadSize = (value) => "bytes" in value ? value.bytes.byteLength : value.content.length;
  var sameFileEditorDocument = (left, right) => {
    if (left.path !== right.path || left.readOnly !== right.readOnly)
      return false;
    if (left.encoding === "text" || right.encoding === "text") {
      return left.encoding === "text" && right.encoding === "text" && left.content === right.content;
    }
    if (left.bytes.byteLength !== right.bytes.byteLength)
      return false;
    for (let index = 0; index < left.bytes.byteLength; index += 1) {
      if (left.bytes[index] !== right.bytes[index])
        return false;
    }
    return true;
  };

  // deps/@openchamber/sdk/dist/popover.js
  var GUEST_POPOVER_ID = /^[A-Za-z0-9_-]{1,80}$/;
  var GUEST_POPOVER_COORDINATE_MAX = 1e5;
  var GUEST_POPOVER_WIDTH_MIN = 160;
  var GUEST_POPOVER_WIDTH_MAX = 640;
  var GUEST_POPOVER_HEIGHT_MIN = 48;
  var GUEST_POPOVER_HEIGHT_MAX = 480;
  var GUEST_POPOVER_DATA_MAX = 16e3;
  var GUEST_POPOVER_DATA_DEPTH_MAX = 32;
  var GUEST_POPOVER_SIDES = ["left", "right", "top", "bottom"];
  var hasBoundedJsonTree = (value, depth = 0, budget = { remaining: GUEST_POPOVER_DATA_MAX }) => {
    if (--budget.remaining < 0 || depth >= GUEST_POPOVER_DATA_DEPTH_MAX)
      return false;
    if (value === null)
      return true;
    const children = Array.isArray(value) ? value : Object(value) === value ? Object.values(value) : [];
    for (const item of children) {
      if (!hasBoundedJsonTree(item, depth + 1, budget))
        return false;
    }
    return true;
  };
  var isFiniteJson = (value) => {
    if (value === null || value === true || value === false)
      return true;
    if (Array.isArray(value))
      return Object.keys(value).every((key) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length) && value.every(isFiniteJson);
    if (Object(value) === value) {
      const prototype = Object.getPrototypeOf(value);
      return (prototype === null || prototype === Object.prototype) && Object.values(value).every(isFiniteJson);
    }
    return String(value) === value || Number.isFinite(value);
  };
  var isGuestPopoverRequest = (request) => {
    try {
      if (String(request.id) !== request.id || !GUEST_POPOVER_ID.test(request.id) || !Number.isFinite(request.anchor.x) || Math.abs(request.anchor.x) > GUEST_POPOVER_COORDINATE_MAX || !Number.isFinite(request.anchor.y) || Math.abs(request.anchor.y) > GUEST_POPOVER_COORDINATE_MAX || !Number.isFinite(request.anchor.width) || !Number.isFinite(request.anchor.height) || request.anchor.width <= 0 || request.anchor.height <= 0 || request.anchor.width > GUEST_POPOVER_COORDINATE_MAX || request.anchor.height > GUEST_POPOVER_COORDINATE_MAX || !Number.isInteger(request.width) || request.width < GUEST_POPOVER_WIDTH_MIN || request.width > GUEST_POPOVER_WIDTH_MAX || !Number.isInteger(request.height) || request.height < GUEST_POPOVER_HEIGHT_MIN || request.height > GUEST_POPOVER_HEIGHT_MAX || request.side !== void 0 && !GUEST_POPOVER_SIDES.includes(request.side) || request.focus !== void 0 && request.focus !== true && request.focus !== false || !hasBoundedJsonTree(request.data) || !isFiniteJson(request.data))
        return false;
      return JSON.stringify(request.data).length <= GUEST_POPOVER_DATA_MAX;
    } catch {
      return false;
    }
  };

  // deps/@openchamber/sdk/dist/contract.js
  var GUEST_BLOCK_ANSWER_MAX = 2e3;
  var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
  var isStartSessionResult = (value) => Boolean(value && "sessionId" in value);
  var isPromptResult = (value) => Boolean(value && "sent" in value && !("sessionId" in value));
  var GUEST_COMMIT_SHA = /^[0-9a-f]{7,64}$/i;
  var isGuestCommitSha = (value) => GUEST_COMMIT_SHA.test(value);
  var GUEST_TOAST_MAX = 500;
  var GUEST_CLIPBOARD_TEXT_MAX = 32e3;
  var GUEST_COMPOSE_TEXT_MAX = 16e3;
  var GUEST_ATTACH_ID_MAX = 128;
  var GUEST_ATTACH_TITLE_MAX = 200;
  var GUEST_ATTACH_URL_MAX = 2e3;
  var GUEST_ATTACH_TEXT_MAX = 16e3;
  var GUEST_ATTACH_AUTHOR_MAX = 80;
  var GUEST_ATTACH_BRANCH_MAX = 200;
  var GUEST_ATTACH_DATA_MAX = 16e3;
  var GUEST_REQUEST_PATH_MAX = 2e3;
  var GUEST_REQUEST_TIMEOUT_MS = 2e4;
  var GUEST_FILE_PATH_MAX = 1024;
  var GUEST_FILE_CONTENT_MAX = 2e6;
  var GUEST_GENERATE_PROMPT_MAX = 64e3;
  var GUEST_GENERATE_SYSTEM_MAX = 8e3;
  var GUEST_GENERATE_OUTPUT_TOKENS_MAX = 4e3;
  var GUEST_GENERATE_TIMEOUT_MS = 96e4;
  var GUEST_GENERATE_LATE_KEEP_MS = 60 * 6e4;
  var GUEST_BADGE_MAX = 999;
  var GUEST_FRAME_HEIGHT_MAX = 1e4;
  var GUEST_RESOLVE_ERROR_MAX = 500;
  var HOST_REQUEST_ERROR_CODES = [
    "HOST_UNAVAILABLE",
    "HOST_TIMEOUT",
    "HOST_REJECTED",
    "DISCONNECTED",
    "DISABLED",
    "BAD_PATH",
    "NO_INTEGRATION",
    "NO_SERVICE",
    "SERVICE_FAILED",
    "REQUEST_FAILED",
    "RESPONSE_TOO_LARGE",
    "NO_SESSION",
    "SESSION_BUSY",
    "NOT_GRANTED",
    "NO_DIRECTORY",
    "NOT_FOUND",
    "FILE_TOO_LARGE",
    "DENIED",
    "NO_MODEL",
    "MODEL_FAILED",
    "UNSUPPORTED"
  ];
  var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
  var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
  var isHostRequestErrorCode = (value) => hostRequestErrorCodeSet.has(value);
  var resolveHostRequestErrorCode = (value) => value && isHostRequestErrorCode(value) ? value : "HOST_REJECTED";
  var isJsonValue = (value) => {
    if (value === void 0)
      return false;
    if (value === null || value === true || value === false)
      return true;
    if (String(value) === value)
      return true;
    if (Number(value) === value)
      return Number.isFinite(value);
    if (Array.isArray(value))
      return value.every(isJsonValue);
    if (Object(value) === value)
      return Object.values(value).every(isJsonValue);
    return false;
  };
  var isAttachData = (value) => isJsonValue(value) && JSON.stringify(value).length <= GUEST_ATTACH_DATA_MAX;
  var clampBranch = (value) => value?.trim().slice(0, GUEST_ATTACH_BRANCH_MAX) ?? "";
  var clampAttachRequest = (request) => {
    const id = request.id.trim().slice(0, GUEST_ATTACH_ID_MAX);
    const title = request.title.trim().slice(0, GUEST_ATTACH_TITLE_MAX);
    const url = request.url.trim().slice(0, GUEST_ATTACH_URL_MAX);
    const text = request.text?.trim().slice(0, GUEST_ATTACH_TEXT_MAX);
    const author = request.author?.trim().slice(0, GUEST_ATTACH_AUTHOR_MAX);
    const kind = request.kind === "pull" ? "pull" : "issue";
    const next = {
      providerId: request.providerId.trim(),
      id,
      title: title || id,
      url,
      kind
    };
    if (text) {
      next.text = text;
    }
    if (author) {
      next.author = author;
    }
    if (kind === "pull") {
      const head = clampBranch(request.branches?.head);
      const base = clampBranch(request.branches?.base);
      if (head && base) {
        next.branches = { head, base };
      }
    }
    if (isAttachData(request.data)) {
      next.data = request.data;
    }
    return next;
  };
  var clampStartSessionRequest = (request) => {
    const next = clampAttachRequest(request);
    if (request.projectId)
      next.projectId = request.projectId;
    if (request.navigation)
      next.navigation = request.navigation;
    if (request.worktree) {
      next.worktree = request.worktree;
    }
    return next;
  };
  var clampPromptRequest = (request) => {
    const next = {
      text: request.text.trim().slice(0, GUEST_COMPOSE_TEXT_MAX)
    };
    if (request.send) {
      next.send = true;
    }
    return next;
  };
  var clampBadgeCount = (count) => {
    if (count === null || !Number.isFinite(count))
      return null;
    return Math.min(GUEST_BADGE_MAX, Math.max(0, Math.round(count)));
  };
  var clampFrameHeight = (height) => {
    if (!Number.isFinite(height))
      return 0;
    return Math.min(GUEST_FRAME_HEIGHT_MAX, Math.max(0, Math.ceil(height)));
  };
  var isGuestFilePath = (value) => value.length > 0 && value.length <= GUEST_FILE_PATH_MAX && !value.includes("\0") && !value.includes("\\");
  var isGuestRequestPath = (value) => {
    if (!value.startsWith("/") || value.includes("\0") || value.includes("\\") || value.includes("://")) {
      return false;
    }
    if (value.length > GUEST_REQUEST_PATH_MAX) {
      return false;
    }
    const segments = value.split("/");
    return !segments.some((segment) => segment === "." || segment === "..");
  };
  var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
  var isServiceStatusResult = (value) => Boolean(value && "status" in value && serviceStatusSet.has(String(value.status)) && !("body" in value));
  var isGuestRequestResult = (value) => Boolean(value && "status" in value && "body" in value && Number.isInteger(value.status));
  var isFileReadResult = (value) => Boolean(value && "content" in value && String(value.content) === value.content);
  var isFileWriteResult = (value) => Boolean(value && "written" in value && value.written === true);
  var isFileListResult = (value) => Boolean(value && "entries" in value && Array.isArray(value.entries));
  var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
  var isFileStatResult = (value) => Boolean(value && "kind" in value && "size" in value && fileStatKindSet.has(String(value.kind)) && Number.isFinite(value.size));
  var isGenerateResult = (value) => Boolean(value && "text" in value && String(value.text) === value.text && !("status" in value));
  var HOST_PUSH_TYPES = /* @__PURE__ */ new Set([
    "workspace",
    "shells",
    "ready",
    "directory",
    "session",
    "connection",
    "settings",
    "session-lifecycle",
    "item",
    "resolve",
    "action",
    "service-event",
    "status-control-event",
    "popover-closed",
    "file-open",
    "file-snapshot",
    "file-saved",
    "generate-late"
  ]);
  var asWireRecord = (data) => Object(data) === data ? data : null;
  var isNonEmptyString = (value) => String(value) === value && value.length > 0;
  var readResultMessage = (wire) => {
    if (!isNonEmptyString(wire.id))
      return null;
    if (wire.ok === true) {
      const message = {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: true
      };
      if (Object(wire.payload) === wire.payload) {
        message.payload = wire.payload;
      }
      return message;
    }
    if (wire.ok === false && isNonEmptyString(wire.error)) {
      return {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: false,
        error: wire.error,
        code: resolveHostRequestErrorCode(isNonEmptyString(wire.code) ? wire.code : void 0)
      };
    }
    return null;
  };
  var readHostMessage = (data) => {
    const wire = asWireRecord(data);
    if (!wire || wire.channel !== OPENCHAMBER_SDK_CHANNEL || wire.v !== OPENCHAMBER_SDK_API_VERSION)
      return null;
    if (wire.type === "result")
      return readResultMessage(wire);
    if (!HOST_PUSH_TYPES.has(String(wire.type)) || Object(wire.payload) !== wire.payload)
      return null;
    return wire;
  };

  // deps/@openchamber/sdk/dist/host.js
  var isKeyEvent = (event) => "key" in event && "metaKey" in event && "ctrlKey" in event;
  var isSaveShortcut = (event) => (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s";
  var HostRequestError = class extends Error {
    code;
    constructor(code, message) {
      super(message);
      this.name = "HostRequestError";
      this.code = code;
    }
  };
  var rejectBadPath = () => Promise.reject(new HostRequestError("BAD_PATH", 'Request path must start with "/" and stay on the declared origin.'));
  var rejectBadFilePath = () => Promise.reject(new HostRequestError("BAD_PATH", `File path must be 1 to ${GUEST_FILE_PATH_MAX} characters without NUL or backslash.`));
  var deviceStorageScope = (options) => {
    if (options === void 0)
      return void 0;
    if (Object(options) !== options || Array.isArray(options) || options.scope !== void 0 && options.scope !== "instance" && options.scope !== "device") {
      throw new HostRequestError("HOST_REJECTED", 'Storage scope must be "instance" or "device".');
    }
    return options.scope === "device" ? "device" : void 0;
  };
  var nextId = (n) => {
    n.value += 1;
    return `oc-${n.value}`;
  };
  var connectHost = (options = {}) => {
    const target = options.target ?? ("window" in globalThis ? window : null);
    if (!target) {
      throw new HostRequestError("HOST_UNAVAILABLE", "No window. connectHost runs in a browser frame.");
    }
    const acceptSource = options.acceptSource ?? ((source) => source === target.parent);
    const requestTimeoutMs = options.requestTimeoutMs ?? GUEST_REQUEST_TIMEOUT_MS;
    const readyListeners = /* @__PURE__ */ new Set();
    const directoryListeners = /* @__PURE__ */ new Set();
    const sessionListeners = /* @__PURE__ */ new Set();
    const lifecycleListeners = /* @__PURE__ */ new Set();
    const connectionListeners = /* @__PURE__ */ new Set();
    const settingsListeners = /* @__PURE__ */ new Set();
    const itemListeners = /* @__PURE__ */ new Set();
    const blockListeners = /* @__PURE__ */ new Set();
    const serviceEventListeners = /* @__PURE__ */ new Set();
    const statusControlListeners = /* @__PURE__ */ new Set();
    const popoverClosedListeners = /* @__PURE__ */ new Set();
    const lateGenerateListeners = /* @__PURE__ */ new Set();
    const unclaimedLateGenerate = [];
    let resolveHandler = null;
    let actionHandler = null;
    const fileOpenListeners = /* @__PURE__ */ new Set();
    const fileSavedListeners = /* @__PURE__ */ new Set();
    let fileSnapshotHandler = null;
    let lastFile = null;
    let saveShortcutInstalled = false;
    const pending = /* @__PURE__ */ new Map();
    const workspaceListeners = /* @__PURE__ */ new Map();
    const shellsListeners = /* @__PURE__ */ new Map();
    let disposed = false;
    const ids = { value: 0 };
    let lastReady = null;
    let lastLifecycle = null;
    let popoverPointerActive = false;
    let popoverFocusActive = false;
    let popoverActivityReported = null;
    const lifecycleFromSession = (session) => {
      if (!session)
        return null;
      return {
        sessionId: session.id,
        phase: session.busy ? "started" : "completed"
      };
    };
    const post = (message) => {
      target.parent.postMessage(message, "*");
    };
    const listenForLateGenerate = () => {
      if (disposed || target.parent === target || lateGenerateListeners.size === 0 || lastReady?.features?.lateGenerateResults !== true)
        return;
      post({ channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION, type: "generate-late-listen" });
    };
    const emit = (listeners, value) => {
      for (const listener of listeners) {
        try {
          listener(value);
        } catch (error) {
          console.error(error);
        }
      }
    };
    const onMessage = (event) => {
      if (!(event instanceof MessageEvent))
        return;
      if (!acceptSource(event.source))
        return;
      const message = readHostMessage(event.data);
      if (!message)
        return;
      if (message.type === "workspace") {
        const listener = workspaceListeners.get(message.payload.subscriptionId);
        if (listener)
          emit([listener], message.payload.snapshot);
        return;
      }
      if (message.type === "shells") {
        const listener = shellsListeners.get(message.payload.subscriptionId);
        if (listener)
          emit([listener], message.payload.snapshot);
        return;
      }
      if (message.type === "ready") {
        lastReady = message.payload;
        lastLifecycle = lifecycleFromSession(message.payload.session);
        emit(readyListeners, message.payload);
        emit(directoryListeners, message.payload.directory);
        emit(sessionListeners, message.payload.session);
        if (lastLifecycle) {
          emit(lifecycleListeners, lastLifecycle);
        }
        emit(connectionListeners, message.payload.connection);
        emit(settingsListeners, message.payload.settings);
        emit(itemListeners, message.payload.item);
        if (message.payload.block)
          emit(blockListeners, message.payload.block);
        listenForLateGenerate();
        return;
      }
      if (message.type === "service-event") {
        emit(serviceEventListeners, message.payload);
        return;
      }
      if (message.type === "generate-late") {
        if (lateGenerateListeners.size === 0)
          unclaimedLateGenerate.push(message.payload);
        else
          emit(lateGenerateListeners, message.payload);
        return;
      }
      if (message.type === "directory") {
        if (lastReady) {
          lastReady = { ...lastReady, directory: message.payload.directory };
        }
        emit(directoryListeners, message.payload.directory);
        return;
      }
      if (message.type === "session") {
        if (lastReady) {
          lastReady = { ...lastReady, session: message.payload.session };
        }
        if (!message.payload.session) {
          lastLifecycle = null;
        } else if (lastLifecycle?.sessionId !== message.payload.session.id) {
          lastLifecycle = lifecycleFromSession(message.payload.session);
        }
        emit(sessionListeners, message.payload.session);
        return;
      }
      if (message.type === "session-lifecycle") {
        lastLifecycle = message.payload;
        emit(lifecycleListeners, message.payload);
        return;
      }
      if (message.type === "connection") {
        if (lastReady) {
          lastReady = { ...lastReady, connection: message.payload.connection };
        }
        emit(connectionListeners, message.payload.connection);
        return;
      }
      if (message.type === "settings") {
        if (lastReady) {
          lastReady = { ...lastReady, settings: message.payload.settings };
        }
        emit(settingsListeners, message.payload.settings);
        return;
      }
      if (message.type === "item") {
        if (lastReady) {
          lastReady = { ...lastReady, item: message.payload.item };
        }
        emit(itemListeners, message.payload.item);
        return;
      }
      if (message.type === "status-control-event") {
        emit(statusControlListeners, message.payload);
        return;
      }
      if (message.type === "popover-closed") {
        emit(popoverClosedListeners, message.payload);
        return;
      }
      if (message.type === "action") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "action-result",
              id: message.id,
              payload
            });
        };
        const handler = actionHandler;
        if (!handler) {
          answer({ ok: false, error: "This extension does not handle background actions." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then(() => answer({ ok: true }), (error) => {
          const text = (error instanceof Error ? error.message : String(error)).trim();
          answer({ ok: false, error: (text || "Action failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      if (message.type === "file-open") {
        const next = message.payload;
        if (lastFile && sameFileEditorDocument(lastFile, next))
          return;
        lastFile = next;
        emit(fileOpenListeners, message.payload);
        return;
      }
      if (message.type === "file-saved") {
        emit(fileSavedListeners, message.payload.version);
        return;
      }
      if (message.type === "file-snapshot") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "file-snapshot-result",
              id: message.id,
              payload
            });
        };
        const fail = (text) => answer({ error: (text.trim() || "Could not read the edited file.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        const handler = fileSnapshotHandler;
        if (!handler) {
          fail("This extension does not edit files.");
          return;
        }
        Promise.resolve().then(() => handler(message.payload.purpose)).then((snapshot) => {
          if (fileEditorPayloadSize(snapshot) > GUEST_FILE_EDITOR_CONTENT_MAX) {
            fail(`The file is over ${GUEST_FILE_EDITOR_CONTENT_MAX} ${"bytes" in snapshot ? "bytes" : "characters"}.`);
            return;
          }
          if (snapshot.version.length > GUEST_FILE_EDITOR_VERSION_MAX) {
            fail(`The snapshot version is over ${GUEST_FILE_EDITOR_VERSION_MAX} characters.`);
            return;
          }
          answer({ snapshot: "bytes" in snapshot ? { bytes: snapshot.bytes, version: snapshot.version } : { content: snapshot.content, version: snapshot.version } });
        }, (error) => fail(error instanceof Error ? error.message : String(error)));
        return;
      }
      if (message.type === "resolve") {
        const answer = (payload) => {
          post({
            channel: OPENCHAMBER_SDK_CHANNEL,
            v: OPENCHAMBER_SDK_API_VERSION,
            type: "resolve-result",
            id: message.id,
            payload
          });
        };
        const handler = resolveHandler;
        if (!handler) {
          answer({ error: "This extension does not resolve commands." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then((item) => answer({ item: item ? clampAttachRequest(item) : null }), (error) => {
          const text = (error instanceof Error ? error.message : String(error)).trim();
          answer({ error: (text || "Command failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      const waiter = pending.get(message.id);
      if (!waiter)
        return;
      clearTimeout(waiter.timer);
      pending.delete(message.id);
      if (message.ok) {
        waiter.resolve(message.payload);
        return;
      }
      waiter.reject(new HostRequestError(message.code, message.error));
    };
    target.addEventListener("message", onMessage);
    post({
      channel: OPENCHAMBER_SDK_CHANNEL,
      v: OPENCHAMBER_SDK_API_VERSION,
      type: "hello"
    });
    const send = (message, timeoutMs = requestTimeoutMs) => {
      if (disposed || target.parent === target) {
        return Promise.reject(new HostRequestError("HOST_UNAVAILABLE", "No host frame. This page is not in an iframe."));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(message.id);
          reject(new HostRequestError("HOST_TIMEOUT", "Host did not answer in time."));
        }, timeoutMs);
        pending.set(message.id, { resolve, reject, timer });
        post(message);
      });
    };
    const request = (message) => send(message).then(() => void 0);
    const envelope = { channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION };
    const notify = (message) => {
      if (!disposed && target.parent !== target)
        post(message);
    };
    const requestFileSave = () => notify({ ...envelope, type: "file-save" });
    const onSaveShortcut = (event) => {
      if (!isKeyEvent(event) || !isSaveShortcut(event))
        return;
      event.preventDefault();
      requestFileSave();
    };
    const onPopoverEscape = (event) => {
      if (!isKeyEvent(event) || event.key !== "Escape" || lastReady?.surface !== "popover" || !lastReady.popover)
        return;
      event.preventDefault();
      void closePopover(lastReady.popover.id, "escape").catch(() => void 0);
    };
    const reportPopoverActivity = () => {
      const popover = lastReady?.surface === "popover" ? lastReady.popover : void 0;
      if (!popover)
        return;
      const active2 = popoverPointerActive || popoverFocusActive;
      if (popoverActivityReported === active2)
        return;
      popoverActivityReported = active2;
      void setPopoverAnchorActive(popover.id, active2).catch(() => void 0);
    };
    const onPopoverPointerOver = () => {
      if (lastReady?.surface !== "popover" || popoverPointerActive)
        return;
      popoverPointerActive = true;
      reportPopoverActivity();
    };
    const onPopoverPointerOut = (event) => {
      if (lastReady?.surface !== "popover" || event.relatedTarget !== null || !popoverPointerActive)
        return;
      popoverPointerActive = false;
      reportPopoverActivity();
    };
    const onPopoverFocus = () => {
      if (lastReady?.surface !== "popover" || popoverFocusActive)
        return;
      popoverFocusActive = true;
      reportPopoverActivity();
    };
    const onPopoverBlur = () => {
      if (lastReady?.surface !== "popover" || !popoverFocusActive)
        return;
      popoverFocusActive = false;
      reportPopoverActivity();
    };
    const requireIdentity = (value, maximum = 1024) => {
      if (!value.trim() || value.length > maximum)
        throw new HostRequestError("HOST_REJECTED", `Identity must contain 1 to ${maximum} characters.`);
    };
    const readWorkspace = async (query) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const result = await send({ ...envelope, type: "workspace-read", id: nextId(ids), payload: query });
      if (!result || !("kind" in result) || !("state" in result) || result.kind !== query.kind) {
        throw new HostRequestError("HOST_REJECTED", "Host did not return workspace data.");
      }
      return result;
    };
    const subscribeWorkspace = async (query, listener) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const subscriptionId = nextId(ids);
      workspaceListeners.set(subscriptionId, listener);
      try {
        await request({ ...envelope, type: "workspace-subscribe", id: nextId(ids), payload: { subscriptionId, query } });
      } catch (error) {
        workspaceListeners.delete(subscriptionId);
        if (!disposed)
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        throw error;
      }
      return () => {
        if (!workspaceListeners.delete(subscriptionId) || disposed)
          return;
        post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
      };
    };
    const subscribeShells = async (scope, listener) => {
      if (scope.kind === "session")
        requireIdentity(scope.sessionId);
      if (scope.kind === "project")
        requireIdentity(scope.projectId);
      const subscriptionId = nextId(ids);
      shellsListeners.set(subscriptionId, listener);
      try {
        await request({ ...envelope, type: "shells-subscribe", id: nextId(ids), payload: { subscriptionId, scope } });
      } catch (error) {
        shellsListeners.delete(subscriptionId);
        if (!disposed)
          post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        throw error;
      }
      return () => {
        if (!shellsListeners.delete(subscriptionId) || disposed)
          return;
        post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
      };
    };
    const storage = async (payload) => {
      if ("key" in payload && (payload.key.length === 0 || payload.key.length > GUEST_STORAGE_KEY_MAX)) {
        throw new HostRequestError("HOST_REJECTED", "Storage key must contain 1 to 128 characters.");
      }
      if (payload.op === "set" && !isJsonValue(payload.value)) {
        throw new HostRequestError("HOST_REJECTED", "Storage values must be JSON.");
      }
      if (payload.op === "set" && new TextEncoder().encode(JSON.stringify(payload.value)).length > GUEST_STORAGE_VALUE_BYTES) {
        throw new HostRequestError("HOST_REJECTED", "Storage value exceeds 64 KiB.");
      }
      if (payload.scope === "device" && lastReady?.features?.deviceStorage !== true) {
        throw new HostRequestError("UNSUPPORTED", "This host does not support device storage.");
      }
      const result = await send({ ...envelope, type: "storage", id: nextId(ids), payload });
      if (!result || !("storage" in result) || result.op !== payload.op)
        throw new HostRequestError("HOST_REJECTED", "Host did not return storage data.");
      return result;
    };
    const closePopover = (id, reason) => lastReady?.features?.popovers !== true && !(lastReady?.surface === "popover" && lastReady.popover?.id === id) ? Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers.")) : request({ ...envelope, type: "popover-close", id: nextId(ids), payload: reason ? { id, reason } : { id } });
    const setPopoverAnchorActive = (id, active2) => lastReady?.features?.popovers !== true && !(lastReady?.surface === "popover" && lastReady.popover?.id === id) ? Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers.")) : request({ ...envelope, type: "popover-anchor", id: nextId(ids), payload: { id, active: active2 } });
    target.addEventListener("keydown", onPopoverEscape, true);
    target.addEventListener("pointerover", onPopoverPointerOver);
    target.addEventListener("pointermove", onPopoverPointerOver);
    target.addEventListener("pointerout", onPopoverPointerOut);
    target.addEventListener("focus", onPopoverFocus);
    target.addEventListener("blur", onPopoverBlur);
    return {
      onAction: (handler) => {
        actionHandler = handler;
        return () => {
          if (actionHandler === handler)
            actionHandler = null;
        };
      },
      listProjects: async () => {
        const result = await readWorkspace({ kind: "projects" });
        if (result.kind !== "projects")
          throw new HostRequestError("HOST_REJECTED", "Expected projects.");
        return result;
      },
      listWorktrees: async (projectId) => {
        const result = await readWorkspace({ kind: "worktrees", projectId });
        if (result.kind !== "worktrees")
          throw new HostRequestError("HOST_REJECTED", "Expected worktrees.");
        return result;
      },
      listSessions: async (projectId) => {
        const result = await readWorkspace({ kind: "sessions", projectId });
        if (result.kind !== "sessions")
          throw new HostRequestError("HOST_REJECTED", "Expected sessions.");
        return result;
      },
      onProjects: (listener) => subscribeWorkspace({ kind: "projects" }, (snapshot) => {
        if (snapshot.kind === "projects")
          listener(snapshot);
      }),
      onWorktrees: (projectId, listener) => subscribeWorkspace({ kind: "worktrees", projectId }, (snapshot) => {
        if (snapshot.kind === "worktrees")
          listener(snapshot);
      }),
      onSessions: (projectId, listener) => subscribeWorkspace({ kind: "sessions", projectId }, (snapshot) => {
        if (snapshot.kind === "sessions")
          listener(snapshot);
      }),
      onRunningShells: (scope, listener) => subscribeShells(scope, listener),
      readShellOutput: async (shellId, options2) => {
        requireIdentity(shellId, GUEST_SHELL_ID_MAX);
        const cursor = options2?.cursor;
        if (cursor !== void 0 && (!Number.isInteger(cursor) || cursor < 0)) {
          throw new HostRequestError("HOST_REJECTED", "Shell output cursor must be a non-negative integer.");
        }
        const tailBytes = options2?.tailBytes;
        if (tailBytes !== void 0 && (!Number.isInteger(tailBytes) || tailBytes < 1 || tailBytes > GUEST_SHELL_OUTPUT_TAIL_MAX)) {
          throw new HostRequestError("HOST_REJECTED", `Shell output tailBytes must be an integer between 1 and ${GUEST_SHELL_OUTPUT_TAIL_MAX}.`);
        }
        const result = await send({ ...envelope, type: "shell-output", id: nextId(ids), payload: { shellId, cursor, tailBytes } });
        const output = result;
        if (!output || typeof output.output !== "string" || !Number.isFinite(output.cursor)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return shell output.");
        }
        return output;
      },
      stopShell: async (shellId) => {
        requireIdentity(shellId, GUEST_SHELL_ID_MAX);
        const result = await send({ ...envelope, type: "shell-stop", id: nextId(ids), payload: { shellId } });
        if (result?.stopped !== true)
          throw new HostRequestError("HOST_REJECTED", "Host did not stop the shell.");
        return { stopped: true };
      },
      openSession: async (sessionId) => {
        requireIdentity(sessionId);
        await request({ ...envelope, type: "open-session", id: nextId(ids), payload: { sessionId } });
      },
      storage: {
        get: async (key, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "get", key };
          if (scope)
            payload.scope = scope;
          const result = await storage(payload);
          return result.op === "get" && result.found ? result.value : void 0;
        },
        set: async (key, value, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "set", key, value };
          if (scope)
            payload.scope = scope;
          await storage(payload);
        },
        delete: async (key, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "delete", key };
          if (scope)
            payload.scope = scope;
          await storage(payload);
        },
        keys: async (options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "keys" };
          if (scope)
            payload.scope = scope;
          const result = await storage(payload);
          if (result.op !== "keys")
            throw new HostRequestError("HOST_REJECTED", "Expected storage keys.");
          return result.keys;
        }
      },
      onReady: (listener) => {
        readyListeners.add(listener);
        if (lastReady)
          listener(lastReady);
        return () => {
          readyListeners.delete(listener);
        };
      },
      onDirectory: (listener) => {
        directoryListeners.add(listener);
        if (lastReady)
          listener(lastReady.directory);
        return () => {
          directoryListeners.delete(listener);
        };
      },
      onSession: (listener) => {
        sessionListeners.add(listener);
        if (lastReady)
          listener(lastReady.session);
        return () => {
          sessionListeners.delete(listener);
        };
      },
      onSessionLifecycle: (listener) => {
        lifecycleListeners.add(listener);
        if (lastLifecycle)
          listener(lastLifecycle);
        return () => {
          lifecycleListeners.delete(listener);
        };
      },
      onConnection: (listener) => {
        connectionListeners.add(listener);
        if (lastReady)
          listener(lastReady.connection);
        return () => {
          connectionListeners.delete(listener);
        };
      },
      onSettings: (listener) => {
        settingsListeners.add(listener);
        if (lastReady)
          listener(lastReady.settings);
        return () => {
          settingsListeners.delete(listener);
        };
      },
      onItem: (listener) => {
        itemListeners.add(listener);
        if (lastReady)
          listener(lastReady.item);
        return () => {
          itemListeners.delete(listener);
        };
      },
      onBlock: (listener) => {
        blockListeners.add(listener);
        if (lastReady?.block)
          listener(lastReady.block);
        return () => {
          blockListeners.delete(listener);
        };
      },
      onServiceEvent: (listener) => {
        serviceEventListeners.add(listener);
        return () => {
          serviceEventListeners.delete(listener);
        };
      },
      onStatusControl: (listener) => {
        statusControlListeners.add(listener);
        return () => {
          statusControlListeners.delete(listener);
        };
      },
      onPopoverClosed: (listener) => {
        popoverClosedListeners.add(listener);
        return () => {
          popoverClosedListeners.delete(listener);
        };
      },
      setStatusControls: (controls) => {
        if (lastReady?.features?.statusControls !== true) {
          return Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support status controls."));
        }
        if (!isGuestStatusControls(controls)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "Status controls must have unique bounded ids and valid selected options."));
        }
        return request({ ...envelope, type: "status-controls", id: nextId(ids), payload: { controls } });
      },
      openPopover: (payload) => {
        if (lastReady?.features?.popovers !== true) {
          return Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers."));
        }
        if (!isGuestPopoverRequest(payload)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "Popover requests need bounded geometry and JSON data."));
        }
        return request({ ...envelope, type: "popover-open", id: nextId(ids), payload });
      },
      closePopover,
      setPopoverAnchorActive,
      onResolve: (handler) => {
        resolveHandler = handler;
        return () => {
          if (resolveHandler === handler)
            resolveHandler = null;
        };
      },
      toast: (payload) => {
        const message = payload.message.trim();
        if (!message || message.length > GUEST_TOAST_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast message must contain 1 to ${GUEST_TOAST_MAX} characters.`));
        }
        if (payload.copy && payload.copy !== true && (!payload.copy.text.length || payload.copy.text.length > GUEST_CLIPBOARD_TEXT_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast copy text must contain 1 to ${GUEST_CLIPBOARD_TEXT_MAX} characters.`));
        }
        return request({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "toast",
          id: nextId(ids),
          payload: { ...payload, message }
        });
      },
      openUrl: (url) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-url",
        id: nextId(ids),
        payload: { url }
      }),
      openCommit: (sha) => isGuestCommitSha(sha) ? request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-commit",
        id: nextId(ids),
        payload: { sha }
      }) : Promise.reject(new HostRequestError("HOST_REJECTED", "Commit id must be 7 to 64 hex characters.")),
      answerBlock: (text) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "block-answer",
        id: nextId(ids),
        payload: { text: text.trim().slice(0, GUEST_BLOCK_ANSWER_MAX) }
      }),
      openSurface: (surfaceId) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-surface",
        id: nextId(ids),
        payload: { surfaceId }
      }),
      writeClipboard: (text) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "clipboard-write",
        id: nextId(ids),
        payload: { text }
      }),
      compose: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "compose",
        id: nextId(ids),
        payload
      }),
      attach: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "attach",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      startSession: async (payload) => {
        if (payload.projectId !== void 0)
          requireIdentity(payload.projectId);
        const worktree = payload.worktree;
        if (worktree && worktree !== true) {
          if (worktree.kind === "existing")
            requireIdentity(worktree.directory);
          else {
            if (worktree.name !== void 0)
              requireIdentity(worktree.name, 200);
            if (worktree.baseBranch !== void 0)
              requireIdentity(worktree.baseBranch, 200);
          }
        }
        const result = await send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "start-session",
          id: nextId(ids),
          payload: clampStartSessionRequest(payload)
        }, options.requestTimeoutMs ?? 18e4);
        if (!isStartSessionResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a session.");
        }
        return result;
      },
      prompt: (payload) => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "prompt",
        id: nextId(ids),
        payload: clampPromptRequest(payload)
      }).then((result) => {
        if (!isPromptResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a prompt result.");
        }
        return result;
      }),
      sessionLink: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "session-link",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      close: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "close",
        id: nextId(ids)
      }),
      oauthStart: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-start",
        id: nextId(ids)
      }),
      oauthDisconnect: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-disconnect",
        id: nextId(ids)
      }),
      request: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host request result was empty.");
        }
        return result;
      }),
      serviceRequest: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host service request result was empty.");
        }
        return result;
      }),
      serviceStatus: () => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-status",
        id: nextId(ids)
      }).then((result) => {
        if (!isServiceStatusResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return service status.");
        }
        return result;
      }),
      readFile: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-read",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileReadResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file content.");
        }
        return result;
      }),
      writeFile: (path, content) => {
        if (!isGuestFilePath(path)) {
          return rejectBadFilePath();
        }
        if (content.length > GUEST_FILE_CONTENT_MAX) {
          return Promise.reject(new HostRequestError("FILE_TOO_LARGE", `Content is over ${GUEST_FILE_CONTENT_MAX} characters.`));
        }
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "file-write",
          id: nextId(ids),
          payload: { path, content }
        }).then((result) => {
          if (!isFileWriteResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not confirm the write.");
          }
          return result;
        });
      },
      listDir: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-list",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileListResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return directory entries.");
        }
        return result;
      }),
      stat: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-stat",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileStatResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file status.");
        }
        return result;
      }),
      generate: (input) => {
        const prompt = input.prompt.trim();
        const system = input.system?.trim();
        if (prompt.length === 0 || prompt.length > GUEST_GENERATE_PROMPT_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Prompt must be 1 to ${GUEST_GENERATE_PROMPT_MAX} characters.`));
        }
        if (system !== void 0 && (system.length === 0 || system.length > GUEST_GENERATE_SYSTEM_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `System prompt must be 1 to ${GUEST_GENERATE_SYSTEM_MAX} characters.`));
        }
        const maxOutputTokens = input.maxOutputTokens === void 0 ? void 0 : Math.min(GUEST_GENERATE_OUTPUT_TOKENS_MAX, Math.max(1, Math.floor(input.maxOutputTokens)));
        if (maxOutputTokens !== void 0 && !Number.isFinite(maxOutputTokens)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "maxOutputTokens must be a number."));
        }
        const payload = { prompt };
        if (system !== void 0)
          payload.system = system;
        if (maxOutputTokens !== void 0)
          payload.maxOutputTokens = maxOutputTokens;
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "generate",
          id: nextId(ids),
          payload
        }, options.requestTimeoutMs ?? GUEST_GENERATE_TIMEOUT_MS).then((result) => {
          if (!isGenerateResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not return generated text.");
          }
          return result;
        });
      },
      onLateGenerateResult: (listener) => {
        lateGenerateListeners.add(listener);
        for (const result of unclaimedLateGenerate.splice(0))
          emit([listener], result);
        listenForLateGenerate();
        return () => {
          lateGenerateListeners.delete(listener);
        };
      },
      setBadge: (count) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "badge",
        id: nextId(ids),
        payload: { count: clampBadgeCount(count) }
      }),
      setHeight: (height) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "resize",
        id: nextId(ids),
        payload: { height: clampFrameHeight(height) }
      }),
      onFileOpen: (listener) => {
        fileOpenListeners.add(listener);
        if (!saveShortcutInstalled) {
          saveShortcutInstalled = true;
          target.addEventListener("keydown", onSaveShortcut, true);
        }
        if (lastFile)
          listener(lastFile);
        return () => {
          fileOpenListeners.delete(listener);
        };
      },
      onFileSnapshot: (handler) => {
        fileSnapshotHandler = handler;
        return () => {
          if (fileSnapshotHandler === handler)
            fileSnapshotHandler = null;
        };
      },
      onFileSaved: (listener) => {
        fileSavedListeners.add(listener);
        return () => {
          fileSavedListeners.delete(listener);
        };
      },
      reportFileChange: (change) => notify({ ...envelope, type: "file-change", payload: { dirty: change.dirty, edited: change.edited } }),
      requestFileSave,
      reportFileUnsupported: () => notify({ ...envelope, type: "file-unsupported" }),
      dispose: () => {
        for (const subscriptionId of workspaceListeners.keys()) {
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        }
        workspaceListeners.clear();
        for (const subscriptionId of shellsListeners.keys()) {
          post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        }
        shellsListeners.clear();
        disposed = true;
        resolveHandler = null;
        actionHandler = null;
        fileSnapshotHandler = null;
        fileOpenListeners.clear();
        fileSavedListeners.clear();
        if (saveShortcutInstalled)
          target.removeEventListener("keydown", onSaveShortcut, true);
        target.removeEventListener("message", onMessage);
        target.removeEventListener("keydown", onPopoverEscape, true);
        target.removeEventListener("pointerover", onPopoverPointerOver);
        target.removeEventListener("pointermove", onPopoverPointerOver);
        target.removeEventListener("pointerout", onPopoverPointerOut);
        target.removeEventListener("focus", onPopoverFocus);
        target.removeEventListener("blur", onPopoverBlur);
        for (const waiter of pending.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(new HostRequestError("HOST_UNAVAILABLE", "Host client was disposed."));
        }
        pending.clear();
        readyListeners.clear();
        directoryListeners.clear();
        sessionListeners.clear();
        lifecycleListeners.clear();
        connectionListeners.clear();
        settingsListeners.clear();
        itemListeners.clear();
        blockListeners.clear();
        serviceEventListeners.clear();
        statusControlListeners.clear();
        popoverClosedListeners.clear();
        lateGenerateListeners.clear();
        unclaimedLateGenerate.length = 0;
      }
    };
  };

  // deps/@openchamber/sdk/dist/service-providers.js
  var BROWSER_CONTROL_ACTIONS = [
    "browser.open",
    "browser.snapshot",
    "browser.click",
    "browser.type",
    "browser.select",
    "browser.scroll",
    "browser.back",
    "browser.forward",
    "browser.inspect",
    "browser.capture",
    "browser.resize",
    "browser.close"
  ];
  var BROWSER_PROVIDER_IDLE_MS = 10 * 6e4;
  var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
  var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 6e4;
  var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 6e4;
  var TRACKER_PROVIDER_IDLE_MS = 10 * 6e4;
  var QUOTA_PROVIDER_IDLE_MS = 10 * 6e4;

  // deps/@openchamber/sdk/dist/service-surface.js
  var SURFACE_CONTROLLERS = ["none", "agent", "user"];
  var CONTROLLERS = new Set(SURFACE_CONTROLLERS);

  // deps/@openchamber/sdk/dist/ui/theme.js
  var TOKEN_VARS = [
    ["--oc-bg", "background"],
    ["--oc-elevated", "elevated"],
    ["--oc-fg", "foreground"],
    ["--oc-muted", "muted"],
    ["--oc-subtle", "subtle"],
    ["--oc-border", "border"],
    ["--oc-hover", "hover"],
    ["--oc-selection", "selection"],
    ["--oc-focus", "focus"],
    ["--oc-primary", "primary"],
    ["--oc-muted-surface", "mutedSurface"],
    ["--oc-elevated-fg", "elevatedForeground"],
    ["--oc-active", "active"],
    ["--oc-selection-fg", "selectionForeground"],
    ["--oc-primary-fg", "primaryForeground"],
    ["--oc-primary-text", "primaryText"],
    ["--oc-success-text", "successText"],
    ["--oc-warning-text", "warningText"],
    ["--oc-error-text", "errorText"],
    ["--oc-info-text", "infoText"],
    ["--oc-success", "success"],
    ["--oc-warning", "warning"],
    ["--oc-error", "error"],
    ["--oc-info", "info"],
    ["--oc-font", "font"],
    ["--oc-mono", "mono"],
    ["--oc-radius", "radius"],
    ["--surface-background", "background"],
    ["--surface-elevated", "elevated"],
    ["--surface-foreground", "foreground"],
    ["--surface-muted-foreground", "muted"],
    ["--surface-subtle", "subtle"],
    ["--interactive-border", "border"],
    ["--interactive-hover", "hover"],
    ["--interactive-selection", "selection"],
    ["--interactive-focus-ring", "focus"],
    ["--primary", "primary"],
    ["--surface-muted", "mutedSurface"],
    ["--surface-elevated-foreground", "elevatedForeground"],
    ["--interactive-active", "active"],
    ["--interactive-selection-foreground", "selectionForeground"],
    ["--primary-foreground", "primaryForeground"],
    ["--primary-text", "primaryText"],
    ["--success-text", "successText"],
    ["--warning-text", "warningText"],
    ["--error-text", "errorText"],
    ["--info-text", "infoText"],
    ["--status-success", "success"],
    ["--status-warning", "warning"],
    ["--status-error", "error"],
    ["--status-info", "info"],
    ["--font-sans", "font"],
    ["--font-mono", "mono"],
    ["--radius", "radius"]
  ];
  var SYNTAX_TOKEN_VARS = [
    ["--oc-syntax-keyword", "--syntax-keyword", "syntaxKeyword"],
    ["--oc-syntax-string", "--syntax-string", "syntaxString"],
    ["--oc-syntax-number", "--syntax-number", "syntaxNumber"],
    ["--oc-syntax-function", "--syntax-function", "syntaxFunction"],
    ["--oc-syntax-type", "--syntax-type", "syntaxType"],
    ["--oc-syntax-comment", "--syntax-comment", "syntaxComment"],
    ["--oc-syntax-variable", "--syntax-variable", "syntaxVariable"],
    ["--oc-syntax-operator", "--syntax-operator", "syntaxOperator"]
  ];
  var applyHostTheme = (theme, root) => {
    root.style.colorScheme = theme.mode;
    for (const [name, key] of TOKEN_VARS) {
      root.style.setProperty(name, theme.tokens[key]);
    }
    for (const [alias, hostName, key] of SYNTAX_TOKEN_VARS) {
      const value = theme.tokens[key] ?? "";
      root.style.setProperty(alias, value);
      root.style.setProperty(hostName, value);
    }
    root.style.setProperty("font-family", theme.tokens.font);
    root.style.setProperty("font-size", "0.875rem");
    root.style.setProperty("line-height", "1.45");
    root.style.setProperty("color", theme.tokens.foreground);
  };
  var applyHostReady = (ctx, root) => {
    applyHostTheme(ctx.theme, root);
    if (root.dataset) {
      root.dataset.ocSurface = ctx.surface;
      root.dataset.ocTheme = ctx.theme.mode;
    }
  };

  // deps/@openchamber/sdk/dist/ui/style.js
  var OC_ALIAS = {
    "surface-background": "bg",
    "surface-elevated": "elevated",
    "surface-elevated-foreground": "elevated-fg",
    "surface-foreground": "fg",
    "surface-muted-foreground": "muted",
    "surface-muted": "muted-surface",
    "surface-subtle": "subtle",
    "interactive-border": "border",
    "interactive-hover": "hover",
    "interactive-active": "active",
    "interactive-selection": "selection",
    "interactive-selection-foreground": "selection-fg",
    "interactive-focus-ring": "focus",
    "primary": "primary",
    "primary-foreground": "primary-fg",
    "primary-text": "primary-text",
    "success-text": "success-text",
    "warning-text": "warning-text",
    "error-text": "error-text",
    "info-text": "info-text",
    "status-success": "success",
    "status-warning": "warning",
    "status-error": "error",
    "status-info": "info",
    "font-sans": "font",
    "font-mono": "mono",
    "radius": "radius"
  };
  var v = (name, fallback) => `var(--${name}, var(--oc-${OC_ALIAS[name]}, ${fallback}))`;
  var bg = v("surface-background", "transparent");
  var elevated = v("surface-elevated", "transparent");
  var elevatedFg = v("surface-elevated-foreground", "inherit");
  var fg = v("surface-foreground", "inherit");
  var muted = v("surface-muted-foreground", "gray");
  var secondary = v("surface-muted", "transparent");
  var border = v("interactive-border", "currentColor");
  var hover = v("interactive-hover", "transparent");
  var active = v("interactive-active", "transparent");
  var selection = v("interactive-selection", "transparent");
  var selectionFg = v("interactive-selection-foreground", "inherit");
  var primary = v("primary", "currentColor");
  var primaryText = v("primary-text", "inherit");
  var errorText = v("error-text", "inherit");
  var font = v("font-sans", "inherit");
  var mono = v("font-mono", "monospace");
  var radius = v("radius", "9px");
  var controlRadius = `calc(${radius} - 2px)`;
  var smallRadius = `calc(${radius} - 4px)`;
  var mix = (color, pct, base = "transparent") => `color-mix(in srgb, ${color} ${pct}%, ${base})`;
  var focusFill = `background-image: linear-gradient(${hover}, ${hover});`;
  var field = (edge, width = "0.5px") => `box-shadow: inset 0 0 0 ${width} ${edge}, var(--oc-sdk-field-lift);`;
  var raised = "border-color: var(--oc-sdk-edge); box-shadow: var(--oc-sdk-raised-lift);";
  var litButton = "box-shadow: var(--oc-sdk-lit);";
  var darkLift = `inset 0 0.5px 0 0 ${mix(fg, 8)}, 0 1px 2px 0 rgb(0 0 0 / 0.4)`;
  var THEME_VARS = `
:root {
  --oc-sdk-edge: ${mix(fg, 16)};
  --oc-sdk-field-bg: ${elevated};
  --oc-sdk-raised-bg: ${bg};
  --oc-sdk-field-lift: inset 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --oc-sdk-raised-lift: 0 1px 1.5px 0 rgb(0 0 0 / 0.08);
  --oc-sdk-lit: inset 0 1px 0 0 rgb(255 255 255 / 0.2), 0 1px 1.5px 0 rgb(0 0 0 / 0.1);
  --oc-sdk-float-edge: rgb(0 0 0 / 0.14);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.7), 0 1px 2px -0.5px rgb(0 0 0 / 0.06), 0 4px 8px -2px rgb(0 0 0 / 0.08), 0 12px 20px -4px rgb(0 0 0 / 0.06);
}
:root[data-oc-theme="dark"] {
  --oc-sdk-edge: ${mix(fg, 14)};
  --oc-sdk-field-bg: ${mix(bg, 50, elevated)};
  --oc-sdk-raised-bg: ${elevated};
  --oc-sdk-field-lift: ${darkLift};
  --oc-sdk-raised-lift: ${darkLift};
  --oc-sdk-lit: ${darkLift};
  --oc-sdk-float-edge: rgb(0 0 0 / 0.55);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.04), inset 0 0 0 0.5px rgb(255 255 255 / 0.08), 0 8px 16px 0 rgb(0 0 0 / 0.25), 0 4px 8px 0 rgb(0 0 0 / 0.25);
}`;
  var tone = (name) => {
    const color = v(`status-${name}`, "currentColor");
    return `
.oc-sdk[data-tone="${name}"], .oc-sdk [data-tone="${name}"] { --oc-sdk-tone: ${color}; --oc-sdk-tone-text: ${v(`${name}-text`, "inherit")}; }`;
  };
  var UI_SIZE_CSS = `
.oc-sdk { box-sizing: border-box; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 32px; padding: 0 12px; border: 1px solid transparent; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; }
.oc-sdk-btn[data-size="sm"] { gap: 6px; height: 28px; padding: 0 10px; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { gap: 4px; height: 24px; padding: 0 8px; font-size: 0.75rem; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: 14px; height: 14px; }

.oc-sdk-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: 32px; padding: 0 10px; border: 0; font-size: 0.875rem; line-height: 1.45; appearance: none; }
textarea.oc-sdk-input { height: auto; padding: 8px 10px; resize: vertical; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: 34px; padding-right: 34px; }
.oc-sdk-search-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); pointer-events: none; }
.oc-sdk-search-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: 24px; height: 24px; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; width: auto; max-width: 100%; min-width: 0; height: 28px; padding: 0 10px; border: 1px solid transparent; font-size: 0.8125rem; text-align: left; }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; }
.oc-sdk-popup { position: fixed; z-index: 50; display: flex; flex-direction: column; gap: 2px; min-width: 160px; max-width: calc(100vw - 16px); max-height: min(320px, calc(100vh - 16px)); overflow: auto; padding: 4px; border: 1px solid transparent; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: 2px 2px 4px; }
.oc-sdk-popup-search .oc-sdk-input { height: 28px; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; }
.oc-sdk-option-check { flex: 0 0 auto; display: inline-flex; width: 14px; visibility: hidden; }
.oc-sdk-option[aria-selected="true"] > .oc-sdk-option-check { visibility: visible; }
.oc-sdk-popup-empty { padding: 8px; font-size: 0.8125rem; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin-top: 3px; border: 1px solid transparent; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: 36px; height: 20px; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; }

.oc-sdk-tabs { display: inline-flex; gap: 2px; padding: 2px; max-width: 100%; overflow: auto; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid transparent; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: 1px 6px; font-size: 11px; font-weight: 500; line-height: 16px; white-space: nowrap; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; text-align: left; }
.oc-sdk-row-lead { flex: 0 0 auto; width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-list-empty { padding: 16px 8px; text-align: center; font-size: 0.8125rem; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 40px 16px; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; }
.oc-sdk-empty-action { margin-top: 12px; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8125rem; }
.oc-sdk-spinner-ring { width: 16px; height: 16px; border: 2px solid transparent; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: 12px; height: 12px; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: 12px; padding: 8px 12px; border: 1px solid transparent; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-banner-body { font-size: 0.8125rem; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: 8px; width: 100%; margin: 8px 0; font-size: 0.75rem; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: 4px 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: 6px; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; transform-origin: left; transition: transform 200ms ease-out; }
.oc-sdk-progress-value { display: inline-flex; align-items: center; gap: 2px; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { font-weight: 600; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text img { display: block; max-width: 100%; margin: 8px 0; }
`;
  var GUEST_UI_LOOK_CSS = `${THEME_VARS}
.oc-sdk { color: ${fg}; font-family: ${font}; }
.oc-sdk :focus-visible, .oc-sdk:focus-visible { outline: none; }
.oc-sdk :where(button, a[href], [role="button"], [role="tab"], [role="option"]):focus-visible, button.oc-sdk:focus-visible { ${focusFill} }
.oc-sdk-mono { font-family: ${mono}; }
.oc-sdk-muted { color: ${muted}; }
${tone("success")}${tone("warning")}${tone("error")}${tone("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${primary}; --oc-sdk-tone-text: ${primaryText}; }

.oc-sdk-btn { border-radius: ${controlRadius}; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="xs"] { border-radius: ${smallRadius}; }
.oc-sdk-btn[data-variant="default"] { color: ${primaryText}; background: ${mix(primary, 10, bg)}; border-color: ${mix(primary, 12)}; ${litButton} }
.oc-sdk-btn[data-variant="default"]:hover { background: ${mix(primary, 16, bg)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${mix(primary, 22, bg)}; box-shadow: none; }
.oc-sdk-btn[data-variant="secondary"] { background: ${secondary}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-btn[data-variant="outline"] { background: var(--oc-sdk-raised-bg); color: ${elevatedFg}; ${raised} }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${active}, ${active}); box-shadow: none; }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${hover}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${active}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${v("status-error", "red")}; color: ${errorText}; background: ${mix("var(--oc-sdk-tone)", 7, bg)}; border-color: ${mix("var(--oc-sdk-tone)", 12)}; ${litButton} }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${mix("var(--oc-sdk-tone)", 9, bg)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${mix("var(--oc-sdk-tone)", 11, bg)}; box-shadow: none; }

.oc-sdk-field-note { color: ${muted}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${errorText}; }
.oc-sdk-input { border-radius: ${controlRadius}; background: var(--oc-sdk-field-bg); color: ${elevatedFg}; ${field("var(--oc-sdk-edge)")} transition: background 150ms ease-out; }
.oc-sdk-input::placeholder { color: ${muted}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { ${field(mix(fg, 26), "1px")} }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input, .oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { ${field(v("status-error", "red"), "1px")} }
.oc-sdk-input[data-mono="true"] { font-family: ${mono}; }

.oc-sdk-search-icon { color: ${muted}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${primary}; }
.oc-sdk-search-clear { border-radius: ${smallRadius}; color: ${muted}; }
.oc-sdk-search-clear:hover { background: ${hover}; color: ${fg}; }

.oc-sdk-trigger { border-radius: ${controlRadius}; background: var(--oc-sdk-raised-bg); color: ${elevatedFg}; ${raised} transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-trigger-value[data-empty="true"] { color: ${muted}; }
.oc-sdk-trigger-chevron { color: ${muted}; }
/* The app's floating level: the glass edge (a hairline ring and a lit top line, dark outside and light inside in dark themes) over soft shadows. The outer ring is the border, over the page like the app's. */
.oc-sdk-popup { --surface-foreground: ${elevatedFg}; border-color: var(--oc-sdk-float-edge); border-radius: 12px; background: ${elevated}; background-clip: padding-box; color: ${elevatedFg}; box-shadow: var(--oc-sdk-float); }
.oc-sdk-option { border-radius: 8px; }
.oc-sdk-option[data-active="true"] { background: ${hover}; }
/* A selected option shows a check mark in the text colour, like the app's own pickers. Options without the mark come
   from bundles built before it existed and keep the selection fill as their only sign of the choice. */
.oc-sdk-option[aria-selected="true"]:not([data-mark]) { background: ${selection}; color: ${selectionFg}; }
.oc-sdk-option-check { color: ${fg}; }
.oc-sdk-option[data-destructive="true"] { color: ${errorText}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${mix(v("status-error", "red"), 10)}; }
.oc-sdk-option-hint { color: ${muted}; }
.oc-sdk-popup-empty { color: ${muted}; }

/* Checked stays neutral: the mark carries the state, and the primary colour stays with primary actions. */
.oc-sdk-check-box { border-color: ${border}; border-radius: 4px; color: ${fg}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${mix(fg, 60, border)}; }
.oc-sdk-check-thumb { border-radius: 9999px; background: ${border}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { border-radius: 9999px; background: ${bg}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${primary}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(16px); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${focusFill} }
.oc-sdk-check-desc { color: ${muted}; }

.oc-sdk-tabs { border-radius: 10px; }
.oc-sdk-tabs[data-track="true"] { background: ${mix(fg, 4)}; box-shadow: inset 0 1px 2px 0 rgb(0 0 0 / 0.16); }
.oc-sdk-tab { border-radius: 8px; color: ${muted}; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${fg}; }
.oc-sdk-tab[aria-selected="true"] { color: ${selectionFg}; background: ${selection}; border-color: ${border}; }
.oc-sdk-tabs[data-track="true"] .oc-sdk-tab[aria-selected="true"] { color: ${elevatedFg}; background: var(--oc-sdk-raised-bg); ${raised} }
.oc-sdk-tab-count { color: ${muted}; }

/* The app's neutral badge: a step of the text colour, the same in every theme. */
.oc-sdk-badge { border-radius: 9999px; background: ${mix(fg, 6)}; color: ${muted}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${mix("var(--oc-sdk-tone)", 15)}; }

.oc-sdk-row { border-radius: 6px; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${hover}; }
.oc-sdk-row[aria-selected="true"] { background: ${selection}; color: ${selectionFg}; }
.oc-sdk-row-lead { font-family: ${mono}; color: ${muted}; }
.oc-sdk-row-sub { color: ${muted}; }
.oc-sdk-row-meta { color: ${muted}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { color: ${muted}; }

.oc-sdk-empty-body { color: ${muted}; }

.oc-sdk-spinner { color: ${muted}; }
.oc-sdk-spinner-ring { border-color: ${border}; border-top-color: ${primary}; border-radius: 9999px; }

/* Set apart by its tint alone, like the app's banners. */
.oc-sdk-banner { border-color: transparent; border-radius: 8px; background: ${mix("var(--oc-sdk-tone)", 10)}; }
.oc-sdk-banner-title { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { color: ${muted}; }

.oc-sdk-separator { color: ${muted}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { background: ${mix(border, 40)}; }

.oc-sdk-progress-label { color: ${muted}; }
/* The app's progress: a groove a step of the text colour, green once done. Older bundles mark done only through aria-valuenow. */
.oc-sdk-progress-track { border-radius: 9999px; background: ${mix(fg, 6)}; }
.oc-sdk-progress-fill { border-radius: 9999px; background: var(--oc-sdk-tone, ${primary}); }
.oc-sdk-progress-track[aria-valuenow="100"] > .oc-sdk-progress-fill:not([data-tone]) { background: ${v("status-success", "currentColor")}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { color: ${v("success-text", "inherit")}; }

.oc-sdk-text a { color: ${primaryText}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { border-radius: 8px; border: 1px solid ${mix(border, 60)}; }
`;
  var UI_CSS = `
${GUEST_SCROLLBAR_CSS}
${UI_SIZE_CSS}
${GUEST_UI_LOOK_CSS}`;

  // ../../../../.config/openchamber/extensions/image-assets/源码/共享/生成.js
  var SIZE_PRESETS = [
    { label: "1:1", size: "1024x1024" },
    { label: "2:3", size: "1024x1536" },
    { label: "3:2", size: "1536x1024" },
    { label: "3:4", size: "1152x1536" },
    { label: "4:3", size: "1536x1152" },
    { label: "16:9", size: "1536x864" },
    { label: "9:16", size: "864x1536" }
  ];
  var MAX_REFERENCES = 4;
  var MAX_COUNT = 4;

  // ../../../../.config/openchamber/extensions/image-assets/源码/共享/模型.js
  var MODEL_CAPS = {
    "gpt-image-2.6-sunburst": {
      text2img: true,
      img2img: true,
      transparent: true,
      honorsSize: true,
      note: "\u6587\u751F\u56FE\u4E0E\u53C2\u8003\u56FE\u751F\u56FE\u5747\u53EF\u7528\uFF0C\u5C3A\u5BF8\u6309\u8BF7\u6C42\u8FD4\u56DE"
    },
    "gpt-image-2.6-flare": {
      text2img: null,
      img2img: null,
      transparent: null,
      honorsSize: null,
      note: "\u6E05\u5355\u91CC\u6709\uFF0C\u80FD\u529B\u672A\u9A8C\u8BC1"
    },
    "nano-banana-2.1": {
      text2img: null,
      img2img: true,
      transparent: null,
      honorsSize: false,
      note: "\u5FFD\u7565 size\uFF0C\u6309\u6A21\u578B\u81EA\u8EAB 2K \u51FA\u56FE"
    },
    "nano-banana-pro": {
      text2img: null,
      img2img: null,
      transparent: null,
      honorsSize: null,
      note: "\u6E05\u5355\u91CC\u6709\uFF0C\u80FD\u529B\u672A\u9A8C\u8BC1"
    }
  };
  var KNOWN_MODELS = Object.keys(MODEL_CAPS);
  var CAP_LABEL = {
    text2img: "\u6587\u751F\u56FE",
    img2img: "\u56FE\u751F\u56FE",
    transparent: "\u900F\u660E",
    honorsSize: "\u6309\u5C3A\u5BF8"
  };

  // ../../../../.config/openchamber/extensions/image-assets/源码/panel/main.js
  var host = connectHost();
  var KIND_LABEL = { cloud: "\u4E91\u7AEF API", local: "\u672C\u5730 ComfyUI" };
  var SLOT_LABEL = { t2i: "\u6587\u751F\u56FE", i2i: "\u56FE\u751F\u56FE", video: "\u89C6\u9891" };
  var SLOT_ORDER = ["t2i", "i2i", "video"];
  var diag = (msg) => {
    const el2 = document.getElementById("diag");
    if (el2) {
      el2.style.display = "block";
      el2.textContent += msg + "\n";
    }
  };
  window.addEventListener("error", (e) => diag("ERROR: " + (e.message || e.type) + (e.filename ? ` @${e.filename}:${e.lineno}` : "")));
  window.addEventListener("unhandledrejection", (e) => diag("REJECT: " + String(e.reason?.message || e.reason)));
  var state = {
    session: null,
    tab: "session",
    // session | all | create | settings
    assets: [],
    root: "",
    q: "",
    tag: "",
    selected: null,
    banner: "",
    config: null,
    // {settings, interfaces, defaultInterface, migration, root}
    configError: "",
    models: [],
    // 按当前接口的模型清单（云端 describeModels / 本地 object_info）
    modelsError: "",
    modelsManual: [],
    modelsLocal: null,
    testResult: null,
    saving: false,
    // 接口编辑草稿（设置页）
    ifaceDraft: null,
    // 正在编辑/新增的接口对象
    ifaceEditing: false,
    // 资产库路径编辑（设置页）
    rootDraft: "",
    // 输入框里的路径
    rootPending: "",
    // 校验通过、等待二次确认的路径
    rootWarn: "",
    // 校验通过但有提示（例如目标已有别的库）
    rootBusy: false,
    rootError: "",
    draft: {
      refs: [],
      // [{id, name}]
      prompt: "",
      size: "1024x1536",
      count: 1,
      model: "",
      interfaceId: "",
      // 创作页选中的接口（空 = 跟随默认接口）
      transparent: false
    },
    job: null,
    // {id, status, phase, pct, error, result}
    generating: false
  };
  var imgCache = /* @__PURE__ */ new Map();
  var refCache = /* @__PURE__ */ new Map();
  var loading = /* @__PURE__ */ new Set();
  var $ = (sel) => document.querySelector(sel);
  var $$ = (sel) => [...document.querySelectorAll(sel)];
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function fmtTime(ms) {
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return String(ms);
    }
  }
  function fmtSize(bytes) {
    if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + " MB";
    if (bytes > 1024) return Math.round(bytes / 1024) + " KB";
    return bytes + " B";
  }
  function fmtUsage(usage) {
    if (!usage || typeof usage !== "object") return "";
    const total = usage.total_tokens;
    const img = usage.output_tokens_details?.image_tokens ?? usage.completion_tokens_details?.image_tokens;
    const txt = usage.prompt_tokens_details?.text_tokens;
    const parts = [];
    if (Number.isFinite(total)) parts.push(`${total} tokens`);
    const detail = [];
    if (Number.isFinite(img)) detail.push(`\u56FE ${img}`);
    if (Number.isFinite(txt)) detail.push(`\u6587 ${txt}`);
    return parts.concat(detail.length ? [`\uFF08${detail.join(" + ")}\uFF09`] : []).join("");
  }
  async function svc(method, path, body) {
    const res = await host.serviceRequest({ method, path, ...body !== void 0 ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {} });
    let parsed = res.body;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        parsed = { error: parsed.slice(0, 200) };
      }
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(parsed?.error || `HTTP ${res.status}`);
    }
    return parsed;
  }
  function describeHostError(err) {
    if (err instanceof HostRequestError) {
      switch (err.code) {
        case "NO_SERVICE":
          return "\u6269\u5C55\u672C\u5730\u670D\u52A1\u672A\u542F\u52A8\u6216\u672A\u6279\u51C6 service \u6743\u9650\uFF08\u8BBE\u7F6E \u2192 \u6269\u5C55 \u2192 \u751F\u56FE\u8D44\u4EA7\uFF09";
        case "DISABLED":
          return "\u6269\u5C55\u5DF2\u88AB\u505C\u7528\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u91CC\u91CD\u65B0\u542F\u7528";
        case "SERVICE_FAILED":
          return "\u672C\u5730\u670D\u52A1\u542F\u52A8\u5931\u8D25";
        case "REQUEST_FAILED":
          return "\u672C\u5730\u670D\u52A1\u65E0\u54CD\u5E94";
        case "RESPONSE_TOO_LARGE":
          return "\u56FE\u7247\u8FC7\u5927\uFF0C\u65E0\u6CD5\u56DE\u4F20";
        case "HOST_TIMEOUT":
          return "\u5BBF\u4E3B\u65E0\u54CD\u5E94";
        default:
          return `\u670D\u52A1\u8C03\u7528\u5931\u8D25\uFF08${err.code}\uFF09`;
      }
    }
    return String(err?.message || err);
  }
  async function toast(kind, message) {
    try {
      await host.toast({ kind, message, dismiss: true });
    } catch {
    }
  }
  async function refresh() {
    try {
      const data = await svc("GET", "/assets");
      state.assets = data.assets || [];
      state.root = data.root || state.root;
      state.banner = "";
    } catch (err) {
      state.banner = describeHostError(err);
    }
    render();
  }
  async function loadConfig() {
    try {
      state.config = await svc("GET", "/config");
      state.configError = "";
      state.rootDraft = state.config.root || "";
      const s = state.config.settings || {};
      if (!state.draft.model) state.draft.model = activeInterface()?.defaultModel || "";
      if (!state.draft.size) state.draft.size = s.defaultSize || "1024x1536";
      if (!state.draft.count) state.draft.count = s.defaultCount || 1;
    } catch (err) {
      state.configError = describeHostError(err);
    }
  }
  function interfaces() {
    return Array.isArray(state.config?.interfaces) ? state.config.interfaces : [];
  }
  function defaultInterface() {
    const id = state.config?.defaultInterface || "";
    return interfaces().find((it) => it.id === id) || null;
  }
  function activeInterface() {
    const list = interfaces();
    const wanted = state.draft.interfaceId;
    if (wanted) {
      const hit = list.find((it) => it.id === wanted);
      if (hit) return hit;
    }
    const def = defaultInterface();
    if (def) return def;
    const enabled = list.filter((it) => it.enabled !== false);
    return enabled.length === 1 ? enabled[0] : null;
  }
  function interfaceLabel(it) {
    if (!it) return "\uFF08\u672A\u8BBE\u5B9A\u63A5\u53E3\uFF09";
    return `${it.name}\uFF08${KIND_LABEL[it.kind] || it.kind}\uFF09${it.isDefault ? " \u2605" : ""}`;
  }
  function rootSourceBadge(info) {
    const map = {
      default: ["\u9ED8\u8BA4", "cap"],
      custom: ["\u81EA\u5B9A\u4E49", "cap y"],
      env: ["\u73AF\u5883\u53D8\u91CF", "cap q"],
      explicit: ["\u4E34\u65F6\u6307\u5B9A", "cap q"]
    };
    const [label, cls] = map[info?.source] || map.default;
    return `<span class="${cls}" title="${esc(info?.locatorPath || "")}">${label}</span>`;
  }
  async function loadModels(interfaceId) {
    const wanted = interfaceId !== void 0 ? interfaceId : activeInterface()?.id || state.config?.defaultInterface || "";
    try {
      const qs = wanted ? `?interface=${encodeURIComponent(wanted)}` : "";
      const data = await svc("GET", `/models${qs}`);
      state.models = data.models || [];
      state.modelsManual = data.manual || [];
      state.modelsLocal = data.local || null;
      state.modelsError = data.ok ? "" : data.error || "";
      const iface = interfaces().find((it) => it.id === data.interfaceId);
      if (!state.draft.model) state.draft.model = iface?.defaultModel || data.defaultModel || "";
    } catch (err) {
      state.modelsError = describeHostError(err);
    }
  }
  async function pushAnnotate(id, patch) {
    try {
      const data = await svc("POST", `/assets/${id}/annotate`, patch);
      const i = state.assets.findIndex((a) => a.id === id);
      if (i >= 0) state.assets[i] = data.asset;
      state.banner = "";
      render();
      if (state.selected === id) renderDetail();
      await toast("success", "\u6807\u6CE8\u5DF2\u4FDD\u5B58");
    } catch (err) {
      await toast("error", "\u4FDD\u5B58\u5931\u8D25\uFF1A" + describeHostError(err));
    }
  }
  async function doDelete(id) {
    try {
      await svc("POST", `/assets/${id}/delete`);
      state.assets = state.assets.filter((a) => a.id !== id);
      if (state.selected === id) closeDetail();
      render();
      await toast("success", "\u5DF2\u5220\u9664");
    } catch (err) {
      await toast("error", "\u5220\u9664\u5931\u8D25\uFF1A" + describeHostError(err));
    }
  }
  var io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const id = e.target.dataset.id;
      if (id && !imgCache.has(id) && !loading.has(id)) void loadImg(id);
    }
  }, { rootMargin: "200px" });
  async function loadImg(id) {
    loading.add(id);
    try {
      const data = await svc("GET", `/assets/${id}/file`);
      const url = `data:${data.mime};base64,${data.base64}`;
      imgCache.set(id, url);
      if (imgCache.size > 80) imgCache.delete(imgCache.keys().next().value);
      document.querySelectorAll(`img[data-id="${CSS.escape(id)}"]`).forEach((img) => {
        img.src = url;
      });
      if (state.selected === id) {
        const big = document.querySelector("#detail img.big");
        if (big) big.src = url;
      }
    } catch (err) {
      const cap = document.querySelector(`figcaption[data-err="${CSS.escape(id)}"]`);
      if (cap) cap.textContent = "\u53D6\u56FE\u5931\u8D25\uFF1A" + describeHostError(err);
    } finally {
      loading.delete(id);
    }
  }
  async function loadRefImage(rel) {
    if (refCache.has(rel)) return refCache.get(rel);
    try {
      const data = await svc("GET", `/library-file?path=${encodeURIComponent(rel)}`);
      const url = `data:${data.mime};base64,${data.base64}`;
      refCache.set(rel, url);
      document.querySelectorAll(`img[data-ref="${CSS.escape(rel)}"]`).forEach((img) => {
        img.src = url;
      });
      return url;
    } catch {
      return "";
    }
  }
  function imgSrc(id) {
    return imgCache.get(id) || "";
  }
  async function saveDraft() {
    try {
      await host.storage.set("draft", JSON.parse(JSON.stringify(state.draft)));
    } catch {
    }
  }
  async function loadDraft() {
    try {
      const d = await host.storage.get("draft");
      if (d && typeof d === "object") {
        state.draft = {
          refs: Array.isArray(d.refs) ? d.refs.filter((r) => r && typeof r.id === "string").slice(0, MAX_REFERENCES) : [],
          prompt: typeof d.prompt === "string" ? d.prompt : "",
          size: typeof d.size === "string" ? d.size : "1024x1536",
          count: Number(d.count) >= 1 && Number(d.count) <= MAX_COUNT ? Number(d.count) : 1,
          model: typeof d.model === "string" ? d.model : "",
          interfaceId: typeof d.interfaceId === "string" ? d.interfaceId : "",
          transparent: d.transparent === true
        };
      }
    } catch {
    }
  }
  function visibleAssets() {
    let list = state.assets;
    if (state.tab === "session") {
      const sid = state.session?.id || null;
      list = sid ? list.filter((a) => a.sessionId === sid) : [];
    }
    if (state.tag) list = list.filter((a) => (a.tags || []).includes(state.tag));
    if (state.q) {
      const needle = state.q.toLowerCase();
      list = list.filter((a) => [a.prompt, a.note, a.sessionTitle, a.file, ...a.tags || []].some((s) => typeof s === "string" && s.toLowerCase().includes(needle)));
    }
    return list;
  }
  function render() {
    $$(".tab").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === state.tab)));
    const banner = $("#banner");
    if (state.banner) {
      banner.hidden = false;
      $("#banner-text").textContent = state.banner;
    } else {
      banner.hidden = true;
    }
    const isList = state.tab === "session" || state.tab === "all";
    $("#toolbar").hidden = !isList;
    if (!isList) {
      $("#count").textContent = "";
      if (state.tab === "create") renderCreate();
      else renderSettings();
      return;
    }
    const list = visibleAssets();
    $("#count").textContent = state.tab === "session" ? `${list.length} \u5F20` : `${list.length} / ${state.assets.length} \u5F20`;
    const tags = [...new Set(state.assets.flatMap((a) => a.tags || []))].sort((a, b) => a.localeCompare(b, "zh"));
    $("#tagrow").innerHTML = tags.length ? tags.map((t) => `<button class="tagchip" type="button" data-tag="${esc(t)}" aria-pressed="${state.tag === t}">${esc(t)}</button>`).join("") : "";
    const view = $("#view");
    if (state.tab === "session" && !state.session) {
      view.innerHTML = '<div class="empty">\u5F53\u524D\u6CA1\u6709\u6253\u5F00\u7684\u4F1A\u8BDD</div>';
      return;
    }
    if (!list.length) {
      view.innerHTML = `<div class="empty">${state.banner ? "\u6682\u65F6\u65E0\u6CD5\u5217\u51FA\u8D44\u4EA7" : state.q || state.tag ? "\u6CA1\u6709\u5339\u914D\u7684\u8D44\u4EA7" : state.tab === "session" ? "\u672C\u6B21\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u751F\u6210\u56FE\u7247" : "\u8D44\u4EA7\u5E93\u8FD8\u662F\u7A7A\u7684"}</div>`;
      return;
    }
    view.innerHTML = `<div class="grid">${list.map((a) => {
      const ratio = a.width && a.height ? `aspect-ratio:${a.width}/${a.height}` : "aspect-ratio:3/4";
      const src = imgSrc(a.id);
      const refs = Array.isArray(a.references) ? a.references.length : Array.isArray(a.referenceIds) ? a.referenceIds.length : 0;
      return `<figure class="tile" data-id="${esc(a.id)}" style="margin:0">
      ${src ? `<img data-id="${esc(a.id)}" src="${src}" alt="${esc(a.prompt || "").slice(0, 60)}" />` : `<span class="ph" style="${ratio}"></span>
           <img data-id="${esc(a.id)}" src="" alt="" hidden />`}
      <div class="marks">${refs ? `<span class="mark">\u{1F5BC}${refs}</span>` : ""}</div>
      ${a.format === "png" && a.alpha ? '<span class="alpha" title="PNG\uFF08\u53EF\u80FD\u542B\u900F\u660E\u901A\u9053\uFF09"></span>' : ""}
      <figcaption data-err="${esc(a.id)}">${esc(fmtTime(a.createdAt))}${a.tags?.length ? " \xB7 " + esc(a.tags[0]) : ""}</figcaption>
    </figure>`;
    }).join("")}</div>`;
    view.querySelectorAll("figure.tile").forEach((fig) => {
      io.observe(fig);
      fig.addEventListener("click", () => openDetail(fig.dataset.id));
    });
    view.querySelectorAll("img[data-id]").forEach((img) => {
      const url = imgCache.get(img.dataset.id);
      if (url) {
        img.src = url;
        img.hidden = false;
      }
    });
  }
  function refThumb(ref) {
    const src = imgSrc(ref.id);
    return `<button class="slot" type="button" data-ref-id="${esc(ref.id)}" title="${esc(ref.name || "")}">
    ${src ? `<img src="${src}" alt="" />` : ""}
    <span class="x" data-remove-ref="${esc(ref.id)}">\xD7</span>
  </button>`;
  }
  function renderCreate() {
    const d = state.draft;
    const iface = activeInterface();
    const isLocal = iface?.kind === "local";
    const presets = SIZE_PRESETS.map((p) => `<button type="button" data-size="${esc(p.size)}" aria-pressed="${d.size === p.size}">${esc(p.label)}</button>`).join("");
    const ifaceOptions = interfaces().length ? [
      `<option value="">\u8DDF\u968F\u9ED8\u8BA4\u63A5\u53E3${defaultInterface() ? `\uFF08${esc(defaultInterface().name)}\uFF09` : "\uFF08\u672A\u8BBE\u5B9A\uFF09"}</option>`,
      ...interfaces().map((it) => `<option value="${esc(it.id)}" ${d.interfaceId === it.id ? "selected" : ""} ${it.enabled === false ? "disabled" : ""}>${esc(interfaceLabel(it))}</option>`)
    ].join("") : '<option value="">\uFF08\u8FD8\u6CA1\u6709\u63A5\u53E3\uFF0C\u8BF7\u5230\u8BBE\u7F6E\u9875\u6DFB\u52A0\uFF09</option>';
    const modelList = isLocal ? (iface?.defaultModel ? [iface.defaultModel, ...state.modelsManual || []] : state.modelsManual || []).filter((v2, i, a) => v2 && a.indexOf(v2) === i) : state.models.length ? state.models.map((m) => m.id) : state.modelsManual || [];
    const currentModel = d.model || iface?.defaultModel || "";
    const modelOptions = modelList.length ? modelList.map((id) => `<option value="${esc(id)}" ${id === currentModel ? "selected" : ""}>${esc(id)}</option>`).join("") : `<option value="${esc(currentModel)}">${esc(currentModel || (isLocal ? "\uFF08\u672C\u5730\u6A21\u578B\u7531\u5DE5\u4F5C\u6D41\u6A21\u677F\u51B3\u5B9A\uFF09" : "\uFF08\u5148\u914D\u7F6E\u6A21\u578B\uFF09"))}</option>`;
    const caps = state.models.find((m) => m.id === currentModel);
    const job = state.job;
    const results = job?.result?.assets || [];
    $("#view").innerHTML = `<div class="form">
    <div class="group">
      <div class="ghead"><span class="gname">\u63A5\u53E3</span>
        <span class="hint">${iface ? esc(KIND_LABEL[iface.kind] || iface.kind) : "\u672A\u8BBE\u5B9A"}</span></div>
      <select class="input" id="c-iface">${ifaceOptions}</select>
      ${iface ? `<div class="hint">${esc(iface.baseUrl)}${isLocal ? ` \xB7 \u5DE5\u4F5C\u6D41\uFF1A${esc(SLOT_LABEL[d.refs.length ? "i2i" : "t2i"])}` : ""}${iface.key?.hasKey || isLocal ? "" : " \xB7 \u5BC6\u94A5\u672A\u914D\u7F6E"}</div>` : ""}
      ${isLocal ? '<div class="hint">\u672C\u5730 ComfyUI\uFF1AMOSS \u56FE\u751F\u56FE\u662F\u628A\u53C2\u8003\u56FE\u4EA4\u7ED9\u63D0\u793A\u8BCD\u6269\u5199\u540E\u91CD\u65B0\u751F\u6210\uFF0C\u4E0D\u662F\u50CF\u7D20\u7EA7\u91CD\u7ED8\u3002</div>' : ""}
    </div>

    <div class="group">
      <div class="ghead"><span class="gname">\u53C2\u8003\u56FE</span><span class="hint">${d.refs.length}/${MAX_REFERENCES}</span></div>
      <div class="refslots">
        ${d.refs.map(refThumb).join("")}
        ${d.refs.length < MAX_REFERENCES ? '<button class="slot add" type="button" data-act="pick-ref">+</button>' : ""}
      </div>
      <div class="hint">\u4ECE\u8D44\u4EA7\u5E93\u9009\u56FE\u5F15\u7528\uFF1B\u4E0D\u9009\u5C31\u662F\u6587\u751F\u56FE\u3002</div>
    </div>

    <div class="group">
      <div class="ghead"><span class="gname">\u63D0\u793A\u8BCD</span></div>
      <textarea class="textarea" id="c-prompt" rows="5" placeholder="\u5199\u6E05\u300C\u4FDD\u7559\u4EC0\u4E48\u3001\u53EA\u6539\u4EC0\u4E48\u300D\u3002\u4F8B\uFF1A\u4EBA\u7269\u52A8\u4F5C\u4E0E\u5668\u68B0\u4E0D\u53D8\uFF0C\u80CC\u666F\u6362\u6210\u6444\u5F71\u68DA\u6D45\u7070\u65E0\u7F1D\u7EB8\uFF0C\u67D4\u5149\u7BB1\u4E3B\u5149\u3002">${esc(d.prompt)}</textarea>
    </div>

    <div class="group">
      <div class="ghead"><span class="gname">\u753B\u5E45</span><span class="hint">${isLocal ? "\u672C\u5730\u6309\u6700\u63A5\u8FD1\u7684\u753B\u5E45\u6BD4 + \u603B\u50CF\u7D20\u6362\u7B97" : "\u63A5\u53E3\u4E0D\u4E25\u683C\u6821\u9A8C\uFF0C\u6A21\u578B\u53EF\u80FD\u81EA\u884C\u8C03\u6574"}</span></div>
      <div class="seg">${presets}</div>
      <input class="input" id="c-size" value="${esc(d.size)}" placeholder="\u6216\u81EA\u5B9A\u4E49 1024x1536" />
    </div>

    <div class="group">
      <div class="line"><span class="k">\u5F20\u6570</span>
        <div class="v seg">${[1, 2, 3, 4].map((n) => `<button type="button" data-count="${n}" aria-pressed="${d.count === n}" ${isLocal ? "disabled" : ""}>${n}</button>`).join("")}</div>
      </div>
      <div class="line"><span class="k">\u6A21\u578B</span><div class="v"><select class="input" id="c-model">${modelOptions}</select></div></div>
      ${state.modelsError ? `<div class="hint">\u6A21\u578B\u6E05\u5355\uFF1A${esc(state.modelsError)}</div>` : ""}
      ${caps ? `<div class="caps">${capBadges(caps)}</div><div class="hint">${esc(caps.note || "")}</div>` : ""}
      <div class="line"><span class="k">\u900F\u660E\u5E95</span><div class="v hint">${d.refs.length ? "\u53C2\u8003\u56FE\u6A21\u5F0F\u4E0B\u4E0D\u53EF\u7528\uFF08\u672A\u9A8C\u8BC1\uFF09" : isLocal ? "\u672C\u5730\u6A21\u677F\u672A\u9A8C\u8BC1\u900F\u660E\u8F93\u51FA" : "\u4EC5\u5728\u4E91\u7AEF\u6587\u751F\u56FE\u9A8C\u8BC1\u8FC7\uFF1BPNG"}</div>
        <button class="switch" type="button" data-act="toggle-transparent" aria-pressed="${d.transparent && !d.refs.length && !isLocal}" ${d.refs.length || isLocal ? "disabled" : ""}><i></i></button>
      </div>
    </div>

    <button class="btn primary" type="button" data-act="generate" ${state.generating || !iface ? "disabled" : ""}>
      ${state.generating ? "\u751F\u6210\u4E2D\u2026" : isLocal ? "\u672C\u5730\u751F\u6210" : "\u751F\u6210"}
    </button>
    <div class="hint" style="text-align:center">\u5355\u6B21\u8BF7\u6C42\uFF0C\u5931\u8D25\u4E0D\u81EA\u52A8\u91CD\u8BD5\uFF1B${isLocal ? "\u672C\u5730\u7EA6 1\u20133 \u5206\u949F\uFF08\u770B\u663E\u5B58\uFF09" : "\u4E91\u7AEF\u4E00\u6B21\u7EA6 25\u201340 \u79D2"}\u3002</div>

    ${state.generating || job ? `<div class="group">
      <div class="line"><span class="k">${job?.status === "error" ? "\u5931\u8D25" : job?.status === "done" ? "\u5B8C\u6210" : "\u8FDB\u5EA6"}</span>
        <div class="v"><div class="prog"><i style="width:${Number(job?.pct) || 0}%"></i></div></div>
      </div>
      <div class="hint">${esc(job?.phase || "")}</div>
      ${job?.error ? `<div class="bad" style="white-space:pre-wrap">${esc(job.error)}</div>` : ""}
      ${job?.result?.warnings?.length ? `<div class="hint">\u63D0\u793A\uFF1A${esc(job.result.warnings.join("\uFF1B"))}</div>` : ""}
      ${results.length ? `<div class="result">${results.map((a) => `<button type="button" data-open-asset="${esc(a.id)}"><img data-id="${esc(a.id)}" src="${imgSrc(a.id)}" alt="" /></button>`).join("")}</div>` : ""}
    </div>` : ""}
  </div>`;
    const view = $("#view");
    view.querySelector("#c-prompt")?.addEventListener("input", (e) => {
      state.draft.prompt = e.target.value;
      void saveDraft();
    });
    view.querySelector("#c-size")?.addEventListener("change", (e) => {
      state.draft.size = e.target.value.trim().toLowerCase();
      void saveDraft();
    });
    view.querySelector("#c-iface")?.addEventListener("change", (e) => {
      state.draft.interfaceId = e.target.value;
      state.draft.model = "";
      void saveDraft();
      void loadModels(state.draft.interfaceId).then(() => renderCreate());
    });
    view.querySelector("#c-model")?.addEventListener("change", (e) => {
      state.draft.model = e.target.value;
      void saveDraft();
      renderCreate();
    });
    view.querySelectorAll("[data-size]").forEach((b) => b.addEventListener("click", () => {
      state.draft.size = b.dataset.size;
      void saveDraft();
      renderCreate();
    }));
    view.querySelectorAll("[data-count]").forEach((b) => b.addEventListener("click", () => {
      if (isLocal) return;
      state.draft.count = Number(b.dataset.count);
      void saveDraft();
      renderCreate();
    }));
    view.querySelector('[data-act="toggle-transparent"]')?.addEventListener("click", (e) => {
      if (state.draft.refs.length || isLocal) return;
      state.draft.transparent = !state.draft.transparent;
      e.currentTarget.setAttribute("aria-pressed", String(state.draft.transparent));
      void saveDraft();
    });
    view.querySelector('[data-act="generate"]')?.addEventListener("click", () => void startGenerate());
    view.querySelectorAll('[data-act="pick-ref"]').forEach((b) => b.addEventListener("click", openPicker));
    view.querySelectorAll("[data-remove-ref]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      state.draft.refs = state.draft.refs.filter((r) => r.id !== b.dataset.removeRef);
      void saveDraft();
      renderCreate();
    }));
    view.querySelectorAll("[data-open-asset]").forEach((b) => b.addEventListener("click", () => openDetail(b.dataset.openAsset)));
    view.querySelectorAll("img[data-id]").forEach((img) => {
      const url = imgCache.get(img.dataset.id);
      if (url) img.src = url;
    });
  }
  function capBadges(m) {
    return Object.entries(CAP_LABEL).map(([k, label]) => {
      const v2 = m[k];
      const cls = v2 === true ? "cap y" : v2 === false ? "cap q" : "cap";
      return `<span class="${cls}">${esc(label)}${v2 === false ? " \u2715" : v2 === true ? "" : " ?"}</span>`;
    }).join("");
  }
  function blankInterface(kind = "cloud") {
    return {
      id: "",
      name: kind === "local" ? "\u672C\u5730 ComfyUI" : "\u65B0\u7684\u4E91\u7AEF\u63A5\u53E3",
      kind,
      baseUrl: kind === "local" ? "http://127.0.0.1:8188" : "",
      defaultModel: "",
      models: [],
      enabled: true,
      comfy: {
        timeoutMs: 9e5,
        pollMs: 1500,
        workflows: { t2i: "", i2i: "", video: "" },
        negative: "",
        steps: 25,
        cfg: 2.5,
        sampler: "",
        scheduler: "",
        clip: "",
        vae: "",
        lora: ""
      }
    };
  }
  function ifaceCard(it, draft) {
    const k = it.key || {};
    const isLocal = it.kind === "local";
    return `<div class="group" data-iface="${esc(it.id)}">
    <div class="ghead">
      <span class="gname">${esc(it.name)}${it.isDefault ? ' <span class="cap y">\u9ED8\u8BA4</span>' : ""}
        <span class="cap">${esc(KIND_LABEL[it.kind] || it.kind)}</span>
        ${it.enabled === false ? '<span class="cap q">\u5DF2\u505C\u7528</span>' : ""}</span>
      <span class="hint">${esc(it.id)}</span>
    </div>
    <div class="hint" style="font-family:var(--font-mono);font-size:10.5px">${esc(it.baseUrl || "(\u672A\u586B\u5730\u5740)")}</div>
    <div class="hint">${isLocal ? "\u672C\u5730\u5DE5\u4F5C\u6D41" : `\u9ED8\u8BA4\u6A21\u578B\uFF1A${esc(it.defaultModel || "(\u672A\u8BBE)")}`}${isLocal ? ` \xB7 ${(it.templates || []).map((t) => `${esc(t.label)} ${t.exists ? "\u2713" : "\u2717"}`).join(" \xB7 ")}` : ""}</div>
    <div class="hint">\u5BC6\u94A5\uFF1A${isLocal ? k.hasKey ? `\u53EF\u9009\u5BC6\u94A5 ${esc(k.masked)}` : "\u4E0D\u9700\u8981\uFF08\u672C\u5730\u63A5\u53E3\uFF09" : k.hasKey ? `${esc(k.masked)}\uFF08${esc(k.sourceLabel || "")}\uFF09` : `\u672A\u914D\u7F6E\uFF08\u53EF\u7528\u73AF\u5883\u53D8\u91CF ${esc(k.envName || "")}\uFF09`}</div>
    <div class="row">
      <button class="btn" type="button" data-act="iface-edit" data-id="${esc(it.id)}">\u7F16\u8F91</button>
      <button class="btn" type="button" data-act="iface-test" data-id="${esc(it.id)}">\u6D4B\u8BD5\u8FDE\u63A5</button>
      ${it.isDefault ? `<button class="btn" type="button" disabled>\u5DF2\u662F\u9ED8\u8BA4</button>` : `<button class="btn primary" type="button" data-act="iface-default" data-id="${esc(it.id)}">\u8BBE\u4E3A\u9ED8\u8BA4\u63A5\u53E3</button>`}
      <button class="btn danger" type="button" data-act="iface-del" data-id="${esc(it.id)}">\u5220\u9664</button>
    </div>
    ${draft ? renderIfaceEditor(draft) : ""}
  </div>`;
  }
  function renderIfaceEditor(it) {
    const isLocal = it.kind === "local";
    const comfy = it.comfy || blankInterface("local").comfy;
    const manualModels = (it.models || []).join("\n");
    const tpl = Array.isArray(it.templates) && it.templates.length ? it.templates : SLOT_ORDER.map((slot) => ({
      slot,
      label: SLOT_LABEL[slot],
      path: "",
      source: "none",
      exists: false,
      nodes: 0,
      error: "\u672A\u914D\u7F6E"
    }));
    const local = state.modelsLocal;
    return `<div class="iface-edit" data-edit-for="${esc(it.id)}">
    <div class="line"><span class="k">\u7C7B\u578B</span><div class="v seg">
      ${["cloud", "local"].map((k) => `<button type="button" data-edit-kind="${k}" aria-pressed="${it.kind === k}">${esc(KIND_LABEL[k])}</button>`).join("")}
    </div></div>
    <div class="line"><span class="k">\u540D\u79F0</span><div class="v"><input class="input" id="e-name" value="${esc(it.name)}" /></div></div>
    <div class="line"><span class="k">\u5730\u5740</span><div class="v"><input class="input" id="e-baseurl" value="${esc(it.baseUrl)}" placeholder="${isLocal ? "http://127.0.0.1:8188" : "https://api.example.com/v1"}" /></div></div>
    <div class="line"><span class="k">\u9ED8\u8BA4\u6A21\u578B</span><div class="v"><input class="input" id="e-model" value="${esc(it.defaultModel)}" placeholder="${isLocal ? "moss_image_sft_int8_convrot.safetensors" : "gpt-image-2.6-sunburst"}" /></div></div>
    <div class="ghead"><span class="gname">\u6A21\u578B\u6E05\u5355\uFF08\u624B\u52A8\u586B\u5199\uFF0C\u4E00\u884C\u4E00\u4E2A\uFF09</span>
      <span class="hint">\u62C9\u53D6\u5230\u7684\u6A21\u578B\u53EA\u4F5C\u8865\u5145\uFF0C\u4E0D\u8986\u76D6\u624B\u586B</span></div>
    <textarea class="textarea" id="e-models" rows="3" placeholder="\u4E00\u884C\u4E00\u4E2A\u6A21\u578B id">${esc(manualModels)}</textarea>
    ${isLocal ? `
      <div class="ghead"><span class="gname">ComfyUI \u5DE5\u4F5C\u6D41</span>
        <span class="hint">\u7559\u7A7A = \u7528\u6269\u5C55\u81EA\u5E26\u7684 \u5DE5\u4F5C\u6D41/ \u6A21\u677F</span></div>
      ${tpl.map((t) => `<div class="line"><span class="k">${esc(t.label)}</span><div class="v">
        <input class="input" id="e-wf-${esc(t.slot)}" value="${esc(it.comfy?.workflows?.[t.slot] || "")}" placeholder="${esc(t.exists ? t.path : "\uFF08\u672A\u914D\u7F6E\uFF09")}" />
        <div class="hint">${t.exists ? `\u5F53\u524D\uFF1A${esc(t.path)}\uFF08${t.nodes} \u4E2A\u8282\u70B9\uFF09` : t.error ? esc(t.error) : ""}</div>
      </div></div>`).join("")}
      <div class="line"><span class="k">\u8D85\u65F6(s)</span><div class="v"><input class="input" id="e-timeout" value="${esc(Math.round((comfy.timeoutMs || 9e5) / 1e3))}" /></div></div>
      <div class="line"><span class="k">\u6B65\u6570 / CFG</span><div class="v" style="display:flex;gap:6px">
        <input class="input" id="e-steps" value="${esc(comfy.steps ?? 25)}" />
        <input class="input" id="e-cfg" value="${esc(comfy.cfg ?? 2.5)}" />
      </div></div>
      <div class="line"><span class="k">\u91C7\u6837\u5668 / \u8C03\u5EA6\u5668</span><div class="v" style="display:flex;gap:6px">
        <input class="input" id="e-sampler" value="${esc(comfy.sampler || "")}" placeholder="er_sde\uFF08\u7559\u7A7A\u7528\u6A21\u677F\u503C\uFF09" />
        <input class="input" id="e-scheduler" value="${esc(comfy.scheduler || "")}" placeholder="simple\uFF08\u7559\u7A7A\u7528\u6A21\u677F\u503C\uFF09" />
      </div></div>
      <div class="line"><span class="k">\u53CD\u5411\u63D0\u793A\u8BCD</span><div class="v"><input class="input" id="e-negative" value="${esc(comfy.negative || "")}" placeholder="\u7559\u7A7A\u7528\u6A21\u677F\u503C" /></div></div>
      ${local ? `<div class="hint">ComfyUI \u91CC\u7684\u6269\u6563\u6A21\u578B\uFF1A${esc(local.unets.slice(0, 4).join("\u3001") || "(\u672A\u62C9\u53D6)")}</div>` : ""}
    ` : ""}
    <div class="line"><span class="k">\u542F\u7528</span><div class="v hint">\u505C\u7528\u540E\u4E0D\u53C2\u4E0E\u751F\u6210\uFF08\u4ECD\u4FDD\u7559\u914D\u7F6E\uFF09</div>
      <button class="switch" type="button" data-edit-toggle-enabled aria-pressed="${it.enabled !== false}"><i></i></button>
    </div>
    <div class="row">
      <button class="btn primary" type="button" data-act="iface-save" data-id="${esc(it.id)}">\u4FDD\u5B58\u63A5\u53E3</button>
      <button class="btn" type="button" data-act="iface-cancel">\u53D6\u6D88</button>
      ${isLocal ? "" : '<button class="btn" type="button" data-act="iface-pull" data-id="' + esc(it.id) + '">\u62C9\u53D6\u6A21\u578B\u6E05\u5355</button>'}
    </div>
    <div class="hint">${isLocal ? "\u4FDD\u5B58\u540E\u53EF\u7528\u4E0B\u65B9\u7684\u300C\u6D4B\u8BD5\u8FDE\u63A5\u300D\u786E\u8BA4 ComfyUI \u5728\u7EBF\u3002" : "\u4FDD\u5B58\u540E\u53EF\u6D4B\u8BD5\u8FDE\u63A5\uFF1B\u6A21\u578B\u6E05\u5355\u62C9\u53D6\u6210\u529F\u53EA\u4F1A\u8865\u5145\uFF0C\u4E0D\u4F1A\u8986\u76D6\u624B\u586B\u9879\u3002"}</div>
  </div>`;
  }
  function renderSettings() {
    const cfg = state.config;
    const s = cfg?.settings || {};
    const list = interfaces();
    const migration = cfg?.migration;
    const rootInfo = cfg?.rootInfo || { source: "default", locked: false, custom: "", envRoot: "", defaultRoot: "", pendingMove: null };
    const editingId = state.ifaceEditing ? state.ifaceDraft?.id || "__new__" : "";
    const newDraft = state.ifaceEditing && !(state.ifaceDraft?.id || "") ? state.ifaceDraft : null;
    const cards = list.map((it) => ifaceCard(
      it,
      state.ifaceEditing && editingId === it.id ? state.ifaceDraft : null
    )).join("");
    const newEditor = newDraft ? renderIfaceEditor(newDraft) : "";
    $("#view").innerHTML = `<div class="form">
    ${state.configError ? `<div class="bad">${esc(state.configError)}</div>` : ""}
    ${migration?.warnings?.length ? `<div class="group">
      <div class="ghead"><span class="gname">\u914D\u7F6E\u8FC1\u79FB</span></div>
      <div class="hint">${esc(migration.ran ? "\u5DF2\u628A\u65E7\u7248\u5355\u63A5\u53E3\u914D\u7F6E\u8FC1\u79FB\u6210\u4E00\u6761\u300C\u65E7\u914D\u7F6E\u300D\u63A5\u53E3\uFF08\u672A\u8BBE\u9ED8\u8BA4\uFF09\u3002" : "")}</div>
      ${migration.warnings.map((w) => `<div class="hint">\xB7 ${esc(w)}</div>`).join("")}
      ${migration.backups?.settings ? `<div class="hint mono">\u5907\u4EFD\uFF1A${esc(migration.backups.settings)}</div>` : ""}
      ${migration.backups?.key ? `<div class="hint mono">\u5907\u4EFD\uFF1A${esc(migration.backups.key)}</div>` : ""}
    </div>` : ""}

    <div class="group">
      <div class="ghead"><span class="gname">\u63A5\u53E3</span>
        <span class="hint">\u9ED8\u8BA4\u63A5\u53E3\uFF1A${esc(defaultInterface()?.name || "\u672A\u8BBE\u5B9A\uFF08\u5FC5\u987B\u624B\u52A8\u6307\u5B9A\uFF09")}</span></div>
      ${cards || '<div class="empty">\u8FD8\u6CA1\u6709\u63A5\u53E3\u3002\u5148\u6DFB\u52A0\u4E00\u4E2A\uFF1A\u4E91\u7AEF\u586B API \u5730\u5740\u4E0E\u5BC6\u94A5\uFF1B\u672C\u5730\u586B ComfyUI \u5730\u5740\u3002</div>'}
      ${newEditor}
      <div class="row">
        <button class="btn" type="button" data-act="iface-new" data-kind="cloud">\uFF0B \u4E91\u7AEF\u63A5\u53E3</button>
        <button class="btn" type="button" data-act="iface-new" data-kind="local">\uFF0B \u672C\u5730 ComfyUI</button>
      </div>
      <div class="hint">\u540C\u4E00\u65F6\u95F4\u53EA\u6709\u4E00\u4E2A\u9ED8\u8BA4\u63A5\u53E3\uFF1B\u521B\u4F5C\u9875\u4E0E\u5BF9\u8BDD\u5DE5\u5177\u9ED8\u8BA4\u8D70\u5B83\uFF0C\u9700\u8981\u65F6\u53EF\u5728\u521B\u4F5C\u9875\u4E34\u65F6\u5207\u6362\u3002</div>
    </div>

    <div class="group">
      <div class="ghead"><span class="gname">\u9ED8\u8BA4\u503C</span></div>
      <div class="line"><span class="k">\u753B\u5E45</span><div class="v seg">
        ${SIZE_PRESETS.map((p) => `<button type="button" data-default-size="${esc(p.size)}" aria-pressed="${s.defaultSize === p.size}">${esc(p.label)}</button>`).join("")}
      </div></div>
      <div class="line"><span class="k">\u5F20\u6570</span><div class="v seg">
        ${[1, 2, 3, 4].map((n) => `<button type="button" data-default-count="${n}" aria-pressed="${Number(s.defaultCount) === n}">${n}</button>`).join("")}
      </div></div>
      <div class="line"><span class="k">\u8D85\u65F6(s)</span><div class="v"><input class="input" id="s-timeout" value="${esc(Math.round((s.timeoutMs || 3e5) / 1e3))}" /></div></div>
      <div class="hint">\u8D85\u65F6\u662F\u4E91\u7AEF\u63A5\u53E3\u7684\u4E0A\u9650\uFF1B\u672C\u5730 ComfyUI \u7528\u63A5\u53E3\u81EA\u5DF1\u7684\u8D85\u65F6\uFF08\u9ED8\u8BA4 900s\uFF09\u3002</div>
    </div>

    <div class="group">
      <div class="ghead"><span class="gname">\u6570\u636E</span></div>
      <div class="line"><span class="k">\u5B58\u653E\u4F4D\u7F6E</span><div class="v">
        <div class="rootline">
          <input class="input mono" id="s-root" value="${esc(state.rootDraft || cfg?.root || state.root || "")}" spellcheck="false" ${rootInfo.locked ? "disabled" : ""} />
          ${rootSourceBadge(rootInfo)}
        </div>
        <div class="row">
          <button class="btn primary" type="button" data-act="root-check" ${rootInfo.locked || state.rootBusy ? "disabled" : ""}>\u4FDD\u5B58\u8DEF\u5F84</button>
          <button class="btn" type="button" data-act="root-default" ${rootInfo.locked || state.rootBusy ? "disabled" : ""}>\u6062\u590D\u9ED8\u8BA4</button>
        </div>
      </div></div>
      ${state.rootError ? `<div class="bad">${esc(state.rootError)}</div>` : ""}
      ${state.rootPending ? `<div class="group warnbox">
        <div class="ghead"><span class="gname">\u786E\u8BA4\u5207\u6362</span></div>
        <div class="hint">\u65B0\u4F4D\u7F6E\uFF1A<span class="mono">${esc(state.rootPending)}</span></div>
        ${state.rootWarn ? `<div class="cap q">${esc(state.rootWarn)}</div>` : ""}
        <div class="hint">\u300C\u6574\u5E93\u642C\u8FC1\u300D\u628A\u56FE\u7247\u3001\u7D22\u5F15\u3001\u63A5\u53E3\u914D\u7F6E\u4E0E\u5BC6\u94A5\u4E00\u8D77\u642C\u8FC7\u53BB\uFF0C\u65B0\u4F4D\u7F6E\u7ACB\u523B\u53EF\u7528\uFF0C\u6E90\u5E93\u6539\u540D\u4E3A <span class="mono">&lt;\u65E7\u8DEF\u5F84&gt;.\u5F52\u6863-&lt;\u65F6\u95F4&gt;</span>\uFF08\u4E0D\u5220\u9664\uFF09\u3002</div>
        <div class="hint">\u300C\u53EA\u5207\u6362\u300D\u4E0D\u52A8\u65E7\u5E93\uFF1A\u65B0\u4F4D\u7F6E\u662F\u7A7A\u7684\uFF0C\u63A5\u53E3\u4E0E\u5BC6\u94A5\u9700\u8981\u91CD\u65B0\u914D\u7F6E\u3002</div>
        <div class="row">
          <button class="btn primary" type="button" data-act="root-move" ${state.rootBusy ? "disabled" : ""}>\u6574\u5E93\u642C\u8FC1\u8FC7\u53BB</button>
          <button class="btn" type="button" data-act="root-switch" ${state.rootBusy ? "disabled" : ""}>\u53EA\u5207\u6362</button>
          <button class="btn" type="button" data-act="root-cancel" ${state.rootBusy ? "disabled" : ""}>\u53D6\u6D88</button>
        </div>
      </div>` : ""}
      ${rootInfo.pendingMove ? `<div class="group warnbox">
        <div class="ghead"><span class="gname">\u4E0A\u6B21\u642C\u8FC1\u672A\u5B8C\u6210</span></div>
        <div class="hint">\u6E90\uFF1A<span class="mono">${esc(rootInfo.pendingMove.from)}</span></div>
        <div class="hint">\u76EE\u6807\uFF1A<span class="mono">${esc(rootInfo.pendingMove.to)}</span></div>
        <div class="row"><button class="btn" type="button" data-act="root-resume" ${state.rootBusy ? "disabled" : ""}>\u7EE7\u7EED\u642C\u8FC1</button></div>
      </div>` : ""}
      <dl class="meta">
        <dt>\u914D\u7F6E</dt><dd class="mono">${esc((cfg?.root || state.root || "") + "\\\u914D\u7F6E\\settings.json")}</dd>
        <dt>\u5BC6\u94A5</dt><dd class="mono">${esc((cfg?.root || state.root || "") + "\\\u914D\u7F6E\\\u5BC6\u94A5\\<\u63A5\u53E3id>.dat")}</dd>
        <dt>\u8D44\u4EA7</dt><dd>${state.assets.length} \u5F20</dd>
      </dl>
      <div class="hint">\u6CA1\u7279\u522B\u6307\u5B9A\u65F6\u4E00\u5F8B\u5B58\u5230\u4E0A\u9762\u8FD9\u4E2A\u81EA\u5B9A\u4E49\u8DEF\u5F84\uFF1B\u73AF\u5883\u53D8\u91CF IMAGE_ASSETS_ROOT \u4F18\u5148\u4E8E\u9762\u677F\u8BBE\u7F6E\uFF0C\u51FA\u5382\u9ED8\u8BA4\u662F <span class="mono">${esc(rootInfo.defaultRoot || "")}</span>\u3002</div>
      <div class="hint">\u5BC6\u94A5\u7528 Windows DPAPI \u52A0\u5BC6\uFF0C\u53EA\u6709\u5F53\u524D Windows \u7528\u6237\u80FD\u89E3\u5F00\uFF1B\u9762\u677F\u4E0E\u65E5\u5FD7\u90FD\u62FF\u4E0D\u5230\u660E\u6587\u3002\u6362\u7528\u6237\u6216\u91CD\u88C5\u7CFB\u7EDF\u9700\u91CD\u65B0\u8F93\u5165\u3002</div>
    </div>
  </div>`;
    const view = $("#view");
    view.querySelectorAll('[data-act="iface-new"]').forEach((b) => b.addEventListener("click", () => {
      state.ifaceDraft = blankInterface(b.dataset.kind);
      state.ifaceEditing = true;
      state.testResult = null;
      renderSettings();
    }));
    view.querySelectorAll('[data-act="iface-edit"]').forEach((b) => b.addEventListener("click", () => {
      const it = list.find((x) => x.id === b.dataset.id);
      if (!it) return;
      state.ifaceDraft = {
        ...JSON.parse(JSON.stringify(it)),
        comfy: it.comfy || blankInterface("local").comfy
      };
      state.ifaceEditing = true;
      state.testResult = null;
      void loadModels(it.id).then(() => renderSettings());
    }));
    view.querySelector('[data-act="iface-cancel"]')?.addEventListener("click", () => {
      state.ifaceDraft = null;
      state.ifaceEditing = false;
      renderSettings();
    });
    view.querySelectorAll("[data-edit-kind]").forEach((b) => b.addEventListener("click", () => {
      if (!state.ifaceDraft) return;
      state.ifaceDraft.kind = b.dataset.editKind;
      if (state.ifaceDraft.kind === "local" && !state.ifaceDraft.baseUrl) state.ifaceDraft.baseUrl = "http://127.0.0.1:8188";
      if (state.ifaceDraft.kind === "local" && !state.ifaceDraft.comfy) state.ifaceDraft.comfy = blankInterface("local").comfy;
      renderSettings();
    }));
    view.querySelector("[data-edit-toggle-enabled]")?.addEventListener("click", (e) => {
      if (!state.ifaceDraft) return;
      state.ifaceDraft.enabled = state.ifaceDraft.enabled === false;
      e.currentTarget.setAttribute("aria-pressed", String(state.ifaceDraft.enabled !== false));
    });
    view.querySelectorAll('[data-act="iface-save"]').forEach((b) => b.addEventListener("click", async () => {
      const draft = state.ifaceDraft;
      if (!draft) return;
      const { key: _key, templates: _tpl, ...clean } = draft;
      const body = {
        interface: {
          ...clean,
          name: view.querySelector("#e-name")?.value.trim() || draft.name,
          baseUrl: view.querySelector("#e-baseurl")?.value.trim() || draft.baseUrl,
          defaultModel: view.querySelector("#e-model")?.value.trim() || "",
          models: (view.querySelector("#e-models")?.value || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
        }
      };
      if (draft.kind === "local") {
        const wf = {};
        for (const slot of SLOT_ORDER) {
          const el2 = view.querySelector(`#e-wf-${slot}`);
          if (el2) wf[slot] = el2.value.trim();
        }
        body.interface.comfy = {
          ...draft.comfy || {},
          workflows: wf,
          timeoutMs: Math.round(Number(view.querySelector("#e-timeout")?.value || 900) * 1e3),
          steps: Number(view.querySelector("#e-steps")?.value || 25),
          cfg: Number(view.querySelector("#e-cfg")?.value || 2.5),
          sampler: view.querySelector("#e-sampler")?.value.trim() || "",
          scheduler: view.querySelector("#e-scheduler")?.value.trim() || "",
          negative: view.querySelector("#e-negative")?.value || ""
        };
      } else {
        delete body.interface.comfy;
      }
      try {
        state.config = await svc("POST", "/interfaces", body);
        state.ifaceDraft = null;
        state.ifaceEditing = false;
        await toast("success", "\u63A5\u53E3\u5DF2\u4FDD\u5B58");
        await loadModels();
      } catch (err) {
        await toast("error", "\u4FDD\u5B58\u5931\u8D25\uFF1A" + describeHostError(err));
      }
      renderSettings();
    }));
    view.querySelectorAll('[data-act="iface-default"]').forEach((b) => b.addEventListener("click", async () => {
      try {
        state.config = await svc("POST", `/interfaces/${encodeURIComponent(b.dataset.id)}/default`);
        state.draft.interfaceId = "";
        state.draft.model = "";
        await toast("success", "\u5DF2\u8BBE\u4E3A\u9ED8\u8BA4\u63A5\u53E3");
        await loadModels();
      } catch (err) {
        await toast("error", "\u8BBE\u7F6E\u5931\u8D25\uFF1A" + describeHostError(err));
      }
      renderSettings();
    }));
    view.querySelectorAll('[data-act="iface-del"]').forEach((b) => {
      let armed = false;
      b.addEventListener("click", async () => {
        if (!armed) {
          armed = true;
          b.textContent = "\u518D\u70B9\u4E00\u6B21\u786E\u8BA4\u5220\u9664";
          setTimeout(() => {
            armed = false;
            b.textContent = "\u5220\u9664";
          }, 4e3);
          return;
        }
        try {
          state.config = await svc("POST", `/interfaces/${encodeURIComponent(b.dataset.id)}/delete`);
          await toast("success", "\u63A5\u53E3\u5DF2\u5220\u9664\uFF08\u542B\u5B83\u7684\u5BC6\u94A5\u6587\u4EF6\uFF09");
          await loadModels();
        } catch (err) {
          await toast("error", "\u5220\u9664\u5931\u8D25\uFF1A" + describeHostError(err));
        }
        renderSettings();
      });
    });
    view.querySelectorAll('[data-act="iface-test"]').forEach((b) => b.addEventListener("click", async () => {
      const id = b.dataset.id;
      state.testResult = null;
      await toast("info", "\u6B63\u5728\u6D4B\u8BD5\u8FDE\u63A5\u2026");
      try {
        const data = await svc("POST", `/interfaces/${encodeURIComponent(id)}/test`, {});
        state.testResult = { id, ...data };
        if (data.ok && data.kind === "cloud") state.models = data.models || [];
        if (data.ok) await toast("success", "\u8FDE\u63A5\u6B63\u5E38");
        else await toast("error", data.error || "\u8FDE\u63A5\u5931\u8D25");
      } catch (err) {
        state.testResult = { id, ok: false, error: describeHostError(err) };
        await toast("error", describeHostError(err));
      }
      renderSettings();
      if (state.testResult && !state.testResult.ok) {
        const el2 = view.querySelector(`[data-iface="${CSS.escape(id)}"]`);
        if (el2) el2.insertAdjacentHTML("beforeend", `<div class="bad">${esc(state.testResult.error || "\u8FDE\u63A5\u5931\u8D25")}</div>`);
      } else if (state.testResult?.ok) {
        const el2 = view.querySelector(`[data-iface="${CSS.escape(id)}"]`);
        if (el2) el2.insertAdjacentHTML("beforeend", `<div class="ok">${state.testResult.kind === "local" ? `ComfyUI ${esc(state.testResult.stats?.version || "")} \u5728\u7EBF` : `\u5DF2\u8FDE\u63A5 \xB7 ${state.testResult.total || 0} \u4E2A\u6A21\u578B`}</div>`);
      }
    }));
    view.querySelectorAll('[data-act="iface-pull"]').forEach((b) => b.addEventListener("click", async () => {
      const id = b.dataset.id;
      const it = list.find((x) => x.id === id);
      if (!it) return;
      await toast("info", "\u6B63\u5728\u62C9\u53D6\u6A21\u578B\u6E05\u5355\u2026");
      try {
        const data = await svc("GET", `/models?interface=${encodeURIComponent(id)}`);
        if (!data.ok) {
          await toast("error", data.error || "\u62C9\u53D6\u5931\u8D25");
          return;
        }
        const merged = [.../* @__PURE__ */ new Set([...it.models || [], ...(data.models || []).map((m) => m.id)])];
        state.config = await svc("POST", "/interfaces", {
          interface: { ...JSON.parse(JSON.stringify(it)), models: merged, defaultModel: it.defaultModel }
        });
        await toast("success", `\u5DF2\u8865\u5165 ${merged.length} \u4E2A\u6A21\u578B\uFF08\u624B\u586B\u9879\u4FDD\u7559\uFF09`);
        await loadModels(id);
      } catch (err) {
        await toast("error", "\u62C9\u53D6\u5931\u8D25\uFF1A" + describeHostError(err));
      }
      renderSettings();
    }));
    view.querySelector("#s-root")?.addEventListener("input", (e) => {
      state.rootDraft = e.target.value;
      state.rootError = "";
    });
    view.querySelector('[data-act="root-check"]')?.addEventListener("click", async () => {
      const raw = (view.querySelector("#s-root")?.value || "").trim();
      state.rootDraft = raw;
      state.rootError = "";
      if (!raw) {
        state.rootError = "\u8DEF\u5F84\u4E0D\u80FD\u4E3A\u7A7A";
        renderSettings();
        return;
      }
      try {
        const verdict = await svc("POST", "/root/check", { root: raw });
        if (!verdict.ok) {
          state.rootError = verdict.error || "\u8DEF\u5F84\u4E0D\u53EF\u7528";
          state.rootPending = "";
          state.rootWarn = "";
        } else {
          state.rootPending = verdict.root;
          state.rootWarn = verdict.warning || "";
          await toast("info", "\u786E\u8BA4\u4E0B\u9762\u4E24\u6B65\uFF0C\u624D\u4F1A\u771F\u6B63\u5207\u6362");
        }
      } catch (err) {
        state.rootError = describeHostError(err);
      }
      renderSettings();
    });
    view.querySelector('[data-act="root-cancel"]')?.addEventListener("click", () => {
      state.rootPending = "";
      state.rootWarn = "";
      state.rootError = "";
      state.rootDraft = state.config?.root || "";
      renderSettings();
    });
    for (const [act, migrate] of [["root-move", true], ["root-switch", false]]) {
      view.querySelector(`[data-act="${act}"]`)?.addEventListener("click", async () => {
        const target = state.rootPending;
        if (!target) return;
        state.rootBusy = true;
        state.rootError = "";
        renderSettings();
        await toast("info", migrate ? "\u6B63\u5728\u6574\u5E93\u642C\u8FC1\uFF0C\u56FE\u7247\u591A\u65F6\u9700\u8981\u4E00\u4F1A\u513F\u2026" : "\u6B63\u5728\u5207\u6362\u8D44\u4EA7\u5E93\u2026");
        try {
          const next = await svc("POST", "/root", { root: target, migrate });
          state.config = next;
          state.rootDraft = next.root || target;
          state.rootPending = "";
          state.rootWarn = "";
          imgCache.clear();
          refCache.clear();
          await toast("success", migrate ? `\u5DF2\u642C\u8FC1\u5230\u65B0\u4F4D\u7F6E\uFF08${next.moved?.files ?? 0} \u4E2A\u6587\u4EF6\uFF09\uFF1B\u6E90\u5E93\u5DF2\u5F52\u6863` : "\u5DF2\u5207\u6362\uFF08\u65E7\u5E93\u539F\u6837\u4FDD\u7559\uFF0C\u63A5\u53E3\u4E0E\u5BC6\u94A5\u9700\u5728\u65B0\u5E93\u91CD\u914D\uFF09");
          await refresh();
        } catch (err) {
          state.rootError = describeHostError(err);
          await toast("error", "\u5207\u6362\u5931\u8D25\uFF1A" + state.rootError);
        } finally {
          state.rootBusy = false;
        }
        renderSettings();
      });
    }
    view.querySelector('[data-act="root-resume"]')?.addEventListener("click", async () => {
      const info = state.config?.rootInfo?.pendingMove;
      if (!info) return;
      state.rootBusy = true;
      renderSettings();
      try {
        const next = await svc("POST", "/root", { root: info.to, migrate: true });
        state.config = next;
        state.rootDraft = next.root || "";
        imgCache.clear();
        refCache.clear();
        await toast("success", "\u4E0A\u6B21\u672A\u5B8C\u6210\u7684\u642C\u8FC1\u5DF2\u7EED\u5B8C");
        await refresh();
      } catch (err) {
        state.rootError = describeHostError(err);
        await toast("error", "\u7EED\u642C\u5931\u8D25\uFF1A" + state.rootError);
      } finally {
        state.rootBusy = false;
      }
      renderSettings();
    });
    view.querySelector('[data-act="root-default"]')?.addEventListener("click", async () => {
      state.rootBusy = true;
      state.rootError = "";
      renderSettings();
      try {
        const next = await svc("POST", "/root/reset", {});
        state.config = next;
        state.rootDraft = next.root || "";
        state.rootPending = "";
        state.rootWarn = "";
        await toast("success", "\u5DF2\u6062\u590D\u51FA\u5382\u9ED8\u8BA4\u4F4D\u7F6E\uFF08\u65E7\u5E93\u672A\u5220\u9664\uFF09");
        await refresh();
      } catch (err) {
        state.rootError = describeHostError(err);
        await toast("error", "\u6062\u590D\u9ED8\u8BA4\u5931\u8D25\uFF1A" + state.rootError);
      } finally {
        state.rootBusy = false;
      }
      renderSettings();
    });
    view.querySelectorAll("[data-default-size]").forEach((b) => b.addEventListener("click", async () => {
      try {
        state.config = await svc("POST", "/config", { defaultSize: b.dataset.defaultSize });
        state.draft.size = b.dataset.defaultSize;
      } catch (err) {
        await toast("error", describeHostError(err));
      }
      renderSettings();
    }));
    view.querySelectorAll("[data-default-count]").forEach((b) => b.addEventListener("click", async () => {
      try {
        state.config = await svc("POST", "/config", { defaultCount: Number(b.dataset.defaultCount) });
        state.draft.count = Number(b.dataset.defaultCount);
      } catch (err) {
        await toast("error", describeHostError(err));
      }
      renderSettings();
    }));
    view.querySelector("#s-timeout")?.addEventListener("change", async (e) => {
      const secs = Number(e.target.value);
      if (!Number.isFinite(secs)) return;
      try {
        state.config = await svc("POST", "/config", { timeoutMs: Math.round(secs * 1e3) });
        await toast("success", "\u8D85\u65F6\u5DF2\u4FDD\u5B58");
      } catch (err) {
        await toast("error", "\u4FDD\u5B58\u5931\u8D25\uFF1A" + describeHostError(err));
      }
      renderSettings();
    });
    const editor = view.querySelector(".iface-edit");
    if (editor && state.ifaceDraft) {
      editor.insertAdjacentHTML("beforeend", `<div class="group" style="margin-top:6px">
      <div class="ghead"><span class="gname">\u5BC6\u94A5</span>
        <span class="hint">${esc(state.ifaceDraft.kind === "local" ? "\u672C\u5730\u63A5\u53E3\u901A\u5E38\u4E0D\u9700\u8981" : "DPAPI \u52A0\u5BC6\u4FDD\u5B58")}</span></div>
      <input class="input" id="e-key" type="password" placeholder="\u8F93\u5165\u65B0\u5BC6\u94A5\u540E\u70B9\u4FDD\u5B58\uFF08\u4E0D\u4F1A\u663E\u793A\u660E\u6587\uFF09" autocomplete="off" />
      <div class="row">
        <button class="btn primary" type="button" data-act="key-save">\u4FDD\u5B58\u5BC6\u94A5</button>
        <button class="btn danger" type="button" data-act="key-clear">\u6E05\u9664\u5BC6\u94A5</button>
      </div>
    </div>`);
      editor.querySelector('[data-act="key-save"]').addEventListener("click", async () => {
        const apiKey = editor.querySelector("#e-key").value.trim();
        if (!apiKey) {
          await toast("error", "\u8BF7\u5148\u8F93\u5165\u5BC6\u94A5");
          return;
        }
        const id = state.ifaceDraft.id;
        if (!id) {
          await toast("error", "\u8BF7\u5148\u4FDD\u5B58\u63A5\u53E3\uFF0C\u518D\u5355\u72EC\u4FDD\u5B58\u5BC6\u94A5");
          return;
        }
        try {
          state.config = await svc("POST", `/interfaces/${encodeURIComponent(id)}/key`, { apiKey });
          editor.querySelector("#e-key").value = "";
          await toast("success", "\u5BC6\u94A5\u5DF2\u52A0\u5BC6\u4FDD\u5B58");
        } catch (err) {
          await toast("error", "\u4FDD\u5B58\u5931\u8D25\uFF1A" + describeHostError(err));
        }
        renderSettings();
      });
      editor.querySelector('[data-act="key-clear"]').addEventListener("click", async () => {
        const id = state.ifaceDraft.id;
        if (!id) return;
        try {
          state.config = await svc("POST", `/interfaces/${encodeURIComponent(id)}/key`, { clear: true });
          await toast("success", "\u5BC6\u94A5\u5DF2\u6E05\u9664");
        } catch (err) {
          await toast("error", "\u6E05\u9664\u5931\u8D25\uFF1A" + describeHostError(err));
        }
        renderSettings();
      });
    }
  }
  function openPicker() {
    const el2 = $("#pick");
    el2.hidden = false;
    el2.innerHTML = `
    <div class="dhead" style="position:sticky;top:0;background:var(--background);display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border)">
      <strong>\u9009\u62E9\u53C2\u8003\u56FE</strong>
      <button class="btn" type="button" data-act="pick-close">\u5173\u95ED</button>
    </div>
    <div class="pbody">
      ${state.assets.length ? `<div class="grid">${state.assets.map((a) => `
        <figure class="tile" data-pick="${esc(a.id)}" style="margin:0">
          ${imgSrc(a.id) ? `<img src="${imgSrc(a.id)}" alt="" />` : `<span class="ph" style="aspect-ratio:3/4"></span>`}
          <figcaption>${esc(fmtTime(a.createdAt))}</figcaption>
        </figure>`).join("")}</div>` : '<div class="empty">\u8D44\u4EA7\u5E93\u8FD8\u662F\u7A7A\u7684</div>'}
    </div>`;
    el2.querySelector('[data-act="pick-close"]').addEventListener("click", () => {
      el2.hidden = true;
      el2.innerHTML = "";
    });
    el2.querySelectorAll("[data-pick]").forEach((fig) => fig.addEventListener("click", () => {
      const id = fig.dataset.pick;
      if (!state.draft.refs.some((r) => r.id === id) && state.draft.refs.length < MAX_REFERENCES) {
        const rec = state.assets.find((a) => a.id === id);
        state.draft.refs.push({ id, name: rec?.file || id });
        void saveDraft();
      }
      el2.hidden = true;
      el2.innerHTML = "";
      renderCreate();
    }));
  }
  async function startGenerate() {
    if (state.generating) return;
    const d = state.draft;
    if (!d.prompt.trim()) {
      await toast("error", "\u63D0\u793A\u8BCD\u4E0D\u80FD\u4E3A\u7A7A");
      return;
    }
    const iface = activeInterface();
    if (!iface) {
      await toast("error", "\u8FD8\u6CA1\u6709\u53EF\u7528\u63A5\u53E3\uFF1A\u8BF7\u5230\u8BBE\u7F6E\u9875\u6DFB\u52A0\u5E76\u6307\u5B9A\u9ED8\u8BA4\u63A5\u53E3");
      return;
    }
    state.generating = true;
    state.job = { status: "running", pct: 0, phase: "\u63D0\u4EA4\u2026" };
    renderCreate();
    try {
      const data = await svc("POST", "/generate", {
        prompt: d.prompt.trim(),
        model: d.model || iface.defaultModel || "",
        size: d.size,
        count: d.count,
        transparent: d.transparent && !d.refs.length,
        references: d.refs.map((r) => r.id),
        interfaceId: iface.id,
        sessionId: state.session?.id || null,
        sessionTitle: state.session?.title || null,
        projectDirectory: state.session?.directory || null
      });
      state.job = { id: data.jobId, status: "running", pct: 0, phase: "\u6392\u961F\u2026" };
      renderCreate();
      void pollJob(data.jobId);
    } catch (err) {
      state.job = { status: "error", pct: 100, phase: "\u5931\u8D25", error: describeHostError(err) };
      state.generating = false;
      renderCreate();
    }
  }
  async function pollJob(jobId) {
    for (let i = 0; i < 120; i++) {
      if (!state.job || state.job.id !== jobId) return;
      await new Promise((r) => setTimeout(r, 3e3));
      if (!state.job || state.job.id !== jobId) return;
      if (state.job.status === "done" || state.job.status === "error") return;
      try {
        const job = await svc("GET", `/generate/${jobId}`);
        if (state.job?.id !== jobId) return;
        state.job = { ...state.job, ...job };
        if (job.status === "done" || job.status === "error") {
          state.generating = false;
          renderCreate();
          if (job.status === "done") {
            await toast("success", `\u5DF2\u751F\u6210 ${job.result?.assets?.length || 0} \u5F20\u5E76\u5165\u5E93`);
            void refresh();
          }
          return;
        }
        renderCreate();
      } catch {
      }
    }
  }
  function openDetail(id) {
    state.selected = id;
    renderDetail();
    $("#detail").hidden = false;
  }
  function closeDetail() {
    state.selected = null;
    $("#detail").hidden = true;
    $("#detail").innerHTML = "";
  }
  function refsOf(rec) {
    if (Array.isArray(rec.references) && rec.references.length) return rec.references;
    if (Array.isArray(rec.referenceIds) && rec.referenceIds.length) {
      return rec.referenceIds.map((id) => ({ kind: "asset", id }));
    }
    return [];
  }
  function rebuildKind(rec) {
    const k = rec.interfaceKind || rec.source || "";
    return k === "local" || k === "comfyui" ? "\u672C\u5730 ComfyUI" : k === "cloud" ? "\u4E91\u7AEF API" : "\u672A\u77E5\u6765\u6E90";
  }
  function describeEndpoint(rec) {
    const e = String(rec.endpoint || "");
    if (e.startsWith("comfyui:")) {
      const slot = e.slice("comfyui:".length);
      return `\u672C\u5730 ${SLOT_LABEL[slot] || slot}\uFF08ComfyUI \u5DE5\u4F5C\u6D41\uFF09`;
    }
    if (e === "/images/edits") return "\u53C2\u8003\u56FE\u751F\u56FE";
    if (e === "/images/generations") return "\u6587\u751F\u56FE";
    return "-";
  }
  function renderDetail() {
    const rec = state.assets.find((a) => a.id === state.selected);
    if (!rec) {
      closeDetail();
      return;
    }
    const el2 = $("#detail");
    const src = imgSrc(rec.id);
    const abs = state.root ? `${state.root}\\${rec.file}` : rec.file;
    const refs = refsOf(rec);
    const usage = fmtUsage(rec.usage);
    const actual = rec.width && rec.height ? `${rec.width} \xD7 ${rec.height}` : "?";
    const requested = rec.requestedSize || rec.apiSize || "";
    const sizeMismatch = requested && rec.width && rec.height && requested !== `${rec.width}x${rec.height}`;
    el2.innerHTML = `
    <div class="dhead">
      <strong>\u8D44\u4EA7\u8BE6\u60C5</strong>
      <button class="btn" type="button" data-act="close">\u5173\u95ED</button>
    </div>
    <div class="dbody">
      ${src ? `<img class="big" data-id="${esc(rec.id)}" src="${src}" alt="" />` : `<img class="big" data-id="${esc(rec.id)}" src="" alt="" style="aspect-ratio:${rec.width || 3}/${rec.height || 4}" />`}

      ${refs.length ? `<div class="section-label">\u53C2\u8003\u56FE ${refs.length} \u5F20</div>
        <div class="refrow">${refs.map((r) => {
      if (r.kind === "asset" && r.id) {
        return `<button type="button" data-open-asset="${esc(r.id)}" title="${esc(r.name || r.id)}">
              <img data-id="${esc(r.id)}" src="${imgSrc(r.id)}" alt="" /></button>`;
      }
      if (r.file) {
        return `<button type="button" data-ref-file="${esc(r.file)}" title="${esc(r.path || r.name || "")}">
              <img data-ref="${esc(r.file)}" src="${refCache.get(r.file) || ""}" alt="" /></button>`;
      }
      return `<span class="chip">${esc(r.name || r.path || "\u53C2\u8003\u56FE")}</span>`;
    }).join("")}</div>` : ""}

      <div class="prompt">${esc(rec.prompt || "\uFF08\u65E0\u63D0\u793A\u8BCD\uFF09")}</div>

      <dl class="meta">
        <dt>\u5C3A\u5BF8</dt><dd>${esc(actual)}${requested ? `\uFF08\u8BF7\u6C42 ${esc(requested)}\uFF09` : ""}${sizeMismatch ? ' <span class="hint">\u6A21\u578B\u81EA\u884C\u8C03\u6574\u4E86\u5C3A\u5BF8</span>' : ""}</dd>
        <dt>\u683C\u5F0F</dt><dd>${esc((rec.format || "?").toUpperCase())} \xB7 ${esc(fmtSize(rec.bytes || 0))}${rec.alpha && rec.format === "png" ? " \xB7 \u53EF\u80FD\u542B\u900F\u660E\u901A\u9053" : ""}</dd>
        <dt>\u6A21\u578B</dt><dd>${esc(rec.model || "-")}</dd>
        <dt>\u63A5\u53E3</dt><dd>${esc(rec.interfaceName ? `${rec.interfaceName}\uFF08${rebuildKind(rec)}\uFF09` : "-")}</dd>
        <dt>\u65B9\u5F0F</dt><dd>${esc(describeEndpoint(rec))}</dd>
        ${usage ? `<dt>\u7528\u91CF</dt><dd>${esc(usage)}</dd>` : ""}
        <dt>\u65F6\u95F4</dt><dd>${esc(fmtTime(rec.createdAt))}</dd>
        <dt>\u4F1A\u8BDD</dt><dd>${esc(rec.sessionTitle || "-")}${rec.sessionId ? ` <span class="hint">(${esc(rec.sessionId)})</span>` : ""}</dd>
        <dt>\u6587\u4EF6</dt><dd class="mono" title="${esc(abs)}">${esc(abs)}</dd>
        <dt>\u8D44\u4EA7 id</dt><dd class="mono">${esc(rec.id)}</dd>
      </dl>

      <div class="row">
        <button class="btn primary" type="button" data-act="use-ref">\u4EE5\u6B64\u56FE\u4E3A\u53C2\u8003</button>
        <button class="btn" type="button" data-act="copy-prompt">\u590D\u7528\u63D0\u793A\u8BCD</button>
      </div>

      <div class="section-label">\u6807\u7B7E</div>
      <div class="chips" id="d-tags">
        ${(rec.tags || []).map((t) => `<span class="chip">${esc(t)}<button type="button" data-del-tag="${esc(t)}" aria-label="\u79FB\u9664 ${esc(t)}">\xD7</button></span>`).join("") || '<span class="hint">\u6682\u65E0\u6807\u7B7E</span>'}
      </div>
      <div class="tagadd">
        <input class="input" id="d-tag-input" placeholder="\u8F93\u5165\u6807\u7B7E\u540E\u56DE\u8F66\u6DFB\u52A0" maxlength="40" />
        <button class="btn" type="button" data-act="add-tag">\u6DFB\u52A0</button>
      </div>

      <div class="section-label">\u5907\u6CE8</div>
      <textarea class="textarea" id="d-note" rows="3" maxlength="2000" placeholder="\u624B\u52A8\u6807\u6CE8\uFF1A\u5199\u4E0B\u8FD9\u5F20\u56FE\u7684\u7528\u9014\u3001\u7ED3\u8BBA\u3001\u5F85\u529E\u2026">${esc(rec.note || "")}</textarea>

      <div class="row">
        <button class="btn primary" type="button" data-act="save">\u4FDD\u5B58\u6807\u6CE8</button>
        <button class="btn" type="button" data-act="copy">\u590D\u5236\u8DEF\u5F84</button>
        <button class="btn danger" type="button" data-act="del" data-armed="false">\u5220\u9664</button>
      </div>
      <div class="hint">\u5220\u9664\u4F1A\u540C\u65F6\u79FB\u9664\u56FE\u7247\u6587\u4EF6\u4E0E\u7D22\u5F15\uFF0C\u4E0D\u53EF\u6062\u590D\u3002</div>
    </div>`;
    if (!src) void loadImg(rec.id);
    refs.forEach((r) => {
      if (r.kind === "asset" && r.id && !imgSrc(r.id)) void loadImg(r.id);
      if (r.file && !refCache.has(r.file)) void loadRefImage(r.file);
    });
    el2.querySelector('[data-act="close"]').addEventListener("click", closeDetail);
    el2.querySelectorAll("[data-open-asset]").forEach((b) => b.addEventListener("click", () => openDetail(b.dataset.openAsset)));
    el2.querySelector('[data-act="use-ref"]')?.addEventListener("click", () => {
      if (!state.draft.refs.some((r) => r.id === rec.id)) {
        state.draft.refs = [...state.draft.refs, { id: rec.id, name: rec.file }].slice(0, MAX_REFERENCES);
      }
      if (!state.draft.prompt && rec.prompt) state.draft.prompt = rec.prompt;
      void saveDraft();
      closeDetail();
      state.tab = "create";
      render();
    });
    el2.querySelector('[data-act="copy-prompt"]')?.addEventListener("click", async () => {
      try {
        await host.writeClipboard(rec.prompt || "");
        await toast("success", "\u63D0\u793A\u8BCD\u5DF2\u590D\u5236");
      } catch (err) {
        await toast("error", "\u590D\u5236\u5931\u8D25\uFF1A" + describeHostError(err));
      }
    });
    el2.querySelectorAll("[data-del-tag]").forEach((b) => {
      b.addEventListener("click", () => {
        const next = (rec.tags || []).filter((t) => t !== b.dataset.delTag);
        void pushAnnotate(rec.id, { tags: next });
      });
    });
    const addTag = () => {
      const input = el2.querySelector("#d-tag-input");
      const v2 = input.value.trim();
      if (!v2) return;
      input.value = "";
      const next = [...rec.tags || []];
      if (!next.includes(v2)) next.push(v2);
      void pushAnnotate(rec.id, { tags: next });
    };
    el2.querySelector('[data-act="add-tag"]').addEventListener("click", addTag);
    el2.querySelector("#d-tag-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addTag();
      }
    });
    el2.querySelector('[data-act="save"]').addEventListener("click", () => {
      void pushAnnotate(rec.id, { note: el2.querySelector("#d-note").value });
    });
    el2.querySelector('[data-act="copy"]').addEventListener("click", async () => {
      try {
        await host.writeClipboard(abs);
        await toast("success", "\u8DEF\u5F84\u5DF2\u590D\u5236");
      } catch (err) {
        await toast("error", "\u590D\u5236\u5931\u8D25\uFF1A" + describeHostError(err));
      }
    });
    const delBtn = el2.querySelector('[data-act="del"]');
    let armed = false;
    let armTimer = null;
    delBtn.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        delBtn.dataset.armed = "true";
        delBtn.textContent = "\u518D\u70B9\u4E00\u6B21\u786E\u8BA4\u5220\u9664";
        armTimer = setTimeout(() => {
          armed = false;
          delBtn.dataset.armed = "false";
          delBtn.textContent = "\u5220\u9664";
        }, 4e3);
        return;
      }
      clearTimeout(armTimer);
      void doDelete(rec.id);
    });
  }
  function mount() {
    $("#tabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      state.tab = btn.dataset.tab;
      render();
      if (state.tab === "settings" && !state.config) {
        void (async () => {
          await loadConfig();
          await loadModels();
          renderSettings();
        })();
      }
      if (state.tab === "create") void loadModels().then(() => renderCreate());
    });
    $("#q").addEventListener("input", (e) => {
      state.q = e.target.value.trim();
      render();
    });
    $("#tagrow").addEventListener("click", (e) => {
      const btn = e.target.closest(".tagchip");
      if (!btn) return;
      state.tag = state.tag === btn.dataset.tag ? "" : btn.dataset.tag;
      render();
    });
    $("#banner-retry").addEventListener("click", () => void refresh());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.selected) closeDetail();
    });
  }
  var mounted = false;
  host.onReady(async (ctx) => {
    try {
      applyHostReady(ctx, document.documentElement);
    } catch {
    }
    try {
      document.documentElement.dataset.theme = ctx.theme?.mode || "light";
    } catch {
    }
    if (ctx.session?.id) state.session = ctx.session;
    if (!mounted) {
      mounted = true;
      mount();
    }
    await loadDraft();
    void refresh();
    void loadConfig().then(async () => {
      await loadModels();
      if (state.tab === "settings") renderSettings();
      if (state.tab === "create") renderCreate();
    });
  });
  host.onSession((session) => {
    state.session = session;
    render();
  });
  host.onServiceEvent((evt) => {
    if (!evt) return;
    if (evt.topic === "assets-changed") void refresh();
    if (evt.topic === "config-changed") void loadConfig().then(() => {
      if (state.tab === "settings") renderSettings();
    });
    if (evt.topic === "generate-progress" && state.job?.id === evt.data?.jobId) {
      state.job = { ...state.job, status: "running", phase: evt.data.phase, pct: evt.data.pct };
      if (state.tab === "create") renderCreate();
    }
    if (evt.topic === "generate-done" && state.job?.id === evt.data?.jobId) {
      if (evt.data.ok) {
        state.job = { ...state.job, status: "done", pct: 100, phase: "\u5B8C\u6210", result: { assets: evt.data.assets || [] } };
        state.generating = false;
        void toast("success", `\u5DF2\u751F\u6210 ${(evt.data.assets || []).length} \u5F20\u5E76\u5165\u5E93`);
        void refresh();
      } else {
        state.job = { ...state.job, status: "error", pct: 100, phase: "\u5931\u8D25", error: evt.data.error };
        state.generating = false;
      }
      if (state.tab === "create") renderCreate();
    }
  });
  setInterval(() => {
    if (!document.hidden && (state.tab === "session" || state.tab === "all")) void refresh();
  }, 1e4);
})();
