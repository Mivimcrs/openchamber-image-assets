# 本地 ComfyUI 工作流模板（API 格式）

宿主更新会整份替换安装目录，所以模板必须随仓库走，不能只放在外面。

- `t2i_moss_sft.api.json` — 文生图（MOSS-Image SFT，17 节点）
- `i2i_moss_sft.api.json` — 图生图（同上，多一个 LoadImage 节点接到 TextGenerate 的 image 槽）

- `t2i_moss_sft.api.json` — 文生图（MOSS-Image SFT，17 节点）
- `i2i_moss_sft.api.json` — 图生图（同上，多一个 LoadImage 节点接到 TextGenerate 的 image 槽）

模板来源：从 ComfyUI `/history` 里已经跑通的 API 提示词导出并展开子图，不是手写。
自己重生成的方法：在 ComfyUI 里把工作流跑通一次，再从 `/history/<prompt_id>` 取 `prompt`，
把 UUID 子图节点展开成「节点 id → {class_type, inputs}」的扁平对象即可（脚本可以自己写，一个 JSON 转换而已）。

注意：

- 模板里 `18:17 PrimitiveStringMultiline` 是用户提示词槽，`18:14` 是扩写系统提示词，不要互相对调。
- 模板自带的提示词只是示例：运行期会被请求里的提示词覆盖，改不改都行。
- 尺寸由外层 `19 ResolutionSelector` 决定，`18:6 EmptyFlux2LatentImage` 通过 `["19",0] / ["19",1]` 取宽高。
- 图生图的参考图进的是 `18:11 TextGenerate` 的 `image` 槽（提示词扩写），不是像素级 img2img。
- 视频模板暂缺：本机没有任何视频模型（8GB 显存），接口配置里留了 workflow.video 位置。
- 模板里的模型文件名（`unet_name` / `clip_name` / `vae_name`）要和本机 ComfyUI 里实际装的一致，否则节点校验失败。
