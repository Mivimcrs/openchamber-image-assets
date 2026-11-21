// ../../../../.config/openchamber/extensions/image-assets/源码/service/main.js
import http from "node:http";
import fs6 from "node:fs";
import path6 from "node:path";
import crypto3 from "node:crypto";
import { fileURLToPath } from "node:url";

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
var SERVICE_HOST_PATH = "/service/call";
var OPENCHAMBER_HOST_CALLBACK_URL_ENV = "OPENCHAMBER_HOST_CALLBACK_URL";
var SERVICE_HOST_TIMEOUT_MS = 3e4;
var SERVICE_SCHEDULE_IDLE_MS = 10 * 6e4;
var MENTIONS_IDLE_MS = 10 * 6e4;
var ServiceHostError = class extends Error {
  code;
  status;
  constructor(message, code, status) {
    super(message);
    this.name = "ServiceHostError";
    this.code = code;
    this.status = status;
  }
};
var createServiceHost = ({ env }) => {
  const call = async (method, input) => {
    const base2 = env[OPENCHAMBER_HOST_CALLBACK_URL_ENV];
    const token = env.OPENCHAMBER_SERVICE_TOKEN;
    if (!base2 || !token)
      throw new ServiceHostError("This service was not started by OpenChamber.", "HOST_UNAVAILABLE", 0);
    let response;
    try {
      response = await fetch(`${base2.replace(/\/+$/, "")}${SERVICE_HOST_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method, input }),
        signal: AbortSignal.timeout(SERVICE_HOST_TIMEOUT_MS)
      });
    } catch {
      throw new ServiceHostError("OpenChamber did not answer.", "HOST_UNAVAILABLE", 0);
    }
    const body = await response.json().catch(() => null);
    if (response.ok && body?.result !== void 0)
      return body.result;
    throw new ServiceHostError(body?.error?.message ?? `OpenChamber answered HTTP ${response.status}.`, body?.error?.code ?? "HOST_UNAVAILABLE", response.status);
  };
  return {
    sessions: {
      start: (input) => call("sessions.start", input),
      send: (sessionId, prompt) => call("sessions.send", { sessionId, prompt }),
      retry: (sessionId) => call("sessions.retry", { sessionId }),
      status: (sessionId) => call("sessions.status", { sessionId }),
      lastReply: (sessionId) => call("sessions.lastReply", { sessionId }),
      stop: (sessionId) => call("sessions.stop", { sessionId }),
      answerPermission: (sessionId, requestId, answer) => call("sessions.answerPermission", { sessionId, requestId, ...answer }),
      answerForm: (sessionId, formId, values, message) => call("sessions.answerForm", { sessionId, formId, values, ...message === void 0 ? {} : { message } })
    },
    setInstructions: (directory, text) => call("instructions.set", { directory, text }),
    emit: (topic, data) => call("panels.emit", { topic, data }),
    readSettings: () => call("settings.read", {}).then(({ settings }) => settings),
    needsConfiguration: (message) => call("status.set", { needsConfiguration: message })
  };
};

// deps/@openchamber/sdk/dist/contract.js
var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
var GUEST_GENERATE_LATE_KEEP_MS = 60 * 6e4;
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
var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);

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

// ../../../../.config/openchamber/extensions/image-assets/源码/共享/资产库.js
import fs from "node:fs";
import path from "node:path";
var FILE_MB_LIMIT = 5.5;
var NOTE_MAX = 2e3;
var TAG_MAX = 30;
var TAG_LEN = 40;
function libraryPaths(root) {
  return {
    root,
    images: path.join(root, "\u56FE\u7247"),
    index: path.join(root, "\u7D22\u5F15"),
    runtime: path.join(root, "\u8FD0\u884C\u65F6"),
    refs: path.join(root, "\u8FD0\u884C\u65F6", "\u53C2\u8003"),
    config: path.join(root, "\u914D\u7F6E")
  };
}
function ensureLibrary(root) {
  const p = libraryPaths(root);
  for (const dir of Object.values(p)) fs.mkdirSync(dir, { recursive: true });
  return p;
}
function scanAssets(root) {
  const { index, images } = libraryPaths(root);
  const assets = [];
  const warnings = [];
  let names = [];
  try {
    names = fs.readdirSync(index);
  } catch {
    return { assets, warnings };
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(index, name), "utf8"));
      if (!rec || typeof rec.id !== "string") throw new Error("\u7F3A\u5C11 id");
      const fileAbs = path.join(root, rec.file || "");
      if (!rec.file || !fileAbs.startsWith(root + path.sep)) throw new Error("file \u8D8A\u754C");
      if (!fs.existsSync(fileAbs)) throw new Error("\u56FE\u7247\u6587\u4EF6\u4E0D\u5B58\u5728");
      assets.push(rec);
    } catch (err) {
      warnings.push(`${name}: ${err.message}`);
    }
  }
  assets.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { assets, warnings };
}
function findAsset(root, id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const { index } = libraryPaths(root);
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(index, id + ".json"), "utf8"));
    return rec && rec.id === id ? rec : null;
  } catch {
    return null;
  }
}
function makeAssetId(now = Date.now(), rand = Math.random()) {
  return now.toString(36) + "-" + Math.floor(rand * 16777215).toString(36).padStart(4, "0");
}
function saveAsset(root, bytes, record) {
  const { images, index } = ensureLibrary(root);
  const ext = bytes[0] === 137 ? ".png" : bytes[1] === 216 ? ".jpg" : ".bin";
  const id = record.id || makeAssetId(record.createdAt || Date.now());
  const stamp2 = new Date(record.createdAt || Date.now());
  const ymd = stamp2.getFullYear().toString() + String(stamp2.getMonth() + 1).padStart(2, "0") + String(stamp2.getDate()).padStart(2, "0");
  const hms = String(stamp2.getHours()).padStart(2, "0") + String(stamp2.getMinutes()).padStart(2, "0") + String(stamp2.getSeconds()).padStart(2, "0");
  let n = 0;
  let fileAbs;
  do {
    const suffix = n === 0 ? "" : `-${n}`;
    fileAbs = path.join(images, `${ymd}-${hms}-${id}${suffix}${ext}`);
    n++;
  } while (fs.existsSync(fileAbs));
  fs.writeFileSync(fileAbs, bytes);
  const full = {
    version: 1,
    ...record,
    id,
    file: path.relative(root, fileAbs),
    bytes: bytes.length,
    createdAt: record.createdAt || Date.now(),
    tags: normalizeTags(record.tags),
    note: typeof record.note === "string" ? record.note.slice(0, NOTE_MAX) : ""
  };
  fs.writeFileSync(path.join(index, id + ".json"), JSON.stringify(full, null, 2), "utf8");
  return full;
}
function annotateAsset(root, id, { tags, note }) {
  const rec = findAsset(root, id);
  if (!rec) throw new Error("\u8D44\u4EA7\u4E0D\u5B58\u5728");
  if (tags !== void 0) rec.tags = normalizeTags(tags);
  if (note !== void 0) {
    if (typeof note !== "string") throw new Error("note \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
    rec.note = note.slice(0, NOTE_MAX);
  }
  rec.updatedAt = Date.now();
  const { index } = libraryPaths(root);
  fs.writeFileSync(path.join(index, id + ".json"), JSON.stringify(rec, null, 2), "utf8");
  return rec;
}
function deleteAsset(root, id) {
  const rec = findAsset(root, id);
  if (!rec) throw new Error("\u8D44\u4EA7\u4E0D\u5B58\u5728");
  const { index } = libraryPaths(root);
  fs.rmSync(path.join(index, id + ".json"), { force: true });
  let warning;
  const fileAbs = path.join(root, rec.file);
  try {
    if (fileAbs.startsWith(root + path.sep)) fs.rmSync(fileAbs, { force: true });
    else warning = "file \u8DEF\u5F84\u8D8A\u754C\uFF0C\u672A\u5220\u9664\u56FE\u7247";
  } catch (err) {
    warning = `\u7D22\u5F15\u5DF2\u5220\u9664\uFF0C\u4F46\u56FE\u7247\u5220\u9664\u5931\u8D25\uFF1A${err.message}`;
  }
  return { deleted: true, warning };
}
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const t = raw.trim().slice(0, TAG_LEN);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= TAG_MAX) break;
  }
  return out;
}
function filterAssets(assets, { sessionId, q, tag } = {}) {
  let out = assets;
  if (sessionId) out = out.filter((a) => a.sessionId === sessionId);
  if (tag) out = out.filter((a) => Array.isArray(a.tags) && a.tags.includes(tag));
  if (q) {
    const needle = q.toLowerCase();
    out = out.filter((a) => [a.prompt, a.note, a.sessionTitle, a.file, ...a.tags || []].some((s) => typeof s === "string" && s.toLowerCase().includes(needle)));
  }
  return out;
}
function insideLibrary(root, rel) {
  if (typeof rel !== "string" || !rel) return null;
  const abs = path.resolve(root, rel);
  return abs.startsWith(path.resolve(root) + path.sep) ? abs : null;
}
var MOVE_MARKER_DIR = ".\u642C\u5BB6\u4E2D";
var MOVE_MARKER = "move.json";
var LIB_ENTRIES = ["\u56FE\u7247", "\u7D22\u5F15", "\u914D\u7F6E", "\u8FD0\u884C\u65F6"];
function countFiles(dir) {
  let n = 0;
  let bytes = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { files: 0, bytes: 0 };
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const sub = countFiles(path.join(dir, e.name));
      n += sub.files;
      bytes += sub.bytes;
    } else {
      n += 1;
      try {
        bytes += fs.statSync(path.join(dir, e.name)).size;
      } catch {
      }
    }
  }
  return { files: n, bytes };
}
function copyTree(src, dst, onProgress) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      copyTree(path.join(src, e.name), path.join(dst, e.name), onProgress);
    }
    return;
  }
  if (fs.existsSync(dst) && fs.statSync(dst).size === st.size) {
    onProgress?.("skip", src);
    return;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  onProgress?.("copy", src);
}
function readMarker(to) {
  try {
    return JSON.parse(fs.readFileSync(path.join(to, MOVE_MARKER_DIR, MOVE_MARKER), "utf8"));
  } catch {
    return null;
  }
}
function writeMarker(to, doc) {
  const dir = path.join(to, MOVE_MARKER_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, MOVE_MARKER), JSON.stringify(doc, null, 2), "utf8");
}
function clearMarker(to) {
  try {
    fs.rmSync(path.join(to, MOVE_MARKER_DIR), { recursive: true, force: true });
  } catch {
  }
}
function moveLibrary(from, to, opts = {}) {
  const src = path.resolve(from);
  const dst = path.resolve(to);
  if (src === dst) throw new Error("\u6E90\u4E0E\u76EE\u6807\u662F\u540C\u4E00\u4E2A\u76EE\u5F55");
  if (dst.startsWith(src + path.sep)) throw new Error("\u76EE\u6807\u4E0D\u80FD\u653E\u5728\u6E90\u5E93\u91CC\u9762");
  if (!fs.existsSync(src)) throw new Error(`\u6E90\u5E93\u4E0D\u5B58\u5728\uFF1A${src}`);
  const warnings = [];
  const existing = readMarker(dst);
  if (!existing && fs.existsSync(path.join(dst, "\u7D22\u5F15")) && fs.readdirSync(path.join(dst, "\u7D22\u5F15")).length) {
    throw new Error(`\u76EE\u6807\u4F4D\u7F6E\u5DF2\u7ECF\u6709\u8D44\u4EA7\u5E93\uFF08${dst}\uFF09\uFF1A\u8BF7\u6362\u4E00\u4E2A\u7A7A\u76EE\u5F55\uFF0C\u6216\u5148\u628A\u90A3\u8FB9\u7684\u5E93\u632A\u8D70`);
  }
  const stamp2 = (opts.now ? new Date(opts.now) : /* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const resumed = Boolean(existing && path.resolve(existing.from) === src);
  if (existing && !resumed) {
    throw new Error(`\u76EE\u6807\u4F4D\u7F6E\u6709\u672A\u5B8C\u6210\u7684\u642C\u8FC1\u6807\u8BB0\uFF08\u6E90 ${existing.from}\uFF09\uFF1A\u5148\u786E\u8BA4\u90A3\u6B21\u642C\u8FC1\uFF0C\u6216\u6362\u4E00\u4E2A\u76EE\u6807\u76EE\u5F55`);
  }
  if (!resumed) writeMarker(dst, { version: 1, from: src, to: dst, startedAt: Date.now() });
  opts.onProgress?.(resumed ? "\u7EE7\u7EED\u4E0A\u6B21\u672A\u5B8C\u6210\u7684\u642C\u8FC1\u2026" : "\u5F00\u59CB\u590D\u5236\u8D44\u4EA7\u5E93\u2026");
  for (const name of LIB_ENTRIES) {
    const s = path.join(src, name);
    if (!fs.existsSync(s)) continue;
    opts.onProgress?.(`\u590D\u5236 ${name}\u2026`);
    copyTree(s, path.join(dst, name));
  }
  let files = 0;
  let bytes = 0;
  for (const name of LIB_ENTRIES) {
    const s = path.join(src, name);
    if (!fs.existsSync(s)) continue;
    const a = countFiles(s);
    const b = countFiles(path.join(dst, name));
    files += b.files;
    bytes += b.bytes;
    if (a.files !== b.files || a.bytes !== b.bytes) {
      throw new Error(`\u642C\u8FC1\u6821\u9A8C\u5931\u8D25\uFF08${name}\uFF09\uFF1A\u6E90 ${a.files} \u4E2A\u6587\u4EF6/${a.bytes}B\uFF0C\u76EE\u6807 ${b.files}/${b.bytes}B\u3002\u6807\u8BB0\u5DF2\u4FDD\u7559\uFF0C\u53EF\u91CD\u8BD5\u7EED\u4F20`);
    }
  }
  let backup = "";
  if (opts.keepSource !== true) {
    const target = `${src}.\u5F52\u6863-${stamp2}`;
    try {
      fs.renameSync(src, target);
      backup = target;
    } catch (err) {
      warnings.push(`\u6E90\u5E93\u6539\u540D\u5931\u8D25\uFF08${err?.message || err}\uFF09\uFF1A\u5DF2\u590D\u5236\u5230\u65B0\u4F4D\u7F6E\uFF0C\u6E90\u5E93\u4FDD\u6301\u539F\u6837\uFF0C\u8BF7\u624B\u52A8\u5F52\u6863`);
    }
  } else {
    backup = src;
  }
  clearMarker(dst);
  opts.onProgress?.("\u642C\u8FC1\u5B8C\u6210");
  return { action: resumed ? "resumed" : "moved", from: src, to: dst, files, bytes, backup, warnings };
}
function pendingMove(root) {
  const m = readMarker(path.resolve(root));
  return m && typeof m.from === "string" ? { from: m.from, to: m.to, startedAt: Number(m.startedAt) || 0 } : null;
}

// ../../../../.config/openchamber/extensions/image-assets/源码/共享/校验.js
var PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];
function sniffImage(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const isPng = PNG_MAGIC.every((b, i) => bytes[i] === b);
  if (isPng) {
    if (bytes.length < 24 || String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") return null;
    const width = readU32(bytes, 16);
    const height = readU32(bytes, 20);
    return width > 0 && height > 0 ? { type: "png", width, height } : null;
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 255) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 255) {
        i++;
        continue;
      }
      if (marker === 216 || marker === 1 || marker >= 208 && marker <= 215) {
        i += 2;
        continue;
      }
      const len = bytes[i + 2] << 8 | bytes[i + 3];
      if (len < 2) return null;
      const isSof = marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204;
      if (isSof) {
        const height = bytes[i + 5] << 8 | bytes[i + 6];
        const width = bytes[i + 7] << 8 | bytes[i + 8];
        return width > 0 && height > 0 ? { type: "jpg", width, height } : null;
      }
      if (marker === 218) return null;
      i += 2 + len;
    }
    return null;
  }
  return null;
}
function readU32(b, off) {
  return (b[off] << 24 | b[off + 1] << 16 | b[off + 2] << 8 | b[off + 3]) >>> 0;
}

// ../../../../.config/openchamber/extensions/image-assets/源码/共享/配置.js
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import crypto from "node:crypto";
var SETTINGS_VERSION = 2;
var LIBRARY_DIR_NAME = "openchamber-image-assets";
var LOCATOR_FILE_NAME = "location.json";
function locatorDir(env = process.env, home = os.homedir()) {
  const xdg = typeof env?.XDG_CONFIG_HOME === "string" ? env.XDG_CONFIG_HOME.trim() : "";
  if (xdg) return path2.join(path2.resolve(xdg), LIBRARY_DIR_NAME);
  const appData = typeof env?.APPDATA === "string" ? env.APPDATA.trim() : "";
  if (process.platform === "win32" && appData) return path2.join(path2.resolve(appData), LIBRARY_DIR_NAME);
  return path2.join(home, ".config", LIBRARY_DIR_NAME);
}
function locatorPath(env = process.env, home = os.homedir()) {
  return path2.join(locatorDir(env, home), LOCATOR_FILE_NAME);
}
function readLocator(env = process.env, home = os.homedir()) {
  try {
    const raw = JSON.parse(fs2.readFileSync(locatorPath(env, home), "utf8"));
    if (raw && typeof raw.root === "string" && raw.root.trim()) {
      return { root: path2.resolve(raw.root.trim()), updatedAt: Number(raw.updatedAt) || 0 };
    }
  } catch {
  }
  return { root: "", updatedAt: 0 };
}
function writeLocator(root, env = process.env, home = os.homedir(), now = Date.now()) {
  const target = path2.resolve(String(root || "").trim());
  if (!target) throw new Error("\u8D44\u4EA7\u5E93\u8DEF\u5F84\u4E0D\u80FD\u4E3A\u7A7A");
  const file = locatorPath(env, home);
  fs2.mkdirSync(path2.dirname(file), { recursive: true });
  const tmp = `${file}.${Math.random().toString(36).slice(2)}.tmp`;
  fs2.writeFileSync(tmp, JSON.stringify({ version: 1, root: target, updatedAt: now }, null, 2), "utf8");
  fs2.renameSync(tmp, file);
  return target;
}
function clearLocator(env = process.env, home = os.homedir()) {
  try {
    fs2.rmSync(locatorPath(env, home), { force: true });
    return true;
  } catch {
    return false;
  }
}
function resolveLibraryRoot(opts = {}) {
  const env = opts.env || process.env;
  const home = opts.home || os.homedir();
  const explicit = typeof opts.explicit === "string" ? opts.explicit.trim() : "";
  const envRoot = typeof env?.IMAGE_ASSETS_ROOT === "string" ? env.IMAGE_ASSETS_ROOT.trim() : "";
  const loc = readLocator(env, home);
  const fallback = path2.join(home, LIBRARY_DIR_NAME);
  const out = {
    custom: loc.root,
    envRoot: envRoot ? path2.resolve(envRoot) : "",
    defaultRoot: fallback,
    updatedAt: loc.updatedAt
  };
  if (explicit) return { ...out, root: path2.resolve(explicit), source: "explicit" };
  if (envRoot) return { ...out, root: path2.resolve(envRoot), source: "env" };
  if (loc.root) return { ...out, root: loc.root, source: "custom" };
  return { ...out, root: fallback, source: "default" };
}
function validateLibraryRoot(candidate, opts = {}) {
  const raw = typeof candidate === "string" ? candidate.trim() : "";
  if (!raw) return { ok: false, error: "\u8DEF\u5F84\u4E0D\u80FD\u4E3A\u7A7A", root: "" };
  let target;
  try {
    target = path2.resolve(raw);
  } catch {
    return { ok: false, error: "\u8DEF\u5F84\u4E0D\u5408\u6CD5", root: "" };
  }
  if (path2.isAbsolute(target) === false) return { ok: false, error: "\u9700\u8981\u7EDD\u5BF9\u8DEF\u5F84", root: "" };
  if (/^[A-Za-z]:$/.test(target) || target === path2.parse(target).root) {
    return { ok: false, error: "\u4E0D\u80FD\u628A\u76D8\u7B26\u6839\u76EE\u5F55\u5F53\u8D44\u4EA7\u5E93", root: "" };
  }
  if (target.length > 520) return { ok: false, error: "\u8DEF\u5F84\u8FC7\u957F\uFF08\u4E0A\u9650 520 \u4E2A\u5B57\u7B26\uFF09", root: "" };
  if (/^[.~]/.test(target.split(path2.sep).pop() || "") && !path2.isAbsolute(raw)) {
    return { ok: false, error: "\u9700\u8981\u7EDD\u5BF9\u8DEF\u5F84", root: "" };
  }
  const fromEnv = typeof (opts.env || process.env)?.IMAGE_ASSETS_ROOT === "string" ? (opts.env || process.env).IMAGE_ASSETS_ROOT.trim() : "";
  if (fromEnv && path2.resolve(fromEnv) === target) {
    return { ok: false, error: "\u5F53\u524D\u88AB\u73AF\u5883\u53D8\u91CF IMAGE_ASSETS_ROOT \u8986\u76D6\uFF1A\u6539\u73AF\u5883\u53D8\u91CF\u6216\u5148\u6E05\u6389\u5B83\uFF0C\u9762\u677F\u4FDD\u5B58\u4E0D\u4F1A\u751F\u6548", root: target };
  }
  if (opts.currentRoot && path2.resolve(opts.currentRoot) === target) {
    return { ok: false, error: "\u8FD9\u5C31\u662F\u5F53\u524D\u8DEF\u5F84\uFF0C\u65E0\u9700\u5207\u6362", root: target };
  }
  if (opts.extRoot && path2.resolve(target).startsWith(path2.resolve(opts.extRoot) + path2.sep)) {
    return { ok: false, error: "\u4E0D\u80FD\u653E\u5728\u6269\u5C55\u5B89\u88C5\u76EE\u5F55\u91CC\uFF08\u5BBF\u4E3B\u66F4\u65B0\u4F1A\u6574\u4EFD\u66FF\u6362\uFF09", root: target };
  }
  if (opts.currentRoot && target.startsWith(path2.resolve(opts.currentRoot) + path2.sep)) {
    return { ok: false, error: "\u4E0D\u80FD\u653E\u5728\u5F53\u524D\u8D44\u4EA7\u5E93\u91CC\u9762\uFF08\u8BF7\u9009\u5E93\u5916\u9762\u7684\u8DEF\u5F84\uFF09", root: target };
  }
  let st = null;
  try {
    st = fs2.statSync(target);
  } catch {
  }
  if (st && !st.isDirectory()) return { ok: false, error: `\u8BE5\u8DEF\u5F84\u5DF2\u5B58\u5728\u4F46\u4E0D\u662F\u76EE\u5F55\uFF1A${target}`, root: target };
  if (st?.isDirectory()) {
    try {
      const probe = path2.join(target, `.write-probe-${Math.random().toString(36).slice(2)}`);
      fs2.mkdirSync(probe);
      try {
        fs2.rmSync(probe, { recursive: true, force: true, maxRetries: 3, retryDelay: 60 });
      } catch {
      }
    } catch (err) {
      return { ok: false, error: `\u76EE\u5F55\u4E0D\u53EF\u5199\uFF1A${err?.message || err}`, root: target };
    }
    const idx = path2.join(target, "\u7D22\u5F15");
    let hasOther = false;
    try {
      hasOther = fs2.existsSync(idx) && fs2.readdirSync(idx).length > 0;
    } catch {
    }
    if (hasOther) {
      return { ok: true, warning: "\u8BE5\u4F4D\u7F6E\u5DF2\u7ECF\u6709\u4E00\u4E2A\u8D44\u4EA7\u5E93\uFF1A\u6574\u5E93\u642C\u8FC1\u4F1A\u88AB\u62D2\u7EDD\uFF0C\u53EA\u5207\u6362\u5219\u4F1A\u76F4\u63A5\u7528\u5B83", error: "", root: target };
    }
  } else {
    const parent = path2.dirname(target);
    try {
      fs2.accessSync(parent, fs2.constants.W_OK);
    } catch {
      return { ok: false, error: `\u4E0A\u7EA7\u76EE\u5F55\u4E0D\u53EF\u5199\u6216\u4E0D\u5B58\u5728\uFF1A${parent}`, root: target };
    }
  }
  return { ok: true, error: "", root: target };
}
var INTERFACE_KINDS = ["cloud", "local"];
var KIND_LABEL = { cloud: "\u4E91\u7AEF API", local: "\u672C\u5730 ComfyUI" };
var DEFAULT_COMFY_URL = "http://127.0.0.1:8188";
var WORKFLOW_SLOTS = ["t2i", "i2i", "video"];
var DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  interfaces: [],
  defaultInterface: "",
  defaultSize: "1024x1536",
  defaultCount: 1,
  timeoutMs: 3e5
};
var SIZE_RE = /^(\d{3,5})x(\d{3,5})$/i;
var INTERFACE_ID_RE = /^[a-z0-9_-]{1,24}$/;
function configDir(root) {
  return path2.join(root, "\u914D\u7F6E");
}
function settingsPath(root) {
  return path2.join(configDir(root), "settings.json");
}
function keysDir(root) {
  return path2.join(configDir(root), "\u5BC6\u94A5");
}
function legacyCredentialsPath(root) {
  return path2.join(configDir(root), "credentials.dat");
}
function archiveDir(root) {
  return path2.join(configDir(root), "\u5F52\u6863");
}
function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
function str(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function normalizeBaseUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw new Error("API \u5730\u5740\u4E0D\u80FD\u4E3A\u7A7A");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("API \u5730\u5740\u4E0D\u662F\u5408\u6CD5 URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("API \u5730\u5740\u53EA\u652F\u6301 http / https");
  return raw.replace(/\/+$/, "");
}
function makeInterfaceId(now = Date.now(), rand = crypto.randomBytes(4).toString("hex")) {
  return `if-${now.toString(36)}${String(rand).slice(0, 4)}`.replace(/[^a-z0-9_-]/gi, "").toLowerCase();
}
function defaultComfyConfig(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const workflows = {};
  for (const slot of WORKFLOW_SLOTS) {
    const item = src.workflows?.[slot] ?? src[slot];
    workflows[slot] = typeof item === "string" ? item.trim().slice(0, 200) : "";
  }
  return {
    timeoutMs: clampInt(src.timeoutMs, 3e4, 36e5, 9e5),
    pollMs: clampInt(src.pollMs, 500, 1e4, 1500),
    workflows,
    negative: typeof src.negative === "string" ? src.negative.slice(0, 2e3) : "",
    steps: clampInt(src.steps, 1, 150, 25),
    cfg: Number.isFinite(Number(src.cfg)) ? Math.min(30, Math.max(0, Number(src.cfg))) : 2.5,
    sampler: str(src.sampler, 80),
    scheduler: str(src.scheduler, 80),
    // 可选：覆盖模板里的模型名；留空表示用模板自带的值
    clip: str(src.clip, 120),
    vae: str(src.vae, 120),
    lora: str(src.lora, 120)
  };
}
function normalizeInterface(input, opts = {}) {
  const src = input && typeof input === "object" ? input : {};
  const kind = INTERFACE_KINDS.includes(src.kind) ? src.kind : "cloud";
  let id = str(src.id, 24).toLowerCase();
  if (!INTERFACE_ID_RE.test(id)) id = makeInterfaceId();
  let baseUrl = kind === "local" ? DEFAULT_COMFY_URL : "";
  try {
    if (src.baseUrl) baseUrl = normalizeBaseUrl(src.baseUrl);
  } catch {
    if (opts.requireUrl) throw new Error(`\u63A5\u53E3\u300C${str(src.name, 60) || id}\u300D\u7684 API \u5730\u5740\u4E0D\u662F\u5408\u6CD5 URL\uFF1A${src.baseUrl}`);
  }
  const models = Array.isArray(src.models) ? [...new Set(src.models.map((m) => str(m, 120)).filter(Boolean))].slice(0, 200) : [];
  const defaultModel = str(src.defaultModel, 120);
  if (defaultModel && !models.includes(defaultModel)) models.unshift(defaultModel);
  return {
    id,
    name: str(src.name, 60) || (kind === "local" ? "\u672C\u5730 ComfyUI" : "\u4E91\u7AEF\u63A5\u53E3"),
    kind,
    baseUrl,
    defaultModel,
    models,
    enabled: src.enabled !== false,
    // 只有本地接口才带 comfy 配置；云端接口不写这段（避免 settings.json 里出现无关字段）
    comfy: kind === "local" ? defaultComfyConfig(src.comfy || src) : void 0
  };
}
function migrateV1(input) {
  const src = input && typeof input === "object" ? input : {};
  let interfaceId = "legacy";
  const iface = normalizeInterface({
    id: interfaceId,
    name: "\u65E7\u914D\u7F6E",
    kind: "cloud",
    baseUrl: src.baseUrl,
    defaultModel: src.defaultModel,
    models: src.defaultModel ? [src.defaultModel] : []
  });
  return {
    version: SETTINGS_VERSION,
    interfaces: [iface],
    defaultInterface: "",
    defaultSize: SIZE_RE.test(String(src.defaultSize || "").trim()) ? String(src.defaultSize).trim().toLowerCase() : DEFAULT_SETTINGS.defaultSize,
    defaultCount: clampInt(src.defaultCount, 1, 4, DEFAULT_SETTINGS.defaultCount),
    timeoutMs: clampInt(src.timeoutMs, 3e4, 6e5, DEFAULT_SETTINGS.timeoutMs)
  };
}
function normalizeSettings(input) {
  const src = input && typeof input === "object" ? input : {};
  const legacyShape = !Array.isArray(src.interfaces) && (src.baseUrl || src.defaultModel);
  if (legacyShape) return migrateV1(src);
  const interfaces = (Array.isArray(src.interfaces) ? src.interfaces : []).map((it) => {
    try {
      return normalizeInterface(it);
    } catch {
      return null;
    }
  }).filter(Boolean);
  const defaultInterface = interfaces.some((it) => it.id === src.defaultInterface) ? src.defaultInterface : "";
  const out = {
    version: SETTINGS_VERSION,
    interfaces,
    defaultInterface,
    defaultSize: DEFAULT_SETTINGS.defaultSize,
    defaultCount: clampInt(src.defaultCount, 1, 4, DEFAULT_SETTINGS.defaultCount),
    timeoutMs: clampInt(src.timeoutMs, 3e4, 6e5, DEFAULT_SETTINGS.timeoutMs)
  };
  if (typeof src.defaultSize === "string" && SIZE_RE.test(src.defaultSize.trim())) {
    out.defaultSize = src.defaultSize.trim().toLowerCase();
  }
  return out;
}
function readSettings(root) {
  try {
    const raw = fs2.readFileSync(settingsPath(root), "utf8");
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS, interfaces: [] };
  }
}
function writeAtomic(root, doc) {
  const dir = configDir(root);
  fs2.mkdirSync(dir, { recursive: true });
  const target = settingsPath(root);
  const tmp = `${target}.${Math.random().toString(36).slice(2)}.tmp`;
  fs2.writeFileSync(tmp, JSON.stringify(doc, null, 2), "utf8");
  fs2.renameSync(tmp, target);
}
function writeSettings(root, patch) {
  const current = readSettings(root);
  const patchObj = { ...patch && typeof patch === "object" ? patch : {} };
  const merged = normalizeSettings({ ...current, ...patchObj });
  writeAtomic(root, merged);
  return merged;
}
function upsertInterface(root, input) {
  const current = readSettings(root);
  const rawId = input && typeof input === "object" && typeof input.id === "string" ? input.id.trim() : "";
  if (rawId && !INTERFACE_ID_RE.test(rawId.toLowerCase())) {
    throw new Error(`\u63A5\u53E3 id \u975E\u6CD5\uFF1A\u300C${rawId}\u300D\u53EA\u80FD\u7528\u5C0F\u5199\u5B57\u6BCD\u3001\u6570\u5B57\u3001- \u548C _\uFF0C\u6700\u957F 24 \u4E2A\u5B57\u7B26`);
  }
  const draft = normalizeInterface(input, { requireUrl: true });
  const idx = current.interfaces.findIndex((it) => it.id === draft.id);
  const interfaces = idx >= 0 ? current.interfaces.map((it, i) => i === idx ? { ...it, ...draft } : it) : [...current.interfaces, draft];
  const next = normalizeSettings({ ...current, interfaces });
  writeAtomic(root, next);
  return next;
}
function removeInterface(root, id) {
  const current = readSettings(root);
  const target = current.interfaces.find((it) => it.id === id);
  if (!target) throw new Error("\u63A5\u53E3\u4E0D\u5B58\u5728");
  const interfaces = current.interfaces.filter((it) => it.id !== id);
  const next = normalizeSettings({
    ...current,
    interfaces,
    defaultInterface: current.defaultInterface === id ? "" : current.defaultInterface
  });
  writeAtomic(root, next);
  return { settings: next, removed: target };
}
function resolveInterface(settings, wantedId = "") {
  const list = Array.isArray(settings?.interfaces) ? settings.interfaces : [];
  const enabled = list.filter((it) => it.enabled !== false);
  const wanted = typeof wantedId === "string" ? wantedId.trim() : "";
  if (wanted) {
    const hit = list.find((it) => it.id === wanted);
    if (!hit) {
      return { interface: null, error: `\u63A5\u53E3\u4E0D\u5B58\u5728\uFF1A${wanted}\uFF08\u53EF\u5728\u9762\u677F\u8BBE\u7F6E\u91CC\u67E5\u770B\u63A5\u53E3\u5217\u8868\uFF09` };
    }
    return { interface: hit, error: "" };
  }
  if (settings?.defaultInterface) {
    const hit = list.find((it) => it.id === settings.defaultInterface);
    if (hit) return { interface: hit, error: "" };
    return { interface: null, error: "\u9ED8\u8BA4\u63A5\u53E3\u5DF2\u5931\u6548\uFF0C\u8BF7\u5728\u9762\u677F\u8BBE\u7F6E\u91CC\u91CD\u65B0\u6307\u5B9A\u9ED8\u8BA4\u63A5\u53E3" };
  }
  if (enabled.length === 1) return { interface: enabled[0], error: "" };
  if (!list.length) return { interface: null, error: "\u8FD8\u6CA1\u6709\u914D\u7F6E\u4EFB\u4F55\u63A5\u53E3\uFF1A\u8BF7\u5728\u9762\u677F\u300C\u8BBE\u7F6E \u2192 \u63A5\u53E3\u300D\u91CC\u6DFB\u52A0\u4E91\u7AEF\u63A5\u53E3\u6216\u672C\u5730 ComfyUI" };
  return { interface: null, error: "\u6CA1\u6709\u8BBE\u5B9A\u9ED8\u8BA4\u63A5\u53E3\uFF1A\u8BF7\u5728\u9762\u677F\u8BBE\u7F6E\u91CC\u624B\u52A8\u6307\u5B9A\u4E00\u4E2A\u9ED8\u8BA4\u63A5\u53E3\uFF0C\u6216\u8C03\u7528\u65F6\u7528 interface \u6307\u5B9A\u63A5\u53E3 id" };
}
function describeInterfaces(settings) {
  return (settings?.interfaces || []).map((it) => ({
    id: it.id,
    name: it.name,
    kind: it.kind,
    kindLabel: KIND_LABEL[it.kind] || it.kind,
    baseUrl: it.baseUrl,
    defaultModel: it.defaultModel,
    models: it.models,
    enabled: it.enabled,
    isDefault: settings.defaultInterface === it.id,
    workflows: it.kind === "local" ? it.comfy.workflows : void 0
  }));
}

// ../../../../.config/openchamber/extensions/image-assets/源码/共享/密钥.js
import fs3 from "node:fs";
import path3 from "node:path";
import { spawnSync } from "node:child_process";
var PREFIX = "DPAPI1:";
var PLACEHOLDER_RE = /^<|你的密钥|REPLACE|sk-xxx|changeme|placeholder/i;
var PS_PROTECT = [
  "$ErrorActionPreference='Stop'",
  "Add-Type -AssemblyName System.Security",
  "$b64=[Console]::In.ReadToEnd().Trim()",
  "if([string]::IsNullOrWhiteSpace($b64)){exit 2}",
  "$bytes=[Convert]::FromBase64String($b64)",
  "$enc=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Out.Write([Convert]::ToBase64String($enc))"
].join("; ");
var PS_UNPROTECT = [
  "$ErrorActionPreference='Stop'",
  "Add-Type -AssemblyName System.Security",
  "$b64=[Console]::In.ReadToEnd().Trim()",
  "if([string]::IsNullOrWhiteSpace($b64)){exit 2}",
  "$bytes=[Convert]::FromBase64String($b64)",
  "$dec=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Out.Write([Convert]::ToBase64String($dec))"
].join("; ");
function runPowerShell(script, stdinText) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input: stdinText,
    encoding: "utf8",
    timeout: 3e4,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  if (r.error) throw new Error(`PowerShell \u8C03\u7528\u5931\u8D25\uFF1A${r.error.message}`);
  if (r.status !== 0) {
    const detail = String(r.stderr || "").trim().split(/\r?\n/).slice(0, 2).join(" ");
    throw new Error(`DPAPI \u64CD\u4F5C\u5931\u8D25\uFF08exit ${r.status}\uFF09${detail ? "\uFF1A" + detail.slice(0, 200) : ""}`);
  }
  const out = String(r.stdout || "").trim();
  if (!out) throw new Error("DPAPI \u8FD4\u56DE\u7A7A\u7ED3\u679C");
  return out;
}
function encryptSecret(plain) {
  const b64 = Buffer.from(String(plain), "utf8").toString("base64");
  return PREFIX + runPowerShell(PS_PROTECT, b64);
}
function decryptSecret(blob) {
  const s = String(blob || "").trim();
  if (!s.startsWith(PREFIX)) throw new Error("\u5BC6\u6587\u683C\u5F0F\u4E0D\u8BA4\u8BC6\uFF08\u5E94\u4EE5 DPAPI1: \u5F00\u5934\uFF09");
  const b64 = runPowerShell(PS_UNPROTECT, s.slice(PREFIX.length));
  return Buffer.from(b64, "base64").toString("utf8");
}
function keyPath(root, id) {
  const raw = String(id || "").trim();
  if (!raw || !/^[A-Za-z0-9_-]{1,24}$/.test(raw)) throw new Error("\u63A5\u53E3 id \u975E\u6CD5\uFF08\u53EA\u5141\u8BB8\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\u4E0E\u8FDE\u5B57\u7B26\uFF09");
  return path3.join(keysDir(root), `${raw.toLowerCase()}.dat`);
}
function envNameFor(id) {
  return `IMAGE_ASSETS_KEY_${String(id || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "")}`;
}
function saveKey(root, id, plain) {
  const value = typeof plain === "string" ? plain.trim() : "";
  if (!value) throw new Error("\u5BC6\u94A5\u4E0D\u80FD\u4E3A\u7A7A");
  if (PLACEHOLDER_RE.test(value)) throw new Error("\u8FD9\u770B\u8D77\u6765\u662F\u5360\u4F4D\u7B26\uFF0C\u4E0D\u662F\u771F\u5B9E\u5BC6\u94A5");
  const blob = encryptSecret(value);
  const target = keyPath(root, id);
  fs3.mkdirSync(path3.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs3.writeFileSync(tmp, blob, "utf8");
  fs3.renameSync(tmp, target);
  return maskKey(value);
}
function readStoredKey(root, id) {
  let blob;
  try {
    blob = fs3.readFileSync(keyPath(root, id), "utf8");
  } catch {
    return "";
  }
  try {
    return decryptSecret(blob).trim();
  } catch {
    return "";
  }
}
function hasStoredKey(root, id) {
  try {
    return fs3.existsSync(keyPath(root, id));
  } catch {
    return false;
  }
}
function clearStoredKey(root, id) {
  try {
    fs3.rmSync(keyPath(root, id), { force: true });
    return true;
  } catch {
    return false;
  }
}
function maskKey(value) {
  const v = String(value || "");
  if (!v) return "";
  if (v.length <= 8) return "\u2022\u2022\u2022\u2022";
  const head = v.startsWith("sk-") ? "sk-" : "";
  return `${head}\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022${v.slice(-4)}`;
}
function checkKey(value) {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) return { ok: false, error: "\u5BC6\u94A5\u672A\u914D\u7F6E" };
  if (PLACEHOLDER_RE.test(v)) return { ok: false, error: "\u5BC6\u94A5\u4ECD\u662F\u5360\u4F4D\u7B26\uFF0C\u4E0D\u662F\u771F\u5B9E\u5BC6\u94A5" };
  if (!v.startsWith("sk-")) return { ok: true, warning: "\u5BC6\u94A5\u4E0D\u4EE5 sk- \u5F00\u5934\uFF0C\u4ECD\u6309\u539F\u503C\u4F7F\u7528" };
  return { ok: true };
}
function resolveApiKey(root, iface, env = process.env) {
  const id = typeof iface === "string" ? iface : iface?.id;
  const kind = typeof iface === "object" ? iface?.kind : void 0;
  if (kind === "local") {
    const fromPanel = readStoredKey(root, id);
    if (fromPanel) return { key: fromPanel, source: "panel", warning: "" };
    const envKey = String(env?.[envNameFor(id)] || "").trim();
    if (envKey) return { key: envKey, source: "env", warning: "" };
    return { key: "", source: "not-needed", warning: "" };
  }
  const candidates = [
    ["panel", readStoredKey(root, id)],
    ["env", String(env?.[envNameFor(id)] || "").trim()]
  ];
  let invalid = "";
  for (const [source, value] of candidates) {
    if (!value) continue;
    const verdict = checkKey(value);
    if (verdict.ok) return { key: value, source, warning: verdict.warning || "" };
    if (!invalid) invalid = verdict.error;
  }
  return {
    key: "",
    source: "none",
    error: invalid ? `${invalid}\uFF08\u8BF7\u5728\u9762\u677F\u300C\u8BBE\u7F6E \u2192 \u63A5\u53E3\u300D\u91CC\u586B\u5199\u771F\u5B9E\u5BC6\u94A5\uFF09` : `\u63A5\u53E3\u300C${typeof iface === "object" ? iface?.name || id : id}\u300D\u6CA1\u6709\u53EF\u7528\u5BC6\u94A5\uFF1A\u8BF7\u5728\u9762\u677F\u91CC\u586B\u5199\uFF0C\u6216\u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF ${envNameFor(id)}`
  };
}
var KEY_SOURCE_LABEL = {
  panel: "\u9762\u677F\u4FDD\u5B58\uFF08DPAPI \u5BC6\u6587\uFF09",
  env: "\u73AF\u5883\u53D8\u91CF",
  "not-needed": "\u672C\u5730\u63A5\u53E3\u4E0D\u9700\u8981\u5BC6\u94A5",
  none: "\u672A\u914D\u7F6E"
};
function readLegacyKey(root) {
  let blob;
  try {
    blob = fs3.readFileSync(legacyCredentialsPath(root), "utf8");
  } catch {
    return "";
  }
  try {
    return decryptSecret(blob).trim();
  } catch {
    return "";
  }
}

// ../../../../.config/openchamber/extensions/image-assets/源码/共享/迁移.js
import fs4 from "node:fs";
import path4 from "node:path";
var LEGACY_INTERFACE_ID = "legacy";
function stamp(d = /* @__PURE__ */ new Date()) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}
function readRawSettings(root) {
  try {
    return JSON.parse(fs4.readFileSync(settingsPath(root), "utf8"));
  } catch {
    return null;
  }
}
function backupV1Settings(root, d = /* @__PURE__ */ new Date()) {
  const raw = readRawSettings(root);
  if (!raw || Array.isArray(raw.interfaces)) return "";
  try {
    const dest = archiveDir(root);
    fs4.mkdirSync(dest, { recursive: true });
    const target = path4.join(dest, `settings.v1.${stamp(d)}.bak.json`);
    fs4.writeFileSync(target, JSON.stringify(raw, null, 2), "utf8");
    return target;
  } catch {
    return "";
  }
}
function backupV1Key(root, d = /* @__PURE__ */ new Date()) {
  try {
    if (!fs4.existsSync(legacyCredentialsPath(root))) return "";
    const dest = archiveDir(root);
    fs4.mkdirSync(dest, { recursive: true });
    const target = path4.join(dest, `credentials.dat.${stamp(d)}.bak`);
    fs4.renameSync(legacyCredentialsPath(root), target);
    return target;
  } catch {
    return "";
  }
}
function migrateIfNeeded(root, d = /* @__PURE__ */ new Date()) {
  const current = readSettings(root);
  const raw = readRawSettings(root);
  const alreadyV2 = raw && Array.isArray(raw.interfaces);
  const warnings = [];
  const backups = { settings: "", key: "" };
  if (alreadyV2) {
    if (fs4.existsSync(legacyCredentialsPath(root))) {
      backups.key = backupV1Key(root, d);
      if (backups.key) warnings.push("v1 \u9057\u7559\u7684 credentials.dat \u5DF2\u5F52\u6863\u5230 \u914D\u7F6E\\\u5F52\u6863\uFF08v2 \u5DF2\u6309\u63A5\u53E3\u5206\u6587\u4EF6\u4FDD\u5B58\u5BC6\u94A5\uFF09");
    }
    return { migrated: false, settings: current, interfaceId: "", keyMigrated: false, warnings, backups };
  }
  const legacyShape = raw && !Array.isArray(raw.interfaces) && (raw.baseUrl || raw.defaultModel);
  if (!legacyShape) {
    return { migrated: false, settings: current, interfaceId: "", keyMigrated: false, warnings, backups };
  }
  backups.settings = backupV1Settings(root, d);
  const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "";
  const defaultModel = typeof raw.defaultModel === "string" ? raw.defaultModel.trim() : "";
  const existing = (Array.isArray(raw?.interfaces) ? raw.interfaces : []).find((it) => it?.id === LEGACY_INTERFACE_ID);
  let settings = current;
  if (!existing) {
    if (!baseUrl) {
      warnings.push("v1 \u914D\u7F6E\u91CC\u6CA1\u6709\u63A5\u53E3\u5730\u5740\uFF0C\u65E7\u914D\u7F6E\u63A5\u53E3\u88AB\u8DF3\u8FC7\uFF08\u6CA1\u6709\u751F\u6210\u4EFB\u4F55\u63A5\u53E3\uFF09");
    } else {
      const models = Array.isArray(raw.models) && raw.models.length ? raw.models : defaultModel ? [defaultModel] : [];
      const kept = current.interfaces.filter((it) => it.id !== LEGACY_INTERFACE_ID);
      settings = writeSettings(root, {
        interfaces: [
          ...kept,
          {
            id: LEGACY_INTERFACE_ID,
            name: "\u65E7\u914D\u7F6E",
            kind: "cloud",
            baseUrl,
            defaultModel,
            models,
            enabled: true
          }
        ],
        // 迁移过来的接口不设为默认：defaultInterface 保持空
        defaultInterface: "",
        defaultSize: current.defaultSize,
        defaultCount: current.defaultCount,
        timeoutMs: current.timeoutMs
      });
    }
  }
  let keyMigrated = false;
  const legacyKey = readLegacyKey(root);
  if (legacyKey) {
    try {
      if (!fs4.existsSync(keyPath(root, LEGACY_INTERFACE_ID))) {
        saveKey(root, LEGACY_INTERFACE_ID, legacyKey);
        keyMigrated = true;
      }
    } catch (err) {
      warnings.push(`\u65E7\u5BC6\u94A5\u8FC1\u79FB\u5931\u8D25\uFF08${err.message}\uFF09\uFF1A\u65E7\u6587\u4EF6\u4FDD\u7559\u5728 \u914D\u7F6E\\credentials.dat\uFF0C\u53EF\u5728\u9762\u677F\u91CD\u65B0\u586B\u5199`);
    }
  }
  if (fs4.existsSync(legacyCredentialsPath(root)) && (keyMigrated || !legacyKey)) {
    backups.key = backupV1Key(root, d);
    if (!keyMigrated && !legacyKey) {
      warnings.push("\u65E7\u5BC6\u94A5\u65E0\u6CD5\u89E3\u5BC6\uFF08\u53EF\u80FD\u6362\u4E86 Windows \u7528\u6237\u6216\u7CFB\u7EDF\uFF09\uFF0C\u5DF2\u5F52\u6863\u65E7\u6587\u4EF6\uFF1B\u8BF7\u5728\u9762\u677F\u91CD\u65B0\u586B\u5199\u5BC6\u94A5");
    }
  }
  if (settings.defaultInterface) {
    warnings.push("\u8FC1\u79FB\u540E\u7684\u9ED8\u8BA4\u63A5\u53E3\u5DF2\u5931\u6548\uFF0C\u5DF2\u5728\u8BBE\u7F6E\u91CC\u6E05\u7A7A\uFF1A\u8BF7\u624B\u52A8\u6307\u5B9A\u9ED8\u8BA4\u63A5\u53E3");
  }
  return { migrated: true, settings: readSettings(root), interfaceId: LEGACY_INTERFACE_ID, keyMigrated, warnings, backups };
}

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
var IMAGE_RE = /image|flux|dall|imagine|sdxl|sd-|playground|nano-banana|seedream|kolors|wanx/i;
function capsFor(id) {
  const key = String(id || "").trim();
  const found = MODEL_CAPS[key];
  if (found) return { id: key, known: true, ...found };
  return {
    id: key,
    known: false,
    text2img: null,
    img2img: null,
    transparent: null,
    honorsSize: null,
    note: "\u672A\u767B\u8BB0\u7684\u6A21\u578B\uFF0C\u80FD\u529B\u672A\u77E5"
  };
}
function pickImageModelIds(payload) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  const ids = list.map((m) => typeof m === "string" ? m : m?.id).filter((id) => typeof id === "string" && (MODEL_CAPS[id] || IMAGE_RE.test(id)));
  return [...new Set(ids)];
}
function describeModels(payload) {
  return pickImageModelIds(payload).map((id) => capsFor(id)).sort((a, b) => Number(b.known) - Number(a.known) || a.id.localeCompare(b.id));
}

// ../../../../.config/openchamber/extensions/image-assets/源码/共享/生成.js
var MAX_REFERENCES = 4;
var MAX_COUNT = 4;
var GEN_TIMEOUT_MS = 3e5;
var SIZE_RE2 = /^(\d{3,5})x(\d{3,5})$/i;
var MIME_BY_EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
function validateSize(size, fallback = "1024x1536") {
  const raw = typeof size === "string" ? size.trim().toLowerCase() : "";
  const m = raw.match(SIZE_RE2);
  if (!m) return fallback;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w < 256 || h < 256 || w > 4096 || h > 4096) return fallback;
  return `${w}x${h}`;
}
function mimeForName(name) {
  const ext = String(name || "").split(".").pop().toLowerCase();
  return MIME_BY_EXT[ext] || "image/png";
}
function endpointFor(images) {
  return Array.isArray(images) && images.length ? "/images/edits" : "/images/generations";
}
function mapHttpError(status, endpoint = "/images/generations", bodyText = "") {
  const snippet = String(bodyText || "").replace(/\s+/g, " ").trim().slice(0, 300);
  const tail = snippet ? `\uFF1B\u54CD\u5E94\u7247\u6BB5\uFF1A${snippet}` : "\uFF08\u54CD\u5E94\u4F53\u4E3A\u7A7A\uFF09";
  const where = endpoint === "/images/edits" ? "\u53C2\u8003\u56FE\u751F\u56FE" : "\u6587\u751F\u56FE";
  switch (status) {
    case 400:
      return `${where}\u88AB\u62D2\uFF08HTTP 400\uFF09\uFF1A\u591A\u4E3A\u56FE\u7247\u683C\u5F0F/\u4F53\u79EF\u4E0D\u88AB\u63A5\u53D7\u6216\u53C2\u6570\u7EC4\u5408\u975E\u6CD5${tail}`;
    case 401:
    case 403:
      return `${where}\u5BC6\u94A5\u88AB\u62D2\u7EDD\uFF08HTTP ${status}\uFF09\uFF1A\u8BF7\u5728\u6269\u5C55\u8BBE\u7F6E\u91CC\u68C0\u67E5\u5BC6\u94A5${tail}`;
    case 404:
      return `${where}\u63A5\u53E3\u4E0D\u5B58\u5728\uFF08HTTP 404\uFF09\uFF1A\u8BF7\u68C0\u67E5 API \u5730\u5740\u662F\u5426\u6B63\u786E${tail}`;
    case 413:
      return `${where}\u8BF7\u6C42\u4F53\u8FC7\u5927\uFF08HTTP 413\uFF09\uFF1A\u53C2\u8003\u56FE\u8BF7\u538B\u5230 10MB \u4EE5\u5185${tail}`;
    case 429:
      return `${where}\u89E6\u53D1\u9650\u6D41\uFF08HTTP 429\uFF09\uFF1A\u7A0D\u540E\u518D\u8BD5${tail}`;
    case 500:
    case 502:
    case 503:
    case 504:
      return `${where}\u4E0A\u6E38\u5931\u8D25\uFF08HTTP ${status}\uFF09\uFF1A\u7F51\u5173\u6216\u6A21\u578B\u4FA7\u9519\u8BEF\uFF0C\u4E0E\u672C\u5730\u53C2\u6570\u65E0\u5173${tail}`;
    default:
      return `${where}\u5931\u8D25\uFF08HTTP ${status}\uFF09${tail}`;
  }
}
async function requestImages(opts, onProgress) {
  const {
    baseUrl,
    apiKey,
    model,
    prompt,
    size,
    count = 1,
    images = [],
    transparent = false
  } = opts;
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : GEN_TIMEOUT_MS;
  const base2 = String(baseUrl || "").replace(/\/+$/, "");
  if (!base2) throw new Error("API \u5730\u5740\u672A\u914D\u7F6E");
  if (!apiKey) throw new Error("\u5BC6\u94A5\u672A\u914D\u7F6E");
  const text = typeof prompt === "string" ? prompt.trim() : "";
  if (!text) throw new Error("\u63D0\u793A\u8BCD\u4E0D\u80FD\u4E3A\u7A7A");
  const endpoint = endpointFor(images);
  const requestedSize = validateSize(size);
  const n = Math.min(MAX_COUNT, Math.max(1, Math.round(Number(count) || 1)));
  const warnings = [];
  if (images.length && images.length > MAX_REFERENCES) {
    throw new Error(`\u53C2\u8003\u56FE\u6700\u591A ${MAX_REFERENCES} \u5F20`);
  }
  if (images.length && transparent) {
    warnings.push("\u53C2\u8003\u56FE\u6A21\u5F0F\u4E0B\u672A\u4F20\u900F\u660E\u80CC\u666F\u53C2\u6570\uFF08\u8BE5\u7EC4\u5408\u5C1A\u672A\u9A8C\u8BC1\uFF09\uFF0C\u51FA\u56FE\u53EF\u80FD\u4E0D\u662F\u900F\u660E\u5E95");
  }
  const trans = (label) => {
    try {
      const r = onProgress?.(label);
      if (r && typeof r.then === "function") r.catch(() => {
      });
    } catch {
    }
  };
  trans(images.length ? `\u63D0\u4EA4\u53C2\u8003\u56FE\u751F\u56FE\uFF08${images.length} \u5F20\u53C2\u8003\u56FE\uFF09\u2026` : "\u63D0\u4EA4\u6587\u751F\u56FE\u8BF7\u6C42\u2026");
  let res;
  try {
    if (endpoint === "/images/edits") {
      const fd = new FormData();
      fd.set("model", model);
      fd.set("prompt", text);
      fd.set("size", requestedSize);
      fd.set("n", String(n));
      for (const [i, img] of images.entries()) {
        const bytes = Buffer.isBuffer(img.bytes) ? img.bytes : Buffer.from(img.bytes);
        fd.append("image", new Blob([bytes], { type: img.mime || mimeForName(img.name) }), img.name || `ref-${i + 1}.png`);
      }
      res = await fetch(`${base2}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } else {
      const body = { model, prompt: text, n, size: requestedSize };
      if (transparent) {
        body.background = "transparent";
        body.output_format = "png";
      }
      res = await fetch(`${base2}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    }
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error(`\u751F\u6210\u8D85\u65F6\uFF08${Math.round(timeoutMs / 1e3)}s\uFF09\uFF1A\u7F51\u5173\u672A\u5728\u65F6\u9650\u5185\u8FD4\u56DE`);
    }
    throw new Error(`\u7F51\u7EDC\u9519\u8BEF\uFF1A${err?.message || err}`);
  }
  const bodyText = await res.text();
  if (!res.ok) throw new Error(mapHttpError(res.status, endpoint, bodyText));
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new Error(`\u54CD\u5E94\u4E0D\u662F JSON\uFF1A${bodyText.slice(0, 200)}`);
  }
  const items = Array.isArray(parsed?.data) ? parsed.data : [];
  if (!items.length) throw new Error("\u54CD\u5E94\u91CC\u6CA1\u6709\u56FE\u7247\u6570\u636E");
  trans("\u4E0B\u8F7D\u56FE\u7247\u2026");
  const results = [];
  for (const item of items) {
    if (item?.b64_json) {
      results.push({ bytes: Buffer.from(String(item.b64_json).replace(/\s/g, ""), "base64"), mode: "b64" });
      continue;
    }
    if (item?.url) {
      const bytes = await downloadImage(item.url, timeoutMs);
      results.push({ bytes, mode: "url" });
      continue;
    }
    throw new Error("\u54CD\u5E94\u7F3A\u5C11 b64_json \u4E0E url");
  }
  return {
    endpoint,
    requestedSize,
    results,
    usage: parsed?.usage && typeof parsed.usage === "object" ? parsed.usage : null,
    warnings,
    model,
    prompt: text,
    count: n
  };
}
async function downloadImage(url, timeoutMs = 12e4) {
  if (!/^https?:\/\//i.test(String(url))) throw new Error("\u56FE\u7247\u5730\u5740\u4E0D\u662F http(s)");
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw new Error("\u4E0B\u8F7D\u56FE\u7247\u8D85\u65F6");
    throw new Error(`\u4E0B\u8F7D\u56FE\u7247\u5931\u8D25\uFF1A${err?.message || err}`);
  }
  if (!res.ok) throw new Error(`\u4E0B\u8F7D\u56FE\u7247 HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function fetchModels({ baseUrl, apiKey, timeoutMs = 3e4 }) {
  const base2 = String(baseUrl || "").replace(/\/+$/, "");
  if (!base2) throw new Error("API \u5730\u5740\u672A\u914D\u7F6E");
  if (!apiKey) throw new Error("\u5BC6\u94A5\u672A\u914D\u7F6E");
  let res;
  try {
    res = await fetch(`${base2}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw new Error("\u6A21\u578B\u6E05\u5355\u8BF7\u6C42\u8D85\u65F6");
    throw new Error(`\u6A21\u578B\u6E05\u5355\u4E0D\u53EF\u8FBE\uFF1A${err?.message || err}`);
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new Error(`\u5BC6\u94A5\u88AB\u62D2\u7EDD\uFF08HTTP ${res.status}\uFF09`);
  if (!res.ok) throw new Error(`\u6A21\u578B\u6E05\u5355\u67E5\u8BE2\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("\u6A21\u578B\u6E05\u5355\u54CD\u5E94\u65E0\u6CD5\u89E3\u6790");
  }
}

// ../../../../.config/openchamber/extensions/image-assets/源码/共享/工作流.js
import fs5 from "node:fs";
import path5 from "node:path";
var SLOTS = ["t2i", "i2i", "video"];
var SLOT_LABEL = { t2i: "\u6587\u751F\u56FE", i2i: "\u56FE\u751F\u56FE", video: "\u89C6\u9891" };
var BUNDLED = {
  t2i: "t2i_moss_sft.api.json",
  i2i: "i2i_moss_sft.api.json",
  video: ""
};
function bundledDir(extRoot) {
  return path5.join(extRoot, "\u5DE5\u4F5C\u6D41");
}
function templatePath(extRoot, slot, customPath) {
  const custom = typeof customPath === "string" ? customPath.trim() : "";
  if (custom) {
    return { path: custom, source: "custom", exists: fs5.existsSync(custom) };
  }
  const name = BUNDLED[slot];
  if (!name) return { path: "", source: "none", exists: false };
  const p = path5.join(bundledDir(extRoot), name);
  return { path: p, source: "bundled", exists: fs5.existsSync(p) };
}
function loadTemplate(extRoot, slot, customPath) {
  const resolved = templatePath(extRoot, slot, customPath);
  if (!resolved.path) {
    throw new Error(`\u8FD8\u6CA1\u6709\u914D\u7F6E${SLOT_LABEL[slot]}\u5DE5\u4F5C\u6D41\uFF1A\u8BF7\u5728\u9762\u677F\u300C\u8BBE\u7F6E \u2192 \u63A5\u53E3\u300D\u91CC\u4E3A\u672C\u5730\u63A5\u53E3\u6307\u5B9A${SLOT_LABEL[slot]}\u6A21\u677F\u8DEF\u5F84\uFF08\u6216\u628A\u6A21\u677F\u653E\u5230\u6269\u5C55\u7684 \u5DE5\u4F5C\u6D41/ \u76EE\u5F55\uFF09`);
  }
  if (!resolved.exists) {
    throw new Error(`${SLOT_LABEL[slot]}\u5DE5\u4F5C\u6D41\u6A21\u677F\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A${resolved.path}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs5.readFileSync(resolved.path, "utf8"));
  } catch (err) {
    throw new Error(`${SLOT_LABEL[slot]}\u5DE5\u4F5C\u6D41\u6A21\u677F\u65E0\u6CD5\u89E3\u6790\uFF08\u9700\u8981 ComfyUI API \u683C\u5F0F JSON\uFF09\uFF1A${err.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${SLOT_LABEL[slot]}\u5DE5\u4F5C\u6D41\u6A21\u677F\u683C\u5F0F\u4E0D\u5BF9\uFF1A\u5E94\u662F\u300C\u8282\u70B9 id \u2192 {class_type, inputs}\u300D\u7684\u5BF9\u8C61`);
  }
  const nodeIds = Object.keys(parsed);
  if (!nodeIds.length) throw new Error(`${SLOT_LABEL[slot]}\u5DE5\u4F5C\u6D41\u6A21\u677F\u91CC\u6CA1\u6709\u4EFB\u4F55\u8282\u70B9`);
  const hasOutput = nodeIds.some((id) => ["SaveImage", "SaveAnimatedWEBP", "VHS_VideoCombine"].includes(parsed[id]?.class_type));
  if (!hasOutput) throw new Error(`${SLOT_LABEL[slot]}\u5DE5\u4F5C\u6D41\u6A21\u677F\u91CC\u6CA1\u6709 SaveImage \u7C7B\u8F93\u51FA\u8282\u70B9\uFF0C\u8DD1\u5B8C\u62FF\u4E0D\u5230\u56FE`);
  return { template: parsed, path: resolved.path, source: resolved.source, slot };
}
function describeTemplate(extRoot, slot, customPath) {
  const resolved = templatePath(extRoot, slot, customPath);
  const out = {
    slot,
    label: SLOT_LABEL[slot],
    path: resolved.path,
    source: resolved.source,
    exists: resolved.exists,
    nodes: 0,
    classes: [],
    error: ""
  };
  if (!resolved.path || !resolved.exists) {
    out.error = resolved.path ? "\u6587\u4EF6\u4E0D\u5B58\u5728" : "\u672A\u914D\u7F6E";
    return out;
  }
  try {
    const tpl = JSON.parse(fs5.readFileSync(resolved.path, "utf8"));
    out.nodes = Object.keys(tpl).length;
    out.classes = [...new Set(Object.values(tpl).map((n) => n?.class_type).filter(Boolean))];
  } catch (err) {
    out.error = err.message;
  }
  return out;
}

// ../../../../.config/openchamber/extensions/image-assets/源码/共享/ComfyUI.js
import crypto2 from "node:crypto";
var DEFAULT_COMFY_URL2 = "http://127.0.0.1:8188";
var COMFY_TIMEOUT_MS = 9e5;
var COMFY_POLL_MS = 1500;
var COMFY_ASPECTS = [
  { label: "1:1", value: "1:1 (Square)", w: 1, h: 1 },
  { label: "2:3", value: "2:3 (Portrait Photo)", w: 2, h: 3 },
  { label: "3:2", value: "3:2 (Photo)", w: 3, h: 2 },
  { label: "3:4", value: "3:4 (Portrait Standard)", w: 3, h: 4 },
  { label: "4:3", value: "4:3 (Standard)", w: 4, h: 3 },
  { label: "9:16", value: "9:16 (Portrait Widescreen)", w: 9, h: 16 },
  { label: "16:9", value: "16:9 (Widescreen)", w: 16, h: 9 },
  { label: "21:9", value: "21:9 (Ultrawide)", w: 21, h: 9 }
];
var RATIO_RE = /^(\d{3,5})x(\d{3,5})$/i;
function base(url) {
  const raw = String(url || "").trim().replace(/\/+$/, "");
  return raw || DEFAULT_COMFY_URL2;
}
async function callJson(url, opts = {}, timeoutMs = 3e4) {
  let res;
  try {
    res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error(`ComfyUI \u65E0\u54CD\u5E94\uFF08${Math.round(timeoutMs / 1e3)}s \u8D85\u65F6\uFF09\uFF1A\u8BF7\u786E\u8BA4\u672C\u5730 ComfyUI \u5DF2\u542F\u52A8`);
    }
    const detail = err?.cause?.code || err?.message || err;
    throw new Error(`\u8FDE\u4E0D\u4E0A\u672C\u5730 ComfyUI\uFF08${detail}\uFF09\uFF1A\u8BF7\u786E\u8BA4 ComfyUI \u6B63\u5728 ${url.replace(/\/[^/]+$/, "")} \u8FD0\u884C`);
  }
  const text = await res.text();
  if (!res.ok) {
    let hint = "";
    try {
      const parsed = JSON.parse(text);
      hint = parsed?.error?.message || parsed?.error || "";
      if (parsed?.node_errors && Object.keys(parsed.node_errors).length) {
        const first = Object.values(parsed.node_errors)[0];
        hint = hint || first?.errors?.[0]?.message || JSON.stringify(first).slice(0, 300);
      }
    } catch {
    }
    throw new Error(`ComfyUI \u8FD4\u56DE HTTP ${res.status}${hint ? `\uFF1A${String(hint).slice(0, 400)}` : text ? `\uFF1A${text.slice(0, 300)}` : ""}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`ComfyUI \u54CD\u5E94\u4E0D\u662F JSON\uFF1A${text.slice(0, 200)}`);
  }
}
async function comfyStats(baseUrl, timeoutMs = 8e3) {
  const d = await callJson(`${base(baseUrl)}/system_stats`, {}, timeoutMs);
  return {
    version: d?.system?.comfyui_version || "",
    python: d?.system?.python_version || "",
    devices: Array.isArray(d?.devices) ? d.devices.map((x) => x.name).filter(Boolean) : []
  };
}
async function comfyModels(baseUrl, timeoutMs = 3e4) {
  const info = await callJson(`${base(baseUrl)}/object_info`, {}, timeoutMs);
  const combo = (cls, field) => {
    const spec = info?.[cls]?.input?.required?.[field] ?? info?.[cls]?.input?.optional?.[field];
    const options = spec?.[0];
    return Array.isArray(options) ? options.filter((x) => typeof x === "string") : [];
  };
  return {
    unets: combo("UNETLoader", "unet_name"),
    clips: combo("CLIPLoader", "clip_name"),
    vaes: combo("VAELoader", "vae_name"),
    loras: combo("LoraLoaderModelOnly", "lora_name")
  };
}
function aspectForSize(size) {
  const m = String(size || "").trim().match(RATIO_RE);
  if (!m) return { aspect: COMFY_ASPECTS[0].value, megapixels: 1 };
  const w = Number(m[1]);
  const h = Number(m[2]);
  const target = w / h;
  let best = COMFY_ASPECTS[0];
  let diff = Infinity;
  for (const a of COMFY_ASPECTS) {
    const d = Math.abs(a.w / a.h - target);
    if (d < diff) {
      diff = d;
      best = a;
    }
  }
  const mp = Math.round(w * h / 1048576 * 100) / 100;
  return { aspect: best.value, megapixels: Math.min(16, Math.max(0.1, mp || 1)) };
}
function randomSeed() {
  return crypto2.randomInt(1, 2 ** 48);
}
async function comfyUploadImage(baseUrl, { bytes, name = "ref.png", subfolder = "openchamber", timeoutMs = 12e4 } = {}) {
  if (!bytes || !bytes.length) throw new Error("\u53C2\u8003\u56FE\u4E3A\u7A7A");
  const fd = new FormData();
  fd.set("image", new Blob([Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)], { type: "image/png" }), name);
  fd.set("subfolder", subfolder);
  fd.set("overwrite", "true");
  const d = await callJson(`${base(baseUrl)}/upload/image`, { method: "POST", body: fd }, timeoutMs);
  if (!d?.name) throw new Error("ComfyUI \u4E0A\u4F20\u63A5\u53E3\u6CA1\u6709\u8FD4\u56DE\u6587\u4EF6\u540D");
  return d.subfolder ? `${String(d.subfolder).replace(/\\/g, "/")}/${d.name}` : d.name;
}
function patchTemplate(template, opts = {}) {
  const tpl = JSON.parse(JSON.stringify(template && typeof template === "object" ? template : {}));
  const ids = Object.keys(tpl);
  const withClass = (cls) => ids.filter((id) => tpl[id]?.class_type === cls);
  const first = (cls) => withClass(cls)[0];
  const warnings = [];
  const num = (v) => {
    if (v === void 0 || v === null) return null;
    if (typeof v === "string" && !v.trim()) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const {
    prompt,
    negative,
    size,
    seed,
    steps,
    cfg,
    sampler,
    scheduler,
    unet,
    clip,
    vae,
    lora,
    imageName,
    prefix,
    denoise
  } = opts;
  if (typeof prompt === "string" && prompt.trim()) {
    const prims = withClass("PrimitiveStringMultiline");
    const target = prims[0];
    if (target) tpl[target].inputs.value = prompt.trim();
  }
  if (typeof negative === "string") {
    for (const id of withClass("CLIPTextEncode")) {
      const inp = tpl[id].inputs;
      if (inp && typeof inp.text === "string") inp.text = negative;
    }
  }
  const samplerNode = first("KSampler");
  if (samplerNode) {
    const inp = tpl[samplerNode].inputs;
    const seedNum = num(seed);
    const stepsNum = num(steps);
    const cfgNum = num(cfg);
    if (seedNum !== null) inp.seed = Math.round(seedNum);
    if (stepsNum !== null && inp.steps !== void 0) inp.steps = Math.round(stepsNum);
    if (cfgNum !== null && inp.cfg !== void 0) inp.cfg = cfgNum;
    if (typeof sampler === "string" && sampler.trim() && inp.sampler_name !== void 0) inp.sampler_name = sampler.trim();
    if (typeof scheduler === "string" && scheduler.trim() && inp.scheduler !== void 0) inp.scheduler = scheduler.trim();
    if (typeof denoise === "number" && inp.denoise !== void 0) inp.denoise = denoise;
  }
  const resNode = first("ResolutionSelector");
  if (resNode) {
    const inp = tpl[resNode].inputs;
    const derived = aspectForSize(size);
    inp.aspect_ratio = typeof opts.aspect === "string" && opts.aspect.trim() ? opts.aspect.trim() : derived.aspect;
    const mp = num(opts.megapixels);
    if (inp.megapixels !== void 0) inp.megapixels = mp === null ? derived.megapixels : mp;
  }
  const unetNode = first("UNETLoader");
  if (unetNode && typeof unet === "string" && unet.trim()) tpl[unetNode].inputs.unet_name = unet.trim();
  const clipNode = first("CLIPLoader");
  if (clipNode && typeof clip === "string" && clip.trim()) tpl[clipNode].inputs.clip_name = clip.trim();
  const vaeNode = first("VAELoader");
  if (vaeNode && typeof vae === "string" && vae.trim()) tpl[vaeNode].inputs.vae_name = vae.trim();
  const loraNode = first("LoraLoaderModelOnly");
  if (loraNode) {
    if (typeof lora === "string" && lora.trim()) tpl[loraNode].inputs.lora_name = lora.trim();
  } else if (typeof lora === "string" && lora.trim()) {
    warnings.push("\u6A21\u677F\u91CC\u6CA1\u6709 LoRA \u8282\u70B9\uFF0Clora \u53C2\u6570\u88AB\u5FFD\u7565");
  }
  if (typeof imageName === "string" && imageName.trim()) {
    const loadNode = first("LoadImage");
    if (loadNode) {
      tpl[loadNode].inputs.image = imageName.trim();
    } else {
      warnings.push("\u6A21\u677F\u91CC\u6CA1\u6709 LoadImage \u8282\u70B9\uFF0C\u65E0\u6CD5\u63A5\u53C2\u8003\u56FE");
    }
    const textGen = first("TextGenerate");
    if (textGen && loadNode) tpl[textGen].inputs.image = [loadNode, 0];
  }
  if (typeof prefix === "string" && prefix.trim()) {
    for (const id of withClass("SaveImage")) tpl[id].inputs.filename_prefix = prefix.trim();
  } else {
    for (const id of withClass("SaveImage")) {
      const cur = tpl[id].inputs.filename_prefix;
      if (typeof cur === "string") tpl[id].inputs.filename_prefix = cur.replace(/[^\w.-]/g, "") || "openchamber";
    }
  }
  return { template: tpl, warnings };
}
async function comfySubmit(baseUrl, apiPrompt, { clientId, timeoutMs = 3e4 } = {}) {
  const d = await callJson(`${base(baseUrl)}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: apiPrompt, client_id: clientId || crypto2.randomUUID() })
  }, timeoutMs);
  if (d?.node_errors && Object.keys(d.node_errors).length) {
    const firstErr = Object.values(d.node_errors)[0];
    const msg = firstErr?.errors?.[0]?.message || firstErr?.errors?.[0]?.details || "\u6A21\u677F\u53C2\u6570\u88AB\u62D2\u7EDD";
    throw new Error(`ComfyUI \u62D2\u7EDD\u4E86\u5DE5\u4F5C\u6D41\uFF1A${String(msg).slice(0, 400)}`);
  }
  if (!d?.prompt_id) throw new Error("ComfyUI \u6CA1\u6709\u8FD4\u56DE prompt_id");
  return d.prompt_id;
}
async function comfyDownload(baseUrl, { filename, subfolder = "", type = "output" }, timeoutMs = 12e4) {
  const qs = new URLSearchParams({ filename, subfolder, type });
  let res;
  try {
    res = await fetch(`${base(baseUrl)}/view?${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw new Error("\u4E0B\u8F7D ComfyUI \u8F93\u51FA\u56FE\u8D85\u65F6");
    throw new Error(`\u4E0B\u8F7D ComfyUI \u8F93\u51FA\u56FE\u5931\u8D25\uFF1A${err?.message || err}`);
  }
  if (!res.ok) throw new Error(`\u4E0B\u8F7D ComfyUI \u8F93\u51FA\u56FE HTTP ${res.status}\uFF08${filename}\uFF09`);
  return Buffer.from(await res.arrayBuffer());
}
async function comfyWait(baseUrl, promptId, { timeoutMs = COMFY_TIMEOUT_MS, pollMs = COMFY_POLL_MS, onProgress } = {}) {
  const started = Date.now();
  let queueMisses = 0;
  const report = (text) => {
    try {
      const r = onProgress?.(text);
      if (r && typeof r.then === "function") r.catch(() => {
      });
    } catch {
    }
  };
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    let entry = null;
    try {
      const h = await callJson(`${base(baseUrl)}/history/${promptId}`, {}, 2e4);
      entry = h?.[promptId] || null;
    } catch {
    }
    if (entry) {
      const status = entry.status?.status_str || "success";
      if (status === "error") {
        const msgs = entry.status?.messages || [];
        const failMsg = msgs.flatMap((m) => Array.isArray(m) && m[1]?.message ? [m[1].message] : []).slice(-2).join("\uFF1B");
        throw new Error(`ComfyUI \u6267\u884C\u5931\u8D25${failMsg ? `\uFF1A${failMsg}` : "\uFF08\u65E0\u9519\u8BEF\u8BE6\u60C5\uFF0C\u8BF7\u770B ComfyUI \u63A7\u5236\u53F0\uFF09"}`);
      }
      const images = [];
      for (const out of Object.values(entry.outputs || {})) {
        for (const img of out?.images || []) {
          if (img?.filename) images.push({ filename: img.filename, subfolder: img.subfolder || "", type: img.type || "output" });
        }
      }
      if (images.length) return { images, status };
      throw new Error("ComfyUI \u6267\u884C\u5B8C\u6210\u4F46\u6CA1\u6709\u8F93\u51FA\u56FE\u7247\uFF1A\u8BF7\u68C0\u67E5\u6A21\u677F\u91CC\u662F\u5426\u6709 SaveImage \u8282\u70B9");
    }
    try {
      const q = await callJson(`${base(baseUrl)}/queue`, {}, 15e3);
      const running = Array.isArray(q?.queue_running) ? q.queue_running : [];
      const pending = Array.isArray(q?.queue_pending) ? q.queue_pending : [];
      const stillThere = [...running, ...pending].some((item) => Array.isArray(item) && item[1] === promptId);
      if (!stillThere) {
        queueMisses++;
        if (queueMisses >= 2) throw new Error("ComfyUI \u961F\u5217\u91CC\u627E\u4E0D\u5230\u8BE5\u4EFB\u52A1\uFF1A\u53EF\u80FD\u88AB\u4E2D\u65AD\u6216 ComfyUI \u91CD\u542F\u8FC7");
      } else {
        queueMisses = 0;
        const elapsed = Math.round((Date.now() - started) / 1e3);
        const pos = pending.findIndex((item) => Array.isArray(item) && item[1] === promptId);
        report(pos > 0 ? `\u6392\u961F\u4E2D\uFF08\u524D\u9762\u8FD8\u6709 ${pos} \u4E2A\u4EFB\u52A1\uFF09\uFF0C\u5DF2\u7B49\u5F85 ${elapsed}s` : `\u672C\u5730\u751F\u6210\u4E2D\uFF0C\u5DF2\u7B49\u5F85 ${elapsed}s`);
      }
    } catch (err) {
      if (String(err?.message || "").includes("\u961F\u5217\u91CC\u627E\u4E0D\u5230")) throw err;
    }
  }
  throw new Error(`ComfyUI \u751F\u6210\u8D85\u65F6\uFF08${Math.round(timeoutMs / 1e3)}s\uFF09\uFF1A\u53EF\u8C03\u5927\u8BBE\u7F6E\u91CC\u7684\u8D85\u65F6\u65F6\u95F4\uFF0C\u6216\u68C0\u67E5\u663E\u5B58\u662F\u5426\u591F\u7528`);
}
async function runComfyWorkflow({ baseUrl, template, patch, timeoutMs, pollMs, onProgress }) {
  if (!template || typeof template !== "object" || !Object.keys(template).length) {
    throw new Error("\u5DE5\u4F5C\u6D41\u6A21\u677F\u4E3A\u7A7A");
  }
  const { template: apiPrompt, warnings } = patchTemplate(template, patch);
  onProgress?.("\u63D0\u4EA4\u5230\u672C\u5730 ComfyUI\u2026");
  const promptId = await comfySubmit(baseUrl, apiPrompt);
  const done = await comfyWait(baseUrl, promptId, { timeoutMs, pollMs, onProgress });
  onProgress?.("\u4E0B\u8F7D\u672C\u5730\u8F93\u51FA\u2026");
  const images = [];
  for (const img of done.images) {
    images.push(await comfyDownload(baseUrl, img));
  }
  return { images, promptId, warnings };
}

// ../../../../.config/openchamber/extensions/image-assets/源码/共享/统一生成.js
function emptyResult(patch = {}) {
  return {
    endpoint: "",
    requestedSize: "",
    model: "",
    prompt: "",
    results: [],
    warnings: [],
    usage: null,
    ...patch
  };
}
function pickSlot(iface, images, explicit) {
  if (explicit === "t2i" || explicit === "i2i" || explicit === "video") return explicit;
  if (iface?.kind === "local") return images?.length ? "i2i" : "t2i";
  return "";
}
async function generateWithInterface(opts, onProgress) {
  const {
    iface,
    apiKey,
    extRoot,
    prompt,
    images = [],
    transparent = false
  } = opts;
  if (!iface || typeof iface !== "object") throw new Error("\u63A5\u53E3\u672A\u914D\u7F6E");
  const text = typeof prompt === "string" ? prompt.trim() : "";
  if (!text) throw new Error("\u63D0\u793A\u8BCD\u4E0D\u80FD\u4E3A\u7A7A");
  if (images.length > MAX_REFERENCES) throw new Error(`\u53C2\u8003\u56FE\u6700\u591A ${MAX_REFERENCES} \u5F20\uFF08\u6536\u5230 ${images.length} \u5F20\uFF09`);
  const size = validateSize(opts.size || "", "1024x1536");
  const count = Math.min(MAX_COUNT, Math.max(1, Math.round(Number(opts.count) || 1)));
  if (iface.kind === "local") {
    return generateLocal({ ...opts, iface, prompt: text, size, count, images }, onProgress);
  }
  return generateCloud({ ...opts, iface, apiKey, prompt: text, size, count, images, transparent }, onProgress);
}
async function generateCloud(opts, onProgress) {
  const { iface, apiKey, prompt, size, count, images, transparent } = opts;
  const model = typeof opts.model === "string" && opts.model.trim() ? opts.model.trim() : iface.defaultModel || "";
  if (!model) throw new Error(`\u63A5\u53E3\u300C${iface.name || iface.id}\u300D\u6CA1\u6709\u8BBE\u7F6E\u9ED8\u8BA4\u6A21\u578B\uFF1A\u8BF7\u5728\u9762\u677F\u91CC\u586B\u5199\uFF0C\u6216\u8C03\u7528\u65F6\u7528 model \u6307\u5B9A`);
  const out = await requestImages({
    baseUrl: iface.baseUrl,
    apiKey,
    model,
    prompt,
    size,
    count,
    images,
    transparent,
    timeoutMs: iface.timeoutMs || opts.timeoutMs
  }, onProgress);
  return emptyResult({
    endpoint: out.endpoint,
    requestedSize: out.requestedSize,
    model: out.model,
    prompt: out.prompt,
    results: out.results,
    warnings: out.warnings,
    usage: out.usage,
    count: out.count
  });
}
async function generateLocal(opts, onProgress) {
  const { iface, extRoot, prompt, size, count, images } = opts;
  const comfy = iface.comfy || {};
  const slot = pickSlot(iface, images, opts.slot);
  if (slot === "video" && !comfy.workflows?.video) {
    throw new Error(
      "\u89C6\u9891\u751F\u6210\u8FD8\u6CA1\u6709\u53EF\u7528\u5DE5\u4F5C\u6D41\uFF1A\u672C\u673A\u672A\u5B89\u88C5\u4EFB\u4F55\u89C6\u9891\u6A21\u578B\uFF088GB \u663E\u5B58\uFF09\uFF0C\u8BF7\u5728\u9762\u677F\u300C\u8BBE\u7F6E \u2192 \u63A5\u53E3 \u2192 \u672C\u5730 ComfyUI\u300D\u91CC\u586B\u5165\u89C6\u9891\u5DE5\u4F5C\u6D41\u6A21\u677F\u8DEF\u5F84\u540E\u518D\u7528"
    );
  }
  if (count > 1) {
    onProgress?.(`\u672C\u5730\u6A21\u677F\u4E00\u6B21\u8F93\u51FA 1 \u5F20\uFF0C\u5FFD\u7565 count=${count}`);
  }
  const warnings = [];
  const loaded = loadTemplate(extRoot, slot, comfy.workflows?.[slot]);
  const baseUrl = iface.baseUrl;
  let imageName = "";
  if (images.length) {
    onProgress?.("\u4E0A\u4F20\u53C2\u8003\u56FE\u5230 ComfyUI\u2026");
    const ref = images[0];
    const ext = ref.name && /\.(png|jpe?g|webp)$/i.test(ref.name) ? ref.name.split(".").pop().toLowerCase() : "png";
    imageName = await comfyUploadImage(baseUrl, {
      bytes: ref.bytes,
      name: `ref-${Date.now().toString(36)}.${ext}`
    });
    if (images.length > 1) warnings.push(`\u672C\u5730\u5DE5\u4F5C\u6D41\u53EA\u4F7F\u7528\u7B2C 1 \u5F20\u53C2\u8003\u56FE\uFF08\u6536\u5230 ${images.length} \u5F20\uFF09`);
  }
  const { megapixels } = aspectForSize(size);
  const seed = randomSeed();
  const out = await runComfyWorkflow({
    baseUrl,
    template: loaded.template,
    patch: {
      prompt,
      negative: comfy.negative || "",
      size,
      megapixels,
      seed,
      steps: comfy.steps,
      cfg: comfy.cfg,
      sampler: comfy.sampler,
      scheduler: comfy.scheduler,
      clip: comfy.clip,
      vae: comfy.vae,
      lora: comfy.lora,
      imageName,
      prefix: `openchamber/${slot}`
    },
    timeoutMs: comfy.timeoutMs || opts.timeoutMs,
    pollMs: comfy.pollMs,
    onProgress
  });
  warnings.push(...out.warnings || []);
  const unetId = Object.keys(loaded.template).find((id) => loaded.template[id]?.class_type === "UNETLoader");
  const unetName = unetId ? loaded.template[unetId]?.inputs?.unet_name : "";
  const model = `ComfyUI \xB7 ${unetName || "\u672C\u5730\u5DE5\u4F5C\u6D41"}`;
  return emptyResult({
    endpoint: `comfyui:${slot}`,
    requestedSize: size,
    model,
    prompt,
    results: out.images.map((bytes) => ({ bytes })),
    warnings,
    promptId: out.promptId,
    templatePath: loaded.path,
    slot
  });
}

// ../../../../.config/openchamber/extensions/image-assets/源码/service/main.js
var HERE = path6.dirname(fileURLToPath(import.meta.url));
var EXT_ROOT = path6.resolve(HERE, "..");
var PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT || 0);
var TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN || "";
var MAX_BODY = 1024 * 1024;
var WATCH_INTERVAL_MS = 2e3;
var JOB_KEEP = 30;
var library = resolveLibraryRoot();
var ROOT = library.root;
var paths = ensureLibrary(ROOT);
var bootMigration = { migrated: false, warnings: [], backups: {} };
function applyMigration(root) {
  try {
    return migrateIfNeeded(root);
  } catch (err) {
    return { migrated: false, warnings: [`\u8FC1\u79FB\u5931\u8D25\uFF1A${err?.message || err}`], backups: {} };
  }
}
bootMigration = applyMigration(ROOT);
function reloadLibrary(explicitRoot = "") {
  const next = resolveLibraryRoot({ explicit: explicitRoot });
  ROOT = next.root;
  library = next;
  paths = ensureLibrary(ROOT);
  bootMigration = applyMigration(ROOT);
  resetWatchSignature();
  return next;
}
var serviceHost = null;
try {
  serviceHost = createServiceHost({ env: process.env });
} catch {
  serviceHost = null;
}
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}
function bearerOk(header) {
  if (!TOKEN) return false;
  const expected = crypto3.createHash("sha256").update(`Bearer ${TOKEN}`).digest();
  const given = crypto3.createHash("sha256").update(String(header || "")).digest();
  return crypto3.timingSafeEqual(expected, given);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error("body \u4E0D\u662F\u5408\u6CD5 JSON");
  }
}
function mimeFor(file) {
  return file.endsWith(".png") ? "image/png" : file.endsWith(".jpg") || file.endsWith(".jpeg") ? "image/jpeg" : "application/octet-stream";
}
function indexSignature() {
  try {
    const names = fs6.readdirSync(paths.index);
    let sig = String(names.length);
    for (const n of names) {
      const st = fs6.statSync(path6.join(paths.index, n));
      sig += `|${n}:${st.mtimeMs}:${st.size}`;
    }
    return sig;
  } catch {
    return "unreadable";
  }
}
async function emit(topic, data) {
  if (!serviceHost) return;
  try {
    await serviceHost.emit(topic, { at: Date.now(), ...data });
  } catch {
  }
}
var emitChange = (detail) => emit("assets-changed", detail);
function keyView(iface) {
  const resolved = resolveApiKey(ROOT, iface);
  return {
    hasKey: Boolean(resolved.key),
    masked: resolved.key ? maskKey(resolved.key) : "",
    source: resolved.source,
    sourceLabel: KEY_SOURCE_LABEL[resolved.source] || resolved.source,
    stored: hasStoredKey(ROOT, iface.id),
    envName: envNameFor(iface.id),
    error: resolved.error || "",
    warning: resolved.warning || ""
  };
}
function templateViews(iface) {
  if (!iface || iface.kind !== "local") return [];
  return SLOTS.map((slot) => describeTemplate(EXT_ROOT, slot, iface.comfy?.workflows?.[slot]));
}
function configView() {
  const settings = readSettings(ROOT);
  const list = describeInterfaces(settings).map((it) => {
    const iface = settings.interfaces.find((x) => x.id === it.id) || it;
    return {
      ...it,
      key: keyView(settings.interfaces.find((x) => x.id === it.id)),
      comfy: iface.kind === "local" ? iface.comfy : void 0,
      templates: templateViews(iface)
    };
  });
  return {
    settings: {
      ...settings,
      interfaces: void 0
      // 接口在下面单独的字段里，避免两套结构
    },
    interfaces: list,
    defaultInterface: settings.defaultInterface,
    kinds: INTERFACE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
    comfyAspects: COMFY_ASPECTS.map((a) => ({ label: a.label, value: a.value })),
    workflowSlots: SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s] })),
    migration: bootMigration.migrated ? { ran: true, warnings: bootMigration.warnings, backups: bootMigration.backups } : bootMigration.warnings?.length ? { ran: false, warnings: bootMigration.warnings, backups: bootMigration.backups } : null,
    root: ROOT,
    rootSource: library.source,
    rootInfo: {
      source: library.source,
      custom: library.custom,
      envRoot: library.envRoot,
      defaultRoot: library.defaultRoot,
      locatorPath: locatorPath(),
      updatedAt: library.updatedAt,
      // 环境变量在时不建议在面板里改路径：改了也不生效
      locked: library.source === "env",
      pendingMove: pendingMove(ROOT)
    }
  };
}
var jobs = /* @__PURE__ */ new Map();
function newJobId() {
  return crypto3.randomBytes(6).toString("hex");
}
function pruneJobs() {
  while (jobs.size > JOB_KEEP) {
    const oldest = [...jobs.values()].sort((a, b) => a.startedAt - b.startedAt)[0];
    if (!oldest) break;
    jobs.delete(oldest.id);
  }
}
function activeJobCount() {
  let n = 0;
  for (const job of jobs.values()) {
    if (job.status === "done" || job.status === "error") continue;
    n += 1;
  }
  return n;
}
function readReference(id) {
  const rec = findAsset(ROOT, id);
  if (!rec) throw new Error(`\u53C2\u8003\u56FE\u8D44\u4EA7\u4E0D\u5B58\u5728\uFF1A${id}`);
  const abs = insideLibrary(ROOT, rec.file);
  if (!abs) throw new Error("\u53C2\u8003\u56FE\u8DEF\u5F84\u8D8A\u754C");
  const bytes = fs6.readFileSync(abs);
  return { bytes, name: path6.basename(rec.file), mime: mimeFor(rec.file), id: rec.id, file: rec.file };
}
async function runJob(job, input) {
  const settings = readSettings(ROOT);
  const step = async (phase, pct) => {
    job.phase = phase;
    job.pct = pct;
    await emit("generate-progress", { jobId: job.id, phase, pct });
  };
  try {
    const wanted = typeof input.interfaceId === "string" ? input.interfaceId : typeof input.interface === "string" ? input.interface : "";
    const picked = resolveInterface(settings, wanted);
    if (!picked.interface) throw new Error(picked.error);
    const iface = picked.interface;
    job.interfaceId = iface.id;
    const resolved = resolveApiKey(ROOT, iface);
    if (iface.kind === "cloud" && !resolved.key) throw new Error(resolved.error || "\u5BC6\u94A5\u672A\u914D\u7F6E");
    await step("\u51C6\u5907\u53C2\u8003\u56FE\u2026", 5);
    const references = (Array.isArray(input.references) ? input.references : []).slice(0, MAX_REFERENCES);
    const images = references.map((r) => readReference(typeof r === "string" ? r : r.id));
    const size = validateSize(input.size || settings.defaultSize, settings.defaultSize);
    const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : iface.defaultModel;
    const count = iface.kind === "local" ? 1 : Math.min(4, Math.max(1, Number(input.count) || settings.defaultCount || 1));
    const slot = typeof input.slot === "string" ? input.slot : "";
    await step(iface.kind === "local" ? "\u63D0\u4EA4\u672C\u5730 ComfyUI\uFF08\u5355\u6B21\uFF0C\u4E0D\u81EA\u52A8\u91CD\u8BD5\uFF09\u2026" : "\u8BF7\u6C42\u751F\u6210\uFF08\u5355\u6B21\uFF0C\u4E0D\u81EA\u52A8\u91CD\u8BD5\uFF09\u2026", 15);
    const out = await generateWithInterface({
      iface,
      apiKey: resolved.key,
      extRoot: EXT_ROOT,
      prompt: input.prompt,
      size,
      count,
      images,
      transparent: Boolean(input.transparent),
      model,
      slot
    }, (phase) => {
      void step(phase, 45);
    });
    await step("\u6821\u9A8C\u5E76\u5165\u5E93\u2026", 85);
    const saved = [];
    for (const result of out.results) {
      const info = sniffImage(result.bytes);
      if (!info) throw new Error("\u8FD4\u56DE\u7684\u5185\u5BB9\u4E0D\u662F\u6709\u6548 PNG/JPEG\uFF0C\u672A\u5165\u5E93");
      const record = saveAsset(ROOT, result.bytes, {
        prompt: out.prompt,
        model: out.model,
        apiSize: out.requestedSize,
        requestedSize: out.requestedSize,
        width: info.width,
        height: info.height,
        format: info.type,
        alpha: info.type === "png",
        source: iface.kind === "local" ? "comfyui" : "cloud",
        interfaceId: iface.id,
        interfaceName: iface.name,
        interfaceKind: iface.kind,
        baseUrl: iface.baseUrl,
        endpoint: out.endpoint,
        workflow: out.slot || "",
        referenceIds: images.map((i) => i.id).filter(Boolean),
        usage: out.usage,
        sessionId: input.sessionId || null,
        sessionTitle: input.sessionTitle || null,
        projectDirectory: input.projectDirectory || null,
        tags: Array.isArray(input.tags) ? input.tags : [],
        note: typeof input.note === "string" ? input.note : ""
      });
      saved.push({ id: record.id, file: record.file, width: info.width, height: info.height, bytes: record.bytes });
    }
    job.status = "done";
    job.pct = 100;
    job.phase = "\u5B8C\u6210";
    job.result = {
      assets: saved,
      warnings: out.warnings,
      usage: out.usage,
      endpoint: out.endpoint,
      model: out.model,
      interfaceId: iface.id,
      interfaceName: iface.name
    };
    job.finishedAt = Date.now();
    await emit("generate-done", { jobId: job.id, ok: true, assets: saved });
    void emitChange({ reason: "generate" });
  } catch (err) {
    job.status = "error";
    job.pct = 100;
    job.phase = "\u5931\u8D25";
    job.error = String(err?.message || err);
    job.finishedAt = Date.now();
    await emit("generate-done", { jobId: job.id, ok: false, error: job.error });
  }
}
var server = http.createServer(async (req, res) => {
  if (!bearerOk(req.headers.authorization)) {
    json(res, 401, { error: "unauthorized" });
    return;
  }
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const seg = url.pathname.split("/").filter(Boolean);
    const segDecoded = seg.map((s) => decodeURIComponent(s));
    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/config") {
      json(res, 200, configView());
      return;
    }
    if (req.method === "POST" && url.pathname === "/config") {
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        json(res, 400, { error: err.message });
        return;
      }
      try {
        const patch = {};
        for (const k of ["defaultInterface", "defaultSize", "defaultCount", "timeoutMs"]) {
          if (body[k] !== void 0) patch[k] = body[k];
        }
        if (Object.keys(patch).length) writeSettings(ROOT, patch);
      } catch (err) {
        json(res, 400, { error: String(err?.message || err) });
        return;
      }
      void emit("config-changed", { reason: "settings" });
      json(res, 200, configView());
      return;
    }
    if (req.method === "GET" && url.pathname === "/interfaces") {
      json(res, 200, configView());
      return;
    }
    if (req.method === "POST" && url.pathname === "/root/check") {
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        json(res, 400, { error: err.message });
        return;
      }
      const verdict = validateLibraryRoot(body?.root, { env: process.env, currentRoot: ROOT, extRoot: EXT_ROOT });
      json(res, 200, verdict);
      return;
    }
    if (req.method === "POST" && url.pathname === "/root") {
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        json(res, 400, { error: err.message });
        return;
      }
      if (library.source === "env") {
        json(res, 400, { error: "\u5F53\u524D\u88AB\u73AF\u5883\u53D8\u91CF IMAGE_ASSETS_ROOT \u8986\u76D6\uFF1A\u9762\u677F\u4FDD\u5B58\u4E0D\u4F1A\u751F\u6548\uFF0C\u5148\u6E05\u6389\u8FD9\u4E2A\u73AF\u5883\u53D8\u91CF" });
        return;
      }
      if (activeJobCount() > 0) {
        json(res, 409, { error: "\u8FD8\u6709\u751F\u6210\u4EFB\u52A1\u5728\u8DD1\uFF1A\u7B49\u5B83\u7ED3\u675F\u518D\u5207\u6362\u8D44\u4EA7\u5E93\uFF0C\u907F\u514D\u65B0\u56FE\u5199\u8FDB\u534A\u9014\u7684\u5E93" });
        return;
      }
      const verdict = validateLibraryRoot(body?.root, { env: process.env, currentRoot: ROOT, extRoot: EXT_ROOT });
      if (!verdict.ok) {
        json(res, 400, { error: verdict.error });
        return;
      }
      const migrate = body?.migrate !== false;
      const from = ROOT;
      let moved = null;
      try {
        if (migrate) {
          moved = moveLibrary(from, verdict.root);
        } else {
          ensureLibrary(verdict.root);
        }
        writeLocator(verdict.root);
      } catch (err) {
        json(res, 500, { error: `\u5207\u6362\u5931\u8D25\uFF1A${String(err?.message || err)}` });
        return;
      }
      const next = reloadLibrary();
      void emit("config-changed", { reason: "root", root: next.root });
      json(res, 200, { ...configView(), moved });
      return;
    }
    if (req.method === "POST" && url.pathname === "/root/reset") {
      if (activeJobCount() > 0) {
        json(res, 409, { error: "\u8FD8\u6709\u751F\u6210\u4EFB\u52A1\u5728\u8DD1\uFF1A\u7B49\u5B83\u7ED3\u675F\u518D\u5207\u6362\u8D44\u4EA7\u5E93" });
        return;
      }
      clearLocator();
      const next = reloadLibrary();
      void emit("config-changed", { reason: "root", root: next.root });
      json(res, 200, configView());
      return;
    }
    if (req.method === "POST" && url.pathname === "/interfaces") {
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        json(res, 400, { error: err.message });
        return;
      }
      const draft = body.interface && typeof body.interface === "object" ? body.interface : body;
      try {
        const settings = upsertInterface(ROOT, draft);
        const savedIface = settings.interfaces.find((it) => it.id === normalizeInterface(draft).id) || settings.interfaces.find((it) => it.name === draft.name);
        if (typeof body.apiKey === "string" && body.apiKey.trim() && savedIface) {
          saveKey(ROOT, savedIface.id, body.apiKey);
        }
        void emit("config-changed", { reason: "interface-saved" });
        json(res, 200, configView());
      } catch (err) {
        json(res, 400, { error: String(err?.message || err) });
      }
      return;
    }
    if (req.method === "POST" && seg[0] === "interfaces" && seg.length === 3 && seg[2] === "delete") {
      try {
        const { removed } = removeInterface(ROOT, segDecoded[1]);
        if (hasStoredKey(ROOT, removed.id)) clearStoredKey(ROOT, removed.id);
        void emit("config-changed", { reason: "interface-deleted" });
        json(res, 200, { ...configView(), removed: removed.id });
      } catch (err) {
        json(res, 400, { error: String(err?.message || err) });
      }
      return;
    }
    if (req.method === "POST" && seg[0] === "interfaces" && seg.length === 3 && seg[2] === "default") {
      try {
        const settings = readSettings(ROOT);
        const hit = settings.interfaces.find((it) => it.id === segDecoded[1]);
        if (!hit) {
          json(res, 404, { error: "\u63A5\u53E3\u4E0D\u5B58\u5728" });
          return;
        }
        writeSettings(ROOT, { defaultInterface: hit.id });
        void emit("config-changed", { reason: "default-interface" });
        json(res, 200, configView());
      } catch (err) {
        json(res, 400, { error: String(err?.message || err) });
      }
      return;
    }
    if (req.method === "POST" && seg[0] === "interfaces" && seg.length === 3 && seg[2] === "key") {
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        json(res, 400, { error: err.message });
        return;
      }
      const id = segDecoded[1];
      const settings = readSettings(ROOT);
      if (!settings.interfaces.some((it) => it.id === id)) {
        json(res, 404, { error: "\u63A5\u53E3\u4E0D\u5B58\u5728" });
        return;
      }
      try {
        if (body.clear === true) clearStoredKey(ROOT, id);
        else if (typeof body.apiKey === "string" && body.apiKey.trim()) saveKey(ROOT, id, body.apiKey);
        else {
          json(res, 400, { error: "\u7F3A\u5C11 apiKey \u6216 clear" });
          return;
        }
      } catch (err) {
        json(res, 400, { error: String(err?.message || err) });
        return;
      }
      void emit("config-changed", { reason: body.clear === true ? "interface-key-cleared" : "interface-key-saved" });
      json(res, 200, configView());
      return;
    }
    if (req.method === "POST" && url.pathname === "/config/key/clear") {
      const settings = readSettings(ROOT);
      let cleared = false;
      for (const it of settings.interfaces) {
        if (hasStoredKey(ROOT, it.id)) cleared = clearStoredKey(ROOT, it.id) || cleared;
      }
      void emit("config-changed", { reason: "key-cleared" });
      json(res, 200, { cleared, ...configView() });
      return;
    }
    if (req.method === "POST" && seg[0] === "interfaces" && seg.length === 3 && seg[2] === "test") {
      let body = {};
      try {
        body = await readJson(req);
      } catch (err) {
        json(res, 400, { error: err.message });
        return;
      }
      const id = segDecoded[1];
      const settings = readSettings(ROOT);
      const saved = settings.interfaces.find((it) => it.id === id);
      const draft = saved ? normalizeInterface({ ...saved, ...body.interface || {} }) : normalizeInterface({ ...body.interface || {}, id });
      const key = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : resolveApiKey(ROOT, saved || draft).key;
      try {
        if (draft.kind === "local") {
          const stats = await comfyStats(draft.baseUrl);
          const models2 = await comfyModels(draft.baseUrl);
          json(res, 200, { ok: true, kind: "local", stats, models: models2, hasKey: Boolean(key) });
          return;
        }
        if (!key) {
          json(res, 200, { ok: false, kind: "cloud", error: "\u6CA1\u6709\u53EF\u7528\u5BC6\u94A5" });
          return;
        }
        const payload = await fetchModels({ baseUrl: draft.baseUrl, apiKey: key });
        const models = describeModels(payload);
        json(res, 200, {
          ok: true,
          kind: "cloud",
          total: Array.isArray(payload?.data) ? payload.data.length : 0,
          models,
          hasDefault: models.some((m) => m.id === draft.defaultModel)
        });
      } catch (err) {
        json(res, 200, { ok: false, kind: draft.kind, error: String(err?.message || err) });
      }
      return;
    }
    if (req.method === "GET" && url.pathname === "/models") {
      const settings = readSettings(ROOT);
      const id = url.searchParams.get("interface") || "";
      const picked = resolveInterface(settings, id);
      if (!picked.interface) {
        json(res, 200, { ok: false, error: picked.error, models: describeModels(null), manual: [] });
        return;
      }
      const iface = picked.interface;
      const manual = iface.models || [];
      if (iface.kind === "local") {
        try {
          const m = await comfyModels(iface.baseUrl);
          json(res, 200, {
            ok: true,
            kind: "local",
            interfaceId: iface.id,
            manual,
            defaultModel: iface.defaultModel,
            local: m,
            models: [
              ...m.unets.map((x) => ({ id: x, known: true, group: "\u6269\u6563\u6A21\u578B", note: "\u6765\u81EA ComfyUI object_info" })),
              ...m.loras.map((x) => ({ id: x, known: false, group: "LoRA", note: "" })),
              ...m.clips.map((x) => ({ id: x, known: false, group: "\u6587\u672C\u7F16\u7801\u5668", note: "" })),
              ...m.vaes.map((x) => ({ id: x, known: false, group: "VAE", note: "" }))
            ],
            templates: templateViews(iface)
          });
        } catch (err) {
          json(res, 200, {
            ok: false,
            kind: "local",
            error: String(err?.message || err),
            interfaceId: iface.id,
            manual,
            defaultModel: iface.defaultModel,
            models: manual.map((x) => ({ id: x, known: true, note: "\u624B\u52A8\u586B\u5199" })),
            templates: templateViews(iface)
          });
        }
        return;
      }
      const key = resolveApiKey(ROOT, iface).key;
      if (!key) {
        json(res, 200, {
          ok: false,
          kind: "cloud",
          error: "\u6CA1\u6709\u53EF\u7528\u5BC6\u94A5",
          interfaceId: iface.id,
          defaultModel: iface.defaultModel,
          manual,
          models: manual.map((x) => ({ id: x, known: true, note: "\u624B\u52A8\u586B\u5199" }))
        });
        return;
      }
      try {
        const payload = await fetchModels({ baseUrl: iface.baseUrl, apiKey: key });
        const fetched = describeModels(payload);
        const byId = new Map(fetched.map((m) => [m.id, m]));
        for (const x of manual) if (!byId.has(x)) byId.set(x, { id: x, known: true, note: "\u624B\u52A8\u586B\u5199" });
        json(res, 200, {
          ok: true,
          kind: "cloud",
          interfaceId: iface.id,
          defaultModel: iface.defaultModel,
          manual,
          total: Array.isArray(payload?.data) ? payload.data.length : 0,
          models: [...byId.values()]
        });
      } catch (err) {
        json(res, 200, {
          ok: false,
          kind: "cloud",
          error: String(err?.message || err),
          interfaceId: iface.id,
          defaultModel: iface.defaultModel,
          manual,
          models: manual.map((x) => ({ id: x, known: true, note: "\u624B\u52A8\u586B\u5199" }))
        });
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/generate") {
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        json(res, 400, { error: err.message });
        return;
      }
      if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
        json(res, 400, { error: "prompt \u4E0D\u80FD\u4E3A\u7A7A" });
        return;
      }
      const job = {
        id: newJobId(),
        status: "running",
        phase: "\u6392\u961F",
        pct: 0,
        startedAt: Date.now(),
        prompt: body.prompt.trim()
      };
      jobs.set(job.id, job);
      pruneJobs();
      void emit("generate-progress", { jobId: job.id, phase: job.phase, pct: 0 });
      void runJob(job, body);
      json(res, 202, { jobId: job.id });
      return;
    }
    if (req.method === "GET" && seg[0] === "generate" && seg.length === 2) {
      const job = jobs.get(seg[1]);
      if (!job) {
        json(res, 404, { error: "\u4EFB\u52A1\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F" });
        return;
      }
      json(res, 200, job);
      return;
    }
    if (req.method === "GET" && seg[0] === "caps" && seg.length === 2) {
      json(res, 200, capsFor(segDecoded[1]));
      return;
    }
    if (req.method === "GET" && seg[0] === "assets" && seg.length === 1) {
      const { assets, warnings } = scanAssets(ROOT);
      const filtered = filterAssets(assets, {
        sessionId: url.searchParams.get("sessionId") || void 0,
        q: url.searchParams.get("q") || void 0,
        tag: url.searchParams.get("tag") || void 0
      });
      json(res, 200, { assets: filtered, total: assets.length, warnings, root: ROOT });
      return;
    }
    if (req.method === "GET" && seg[0] === "assets" && seg.length === 3 && seg[2] === "file") {
      const rec = findAsset(ROOT, seg[1]);
      if (!rec) {
        json(res, 404, { error: "\u8D44\u4EA7\u4E0D\u5B58\u5728" });
        return;
      }
      const abs = path6.join(ROOT, rec.file);
      if (!abs.startsWith(paths.root + path6.sep)) {
        json(res, 400, { error: "file \u8D8A\u754C" });
        return;
      }
      let bytes;
      try {
        bytes = fs6.readFileSync(abs);
      } catch {
        json(res, 404, { error: "\u56FE\u7247\u6587\u4EF6\u7F3A\u5931" });
        return;
      }
      if (bytes.length > FILE_MB_LIMIT * 1024 * 1024) {
        json(res, 413, { error: `\u56FE\u7247 ${(bytes.length / 1048576).toFixed(1)}MB \u8D85\u8FC7\u5355\u6B21\u56DE\u4F20\u4E0A\u9650\uFF0C\u8BF7\u6253\u5F00\u6587\u4EF6\u67E5\u770B\uFF1A${abs}` });
        return;
      }
      const info = sniffImage(bytes);
      json(res, 200, {
        id: rec.id,
        mime: mimeFor(rec.file),
        width: info ? info.width : rec.width,
        height: info ? info.height : rec.height,
        bytes: bytes.length,
        base64: bytes.toString("base64")
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/library-file") {
      const rel = url.searchParams.get("path") || "";
      if (!/^(运行时\\参考\\|图片\\)/.test(rel)) {
        json(res, 400, { error: "\u8DEF\u5F84\u4E0D\u5728\u5141\u8BB8\u8303\u56F4" });
        return;
      }
      const abs = insideLibrary(ROOT, rel);
      if (!abs) {
        json(res, 400, { error: "\u8DEF\u5F84\u8D8A\u754C" });
        return;
      }
      let bytes;
      try {
        bytes = fs6.readFileSync(abs);
      } catch {
        json(res, 404, { error: "\u6587\u4EF6\u7F3A\u5931" });
        return;
      }
      if (bytes.length > FILE_MB_LIMIT * 1024 * 1024) {
        json(res, 413, { error: "\u53C2\u8003\u56FE\u8FC7\u5927\uFF0C\u65E0\u6CD5\u56DE\u4F20" });
        return;
      }
      json(res, 200, {
        mime: mimeFor(abs),
        bytes: bytes.length,
        base64: bytes.toString("base64")
      });
      return;
    }
    if (req.method === "POST" && seg[0] === "assets" && seg.length === 3 && seg[2] === "annotate") {
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        json(res, 400, { error: err.message });
        return;
      }
      try {
        const asset = annotateAsset(ROOT, seg[1], body);
        void emitChange({ reason: "annotate", id: asset.id });
        json(res, 200, { asset });
      } catch (err) {
        json(res, 404, { error: err.message });
      }
      return;
    }
    if (req.method === "POST" && seg[0] === "assets" && seg.length === 3 && seg[2] === "delete") {
      try {
        const result = deleteAsset(ROOT, seg[1]);
        void emitChange({ reason: "delete", id: seg[1] });
        json(res, 200, result);
      } catch (err) {
        json(res, 404, { error: err.message });
      }
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: String(err?.message || err) });
  }
});
server.listen(PORT, "127.0.0.1", () => {
  const addr = server.address();
  console.log(`[image-assets] service listening on 127.0.0.1:${addr.port}, root=${ROOT}`);
});
var lastSig = indexSignature();
function resetWatchSignature() {
  lastSig = indexSignature();
}
var timer = setInterval(() => {
  const sig = indexSignature();
  if (sig !== lastSig) {
    lastSig = sig;
    void emitChange({ reason: "scan" });
  }
}, WATCH_INTERVAL_MS);
process.on("SIGTERM", () => {
  clearInterval(timer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3e3).unref();
});
export {
  EXT_ROOT,
  defaultComfyConfig
};
