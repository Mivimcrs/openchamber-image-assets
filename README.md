# Magic Raw Picture（openchamber-image-assets）

OpenChamber 扩展：对话或面板里发起**生图**（文生图 / 参考图生图），图片自动入库；
侧边栏管理**本次会话**与**全部**生图资产，并提供**多接口**（云端图片 API / 本地 ComfyUI 工作流）、
密钥、模型与默认接口的设置页。

## 安装

**从本仓库（推荐，可检查更新）**

OpenChamber → 设置 → 扩展 → 添加扩展 → **URL**：

```
https://github.com/<owner>/openchamber-image-assets
```

批准 `service` 权限。

**从本地文件夹 / zip**

下载 Release 里的 `openchamber-image-assets-<version>.zip`，用「添加扩展 → 文件夹/zip」安装。

## 更新

宿主读取仓库根目录 `package.json` 的 `version`，与已装版本做 semver 比较；有新版本时整份重新 clone 并替换安装目录。
安装目录里的手改会丢，**所有改动必须进本仓库**。配置与密钥不在仓库里（见下），更新不影响。

## 组成

| 部分 | 说明 |
| --- | --- |
| `panel/` | 侧边栏面板：本次会话 / 全部资产 / 创作 / 设置（构建产物，入口 `panel/index.html`） |
| `service/` | 宿主拉起的本机回环服务（127.0.0.1，Bearer 鉴权）：资产、接口配置、密钥、模型、生成任务 |
| `plugin/` | 注入 OpenCode 的插件，注册 `image_assets_generate` / `image_assets_generate_video` / `image_assets_status` 三个工具（对话入口） |
| `工作流/` | 本地 ComfyUI 的 **API 格式**模板（`t2i_moss_sft.api.json`、`i2i_moss_sft.api.json`），随仓库一起发版 |
| `源码/` | 源码：`共享/`（校验、资产库、配置、密钥、模型、云端生成内核、ComfyUI 客户端、统一路由）、`service/`、`panel/` |
| `测试/` | `node --test`：共享逻辑、配置密钥（DPAPI）、迁移、生成内核、ComfyUI 打桩、service、插件 dry-run |
| `tools/check.mjs` | 仓库自检（清单/入口/语法 + 多接口回归守卫 + 公开仓库卫生检查） |
| `.github/workflows/release.yml` | tag 上自检、打 zip、发 Release |

## 云端接口能力（按公开接口行为填写，写进代码而不是猜）

| 能力 | 结论 |
| --- | --- |
| `POST /v1/images/generations` | 可用，通常 25–40s |
| `POST /v1/images/edits` | 可用（multipart：model/prompt/size/n/image 可重复） |
| 多张参考图 / 中文提示词 | 可用（2 张参考图 + 中文提示词可用） |
| `n>1` 一次多张 | 可用（`n=2` 一次返回 2 张） |
| `response_format=b64_json` | **被忽略**，可能返回公网 URL → 下载是主路径 |
| `size` | 不校验、半透传：999×999→1254×1254，2048×2048 原样；nano-banana 直接忽略 |
| 透明背景 | 文生图可用（真 alpha PNG）；参考图模式未验证，不下发 |
| `mask` 局部重绘 | 参数被接受但效果不可控 → 本版不做 |
| 错误响应 | **body 为空**，只能按状态码映射 |
| `usage` | 返回 token 明细（估算值），入库并展示 |

## 生成：一份路由，两种后端

`源码/共享/统一生成.js` 是唯一入口，按接口 `kind` 分流：

- **云端**（`kind: cloud`）：`生成.js` → `/images/generations` 或 `/images/edits`（multipart）→ 下载 → 校验 → 入库。
- **本地**（`kind: local`）：`ComfyUI.js` → 健康检查 → 上传参考图 → 打桩 API 模板 → `POST /prompt` → 轮询 `/history/{id}` → `GET /view` 下载 → 入库。

本地槽位按请求自动选：无参考图走 `t2i`，有参考图走 `i2i`，视频走 `video`（没有模板就明确报错，不猜）。
对话工具与面板「创作」都走这套；面板侧由 service 起异步任务，进度经 `emit` 推送，`GET /generate/:id` 可补拉。

## 接口与工作流模板

- 接口是**手动**配置的，新装时列表为空，不预置任何服务商；旧版（v1，单接口）在首次启动时合并成一条
  `id: legacy`、名称「旧配置」的云端接口，**不设为默认**，原密钥保留为 `配置/密钥/legacy.dat`。
- 每个接口可选类型：`cloud`（云端图片 API）或 `local`（本机 ComfyUI）。
- 默认接口由 `defaultInterface` 手动指定；每个接口的 `defaultModel` 也是手填，模型列表以手填为主，
  「拉取」只做补充（云端 `/v1/models`、本地 ComfyUI `object_info`），**不覆盖手填项**。
- 本地接口的模板优先级：接口里填的自定义路径 > 扩展自带 `工作流/`。自带模板是从实际跑通的 ComfyUI
  `/history` 提示词导出并展开成 API 格式的，节点 id 与槽位固定（用户提示词、扩写系统提示词、反向提示词、
  `ResolutionSelector` 画幅、`LoadImage id 100`）；换模型/换工作流请在面板里填自己导出的 API 模板路径。
- 视频只留了接口与槽位：本机目前没有任何视频模型（8GB 显存），`image_assets_generate_video` 在没有模板时直接
  给出配置指引，不会去猜或下载模型。

## 配置与密钥

