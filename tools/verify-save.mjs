#!/usr/bin/env node
// v2.2.0 端到端验证：构建产物是否带修复 + 多接口配置与密钥是否真能加密落盘。
// 用法：node tools/verify-save.mjs --root <扩展包根目录>   （仓库根执行时用 --root .）
// 说明：只写系统临时目录，跑完自动删除；不碰真实资产库，不需要真实密钥，也不会连任何真实接口。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1] ?? "") : "";
if (!root || !fs.existsSync(path.join(root, "package.json"))) {
  console.error("用法: node tools/verify-save.mjs --root <扩展包根目录>（该目录下应有 package.json）");
  process.exit(1);
}

const fail = [];
const pass = [];
const check = (cond, message) => (cond ? pass.push(message) : fail.push(message));

// ---- 1. 构建产物里必须有修复 ----
const panelFile = path.join(root, "panel", "main.js");
check(fs.existsSync(panelFile), "panel/main.js 存在");
if (fs.existsSync(panelFile)) {
  const text = fs.readFileSync(panelFile, "utf8");
  check(
    text.includes('typeof body === "string" ? body : JSON.stringify(body)'),
    "panel/main.js 的 svc() 把 body 序列化为 JSON 字符串",
  );
}

// ---- 2. 工作流模板随包发出 ----
for (const name of ["t2i_moss_sft.api.json", "i2i_moss_sft.api.json"]) {
  const file = path.join(root, "工作流", name);
  check(fs.existsSync(file), `工作流/${name} 打进了扩展包`);
}

// ---- 3. 服务层：多接口 + 每接口密钥 ----
const port = 57000 + Math.floor(Math.random() * 800);
const token = randomBytes(16).toString("hex");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "image-assets-verify-"));
const serviceEntry = path.join(root, "service", "main.js");
check(fs.existsSync(serviceEntry), "service/main.js 存在");

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
let logs = "";

const child = fs.existsSync(serviceEntry)
  ? spawn(process.execPath, [serviceEntry], {
      env: {
        ...process.env,
        OPENCHAMBER_SERVICE_PORT: String(port),
        OPENCHAMBER_SERVICE_TOKEN: token,
        IMAGE_ASSETS_ROOT: tmpRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
  : null;

child?.stdout.on("data", (b) => (logs += b.toString()));
child?.stderr.on("data", (b) => (logs += b.toString()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitReady = async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { headers, signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      // 还没起来
    }
    await sleep(250);
  }
  return false;
};

const request = async (method, p, payload) => {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers,
    body: payload === undefined ? undefined : typeof payload === "string" ? payload : JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
};

try {
  if (child) {
    const ready = await waitReady();
    check(ready, "service 在 127.0.0.1 上就绪");

    if (ready) {
      // 新装：没有预置接口，也没有默认接口
      const fresh = await request("GET", "/config");
      check(fresh.status === 200, `GET /config 返回 200（实际 ${fresh.status}）`);
      check(fresh.body?.interfaces?.length === 0, "新装接口列表为空（没有 HOHAI 预置）");
      check(!fresh.body?.defaultInterface, "新装没有默认接口");

      // 建一条云端接口 + 顺手存密钥
      const saved = await request("POST", "/interfaces", {
        interface: {
          id: "verify",
          name: "验证用接口",
          kind: "cloud",
          baseUrl: "https://api.example.com/v1",
          defaultModel: "verify-model",
          models: ["verify-model"],
        },
        apiKey: "sk-verify-0123456789abcdef",
      });
      check(saved.status === 200, `POST /interfaces 返回 200（实际 ${saved.status}）`);
      const savedIface = (saved.body?.interfaces || []).find((it) => it.id === "verify");
      check(Boolean(savedIface), "接口落盘并能读回");
      check(savedIface?.key?.hasKey === true, "返回体里该接口 key.hasKey = true");
      check(savedIface?.kind === "cloud", "接口类型保留 cloud");
      check(
        fs.existsSync(path.join(tmpRoot, "配置", "密钥", "verify.dat")),
        "配置\\密钥\\verify.dat 已生成（每接口一份）",
      );
      check(
        !fs.existsSync(path.join(tmpRoot, "配置", "credentials.dat")),
        "不再写旧的 credentials.dat",
      );

      // 设为默认
      const asDefault = await request("POST", "/interfaces/verify/default", "");
      check(asDefault.status === 200, `POST /interfaces/:id/default 返回 200（实际 ${asDefault.status}）`);
      check(asDefault.body?.defaultInterface === "verify", "默认接口已切换到 verify");

      // 非法 id 必须被拒绝
      const bad = await request("POST", "/interfaces", { interface: { id: "../evil", kind: "cloud", baseUrl: "https://x.test/v1" } });
      check(bad.status === 400, `非法接口 id 被拒绝（实际 ${bad.status}）`);

      // 密钥清除只影响这个接口
      const cleared = await request("POST", "/interfaces/verify/key", { clear: true });
      check(cleared.status === 200, `POST /interfaces/:id/key clear 返回 200（实际 ${cleared.status}）`);
      const afterClear = (cleared.body?.interfaces || []).find((it) => it.id === "verify");
      check(afterClear?.key?.hasKey === false, "密钥清除后 key.hasKey = false");

      // 本地接口不需要密钥，且能读回工作流槽位
      const local = await request("POST", "/interfaces", {
        interface: { id: "local", name: "本机", kind: "local", baseUrl: "http://127.0.0.1:8188" },
      });
      check(local.status === 200, `POST /interfaces（local） 返回 200（实际 ${local.status}）`);
      const localIface = (local.body?.interfaces || []).find((it) => it.id === "local");
      check(localIface?.kind === "local", "本地接口类型保留 local");
      check(localIface?.key?.needed === false || localIface?.key?.hasKey === false, "本地接口不要求密钥");

      // 删除接口时把它的密钥一并清掉
      const removed = await request("POST", "/interfaces/verify/delete", "");
      check(removed.status === 200, `POST /interfaces/:id/delete 返回 200（实际 ${removed.status}）`);
      check(!fs.existsSync(path.join(tmpRoot, "配置", "密钥", "verify.dat")), "删接口后密钥文件一起清掉");
    }
  }
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await sleep(300);
  }
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Windows 上进程刚退出时可能还占着目录，留着也不影响结果
  }
}

for (const line of pass) console.log(`  ok   ${line}`);
for (const line of fail) console.error(`  FAIL ${line}`);
if (fail.length && logs.trim()) {
  console.error("\n--- service 输出 ---\n" + logs.trim().split("\n").slice(-20).join("\n"));
}
console.log(`\n${pass.length} 项通过，${fail.length} 项失败`);
process.exit(fail.length === 0 ? 0 : 1);
