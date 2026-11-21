#!/usr/bin/env node
// 仓库自检：清单字段、入口文件、语法、以及 v2.1.1 的修复是否还在构建产物里。
// 用法：node tools/check.mjs        （在仓库根执行）
// 退出码：0 通过；1 失败。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const fail = [];
const ok = [];
const rel = (p) => path.relative(root, p).replaceAll("\\", "/");

const must = (cond, message) => {
  if (cond) ok.push(message);
  else fail.push(message);
};

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    fail.push(`JSON 解析失败: ${rel(file)} — ${err.message}`);
    return null;
  }
};

const exists = (p) => fs.existsSync(path.join(root, p));

// 1. package.json
const pkg = readJson(path.join(root, "package.json"));
if (pkg) {
  must(pkg.name === "openchamber-image-assets", "name = openchamber-image-assets");
  must(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version || ""), `version 是 semver（当前 ${pkg.version}）`);
  must(pkg.type === "module", "type = module");
  must(pkg.openchamber?.apiVersion === 1, "openchamber.apiVersion = 1");
  must(Boolean(pkg.openchamber?.engines?.openchamber), "openchamber.engines.openchamber 存在");
  must(pkg.openchamber?.contributes?.panel?.id === "image-assets", "panel.id = image-assets");
  must(
    (pkg.openchamber?.contributes?.tools ?? []).some((t) => t.match === "image_assets_generate"),
    "声明 image_assets_generate 工具",
  );
}

// 2. 入口文件存在
const panelEntry = pkg?.openchamber?.contributes?.panel?.entry;
const serviceEntry = pkg?.openchamber?.contributes?.service?.entry;
const pluginEntry = pkg?.openchamber?.contributes?.opencodePlugin;
must(Boolean(panelEntry && exists(panelEntry)), `面板入口存在（${panelEntry}）`);
must(Boolean(serviceEntry && exists(serviceEntry)), `服务入口存在（${serviceEntry}）`);
must(Boolean(pluginEntry && exists(pluginEntry)), `插件目录存在（${pluginEntry}）`);
must(exists("icon.svg"), "icon.svg 存在");

// 3. 语法（只检查 JS 入口；面板入口是 html，取其 script src）
const panelScript = (() => {
  if (!panelEntry) return null;
  const abs = path.join(root, panelEntry);
  if (/\.(js|mjs)$/i.test(panelEntry)) return panelEntry;
  if (!/\.html?$/i.test(panelEntry) || !fs.existsSync(abs)) return null;
  const html = fs.readFileSync(abs, "utf8");
  const match = html.match(/<script[^>]+src=["']([^"']+\.m?js)["']/i);
  if (!match) return null;
  return path.join(path.dirname(panelEntry), match[1]).replaceAll("\\", "/");
})();

const syntaxTargets = [
  panelScript,
  /\.(js|mjs)$/i.test(serviceEntry || "") ? serviceEntry : null,
  pluginEntry && path.join(pluginEntry, "index.js"),
].filter(Boolean);
for (const target of syntaxTargets) {
  const r = spawnSync(process.execPath, ["--check", path.join(root, target)], { encoding: "utf8" });
  must(r.status === 0, `语法检查通过: ${target}${r.status === 0 ? "" : `\n${(r.stderr || "").split("\n").slice(0, 4).join("\n")}`}`);
}

// 4. v2.1.1 回归守卫：面板 POST body 必须是 JSON 字符串
const panelFile = panelScript ? path.join(root, panelScript) : null;
if (panelFile && fs.existsSync(panelFile)) {
  const text = fs.readFileSync(panelFile, "utf8");
  must(
    text.includes('typeof body === "string" ? body : JSON.stringify(body)'),
    "面板 svc() 仍把 body 序列化为 JSON 字符串（v2.1.1 修复未被覆盖）",
  );
} else {
  fail.push("找不到面板脚本，无法确认 v2.1.1 修复");
}

// 5. 多接口回归守卫（v2.2.0）
const sharedDir = path.join(root, "源码", "共享");
const sharedFiles = fs.existsSync(sharedDir) ? fs.readdirSync(sharedDir) : [];
for (const name of ["配置.js", "密钥.js", "迁移.js", "ComfyUI.js", "工作流.js", "统一生成.js"]) {
  must(sharedFiles.includes(name), `共享模块存在: 源码/共享/${name}`);
}
const pluginShared = path.join(root, "plugin", "shared");
must(fs.existsSync(path.join(pluginShared, "统一生成.js")), "plugin/shared 已同步统一生成.js（构建产物）");

const settingsSrc = fs.existsSync(path.join(sharedDir, "配置.js"))
  ? fs.readFileSync(path.join(sharedDir, "配置.js"), "utf8")
  : "";