- 明文配置：`openchamber-image-assets/配置/settings.json`（`version: 2`，`interfaces[]` + `defaultInterface` + 画幅/张数）
- 密钥：**每接口一份** `配置/密钥/<接口id>.dat`，Windows DPAPI 密文，绑定当前 Windows 用户
- 生效优先级：**面板保存 > 环境变量 `IMAGE_ASSETS_KEY_<接口ID大写>`**
- 面板与日志永远拿不到明文；设置页只显示末 4 位；忘记只能整条重输，或删掉对应 `.dat` 回落环境变量
- 风险边界：DPAPI 防的是「文件被拷走/明文裸奔」，不防同用户的其它进程
- 旧版本文件（`credentials.dat`、旧 `settings.json`）迁移时备份到 `配置/归档/`

## 面板

| 视图 | 内容 |
| --- | --- |
| 本次会话 / 全部 | 网格缩略图、标签筛选、搜索；角标显示参考图数、PNG 透明标记 |
| 详情 | 大图、参考图缩略图、提示词、请求尺寸 vs 实际尺寸、用量、以此图为参考、复用提示词、标注、删除 |
| 创作 | 参考图槽（从资产库选，0–4 张）、接口与槽位选择、提示词、画幅、张数、模型与能力标签、透明底开关、进度、候选并排 |
| 设置 | 接口卡片列表（新增/编辑/启用/删除/设为默认/测试连接）、每个接口的地址、默认模型、手填模型清单与「拉取补充」、密钥（保存/清除）、本地接口的工作流模板路径与采样参数、默认画幅/张数、资产库路径 |

## 资产库位置

位置解析顺序（没有特别要求时走自定义路径）：

1. 调用时显式指定（内部工具用）
2. 环境变量 `IMAGE_ASSETS_ROOT`
3. **自定义存放路径**（面板「设置 → 数据 → 存放位置」里保存的，存在库外的 `location.json`）
4. 出厂默认 `<用户主目录>/openchamber-image-assets/`（例如 `C:\Users\你的用户名\openchamber-image-assets\`）

面板里可以随时改：填好路径 → 校验 → 二选一确认。**整库搬迁**把图片、索引、接口配置与密钥一起搬过去，
源库改名为 `<旧路径>.归档-<时间>`（不删除）；**只切换**保留旧库，新库需要重新配置接口与密钥。
搬迁可中断可续，面板会提示未完成的标记。保存后立即生效，插件与面板都不用重启。

- `图片/`：生成的 PNG/JPEG
- `索引/`：`<id>.json` 记录（会话、提示词、模型、尺寸、参考图、用量、标签、备注）
- `配置/`：settings.json + `密钥/`
- `运行时/`：`参考/`（本地参考图按内容哈希缓存，供面板显示缩略图）、无效响应排查文件

## 权限与安全

- 安装只申请 **`service`** 权限；不申请文件、模型、会话、prompt 权限。
- 面板不碰文件系统：全部经 `serviceRequest`；服务只监听 `127.0.0.1` 并校验宿主 Bearer。
- 生图请求发生在插件进程或 service 内，密钥只在这两处解封。
- 仓库不含任何密钥；`panel/index.html` 只存在于仓库根（构建不生成），改样式直接改它，改逻辑改 `源码/panel/main.js`。

## 已知边界

- `mask` 不做：掩码区会被贴灰块并整体重绘。
- 参考图上限 4 张（接口上限未测）、单张 ≤20MB。
- 图片回传单张 ≤5.5MB（宿主上限 8MB），超出提示文件路径。
- 面板内不可用原生 `confirm()`，删除采用两段式按钮。
- 无后台 watcher 常驻：服务在面板打开时启动，空闲 10 分钟由宿主回收；面板带 10 秒兜底轮询。
- 面板调宿主服务的 `body` 必须是 JSON 字符串（宿主协议 `z.string()`），v2.1.1 之前发对象导致所有保存类操作静默失败。
- 本地 ComfyUI 必须自己先启动（`python main.py`），扩展不代管进程；模型名/节点 id 与自带模板绑定，
  换模型请自带 API 模板，不支持把任意 UI 工作流 JSON 自动转换。
- 一次请求只出一张：本地面板隐藏张数选择，模板只有单条 `SaveImage`。

## 开发

```sh
node 构建.mjs          # 同步 源码/共享 → plugin/shared，校验 工作流/ 模板，打包 service、panel
node --test 测试\      # 单测/集成测试（DPAPI 往返、迁移、生成内核、ComfyUI 打桩、插件 dry-run）
node tools/check.mjs   # 仓库自检（CI 同一套，含公开仓库卫生检查）
```

构建依赖（esbuild 与 `@openchamber/sdk`）不在仓库里：默认找仓库根下的 `.build-env`，
也可以用环境变量 `IMAGE_ASSETS_BUILD_ENV` 指向任意目录（里面要有 `node_modules`）。

```sh
mkdir .build-env && cd .build-env
npm init -y && npm i esbuild @openchamber/sdk
```

## 发版

```sh
# 1. 改 package.json 的 version
# 2. 构建 + 测试 + 自检
node 构建.mjs && node --test 测试\ && node tools/check.mjs
# 3. 提交并打 tag
git add -A && git commit -m "release: v2.2.1"
git tag v2.2.1 && git push origin main --tags
```

CI 在 tag 上：自检 → 打 `openchamber-image-assets-<version>.zip` → 建 Release 并附产物。
手动触发 workflow 只出 zip 产物，不发 Release。