must(!/https?:\/\/(?!127\.0\.0\.1|localhost)[A-Za-z0-9.-]+\/[A-Za-z0-9/._-]*api/i.test(settingsSrc), "配置默认值里不再硬编码任何外部服务商端点");
must(settingsSrc.includes("defaultInterface"), "配置里有手动默认接口字段");
must(/interfaces:\s*\[\]/.test(settingsSrc), "新装默认没有预置接口");
must(settingsSrc.includes("libraryRoot"), "资产库根目录由 libraryRoot 派生，不写死机器路径");

const keySrc = fs.existsSync(path.join(sharedDir, "密钥.js"))
  ? fs.readFileSync(path.join(sharedDir, "密钥.js"), "utf8")
  : "";
must(keySrc.includes("IMAGE_ASSETS_KEY_"), "密钥支持按接口的环境变量兜底");
must(!/_\s*API_KEY/.test(keySrc), "密钥模块不再引用任何服务商的专用环境变量");

// 工作流模板：本地 ComfyUI 必需，且必须是 API 格式（节点 id → {class_type, inputs}）
const workflowDir = path.join(root, "工作流");
const bundled = ["t2i_moss_sft.api.json", "i2i_moss_sft.api.json"];
for (const name of bundled) {
  const file = path.join(workflowDir, name);
  if (!fs.existsSync(file)) {
    fail.push(`工作流模板缺失: 工作流/${name}`);
    continue;
  }
  const tpl = readJson(file);
  const ids = tpl ? Object.keys(tpl) : [];
  must(ids.length > 0, `工作流 ${name} 有节点`);
  const nodes = ids.map((id) => tpl[id] || {});
  must(nodes.every((n) => n.class_type && n.inputs), `工作流 ${name} 是 API 格式（class_type + inputs）`);
  must(nodes.some((n) => n.class_type === "SaveImage"), `工作流 ${name} 含 SaveImage 输出`);
  if (name.startsWith("i2i")) {
    must(nodes.some((n) => n.class_type === "LoadImage"), `工作流 ${name} 含 LoadImage（参考图入口）`);
  }
}

// 7. 公开仓库卫生：不提交本机绝对路径、个人邮箱与真实密钥形态
const SECRET_PATTERNS = [
  [/sk-[A-Za-z0-9_-]{16,}/, "疑似真实 sk- 密钥"],
  [/ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}/, "疑似 GitHub token"],
  [/AKIA[0-9A-Z]{16}/, "疑似 AWS key"],
  [/Bearer [A-Za-z0-9._-]{16,}/, "疑似 Bearer 实值"],
  [/DPAPI1:[A-Za-z0-9+/=]{20,}/, "疑似 DPAPI 密文"],
];
const LOCAL_PATH_RES = [
  [/C:\\?Users\\?(?!<|\$|你的|用户名|you|name|user)[A-Za-z0-9._-]{2,}/, "本机用户目录绝对路径"],
  [/D:\\?AppData/, "本机绝对路径"],
  [/D:\\?Users\\?(?!<)[A-Za-z0-9._-]{2,}/, "本机绝对路径"],
  [/[A-Za-z0-9._%+-]+@gmail\.com/i, "个人邮箱"],
];
// 测试桩里的假密钥：形状对但值明显是测试用
const FAKE_SECRET_RE = /sk-(test|verify|dryrun|abc|second|from|legacy|panel|cynabcdef|real|xxx|fake|example)/i;

function textFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".build-env", "工作流"].includes(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) textFiles(p, out);
    else if (/\.(mjs|js|json|md|yml|yaml|html|txt)$/i.test(entry.name)) out.push(p);
  }
  return out;
}
for (const file of textFiles(root)) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  if (rel === "tools/check.mjs") continue; // 本文件就是规则本身
  const text = fs.readFileSync(file, "utf8");
  for (const [re, label] of SECRET_PATTERNS) {
    const m = text.match(re);
    if (m && !FAKE_SECRET_RE.test(m[0])) fail.push(`${label}: ${rel}`);
  }
  for (const [re, label] of LOCAL_PATH_RES) {
    if (re.test(text)) fail.push(`${label}: ${rel}`);
  }
}

// 8. tag 与版本一致（Actions 上）
const ref = process.env.GITHUB_REF_NAME || "";
if (ref.startsWith("v") && pkg) {
  must(ref === `v${pkg.version}`, `tag ${ref} 与 package.json 版本 v${pkg.version} 一致`);
}

for (const line of ok) console.log(`  ok   ${line}`);
for (const line of fail) console.error(`  FAIL ${line}`);
console.log(`\n${ok.length} 项通过，${fail.length} 项失败`);
process.exit(fail.length === 0 ? 0 : 1);
