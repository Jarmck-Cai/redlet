# 首版复用调研

2026-10-23。以下记录编码前的公开源码与官方文档调查：未运行第三方发布工具，研究阶段未启动登录或发布操作，选择器当时尚未实测。随后 Redlet 独立适配器已完成 Rednote 真实预览，具体范围与结果见[验证记录](VERIFICATION.md)；源码线索与实际验收分别记录。

## 结论

首版采用薄的 **Node.js / TypeScript + Playwright 适配器**。借鉴上游步骤和定位线索，暂不包装其 Go MCP 发布工具，也不直接包装其 Python CLI。

这不是因为上游完全不能预览：同仓库 Python `publish_pipeline.py` 默认只填写，只有 `--auto-publish` 才点击发布；`cdp_publish.py fill` 也与 `publish` / `click-publish` 分开。但 Go `publish_content` 没有 preview/dry-run 字段，填表和最终提交在同一调用链内。Python 路径又缺少账号身份、AI 声明、可见范围及最终内容回读验收，正文写法也不能直接沿用。Redlet 的首个里程碑比这些现成入口更窄且验收要求不同。[Go 请求与调用链][service] · [Go 填写后直接提交][publish-submit] · [Python 默认填写与可选提交][pipeline] · [Python fill 与 publish 分支][python-cli]

## 固定研究版本

- 上游：[xpzouying/xiaohongshu-mcp][repo]。
- 精确 commit：`7797fd375aba02dcd33afe143f6bee13e5870859`。本次通过公开远程 `refs/heads/main` 读取并以该 SHA 下载源码；以下 GitHub 源码链接均固定在该版本。main 后续可能移动。
- 已读：README、LICENSE、`xiaohongshu/publish.go`、`login.go`、`creator_session.go`、`service.go`、`browser/browser.go`、`cookies/cookies.go`、`humanize/input.go`，以及仓库自带发布 skill 的 `cdp_publish.py`、`publish_pipeline.py`、`chrome_launcher.py`。不是独立产品或真实页面验收。

## 已有能力与缺口

| 事项 | 源码证据及 Redlet 取舍 |
| --- | --- |
| 最终提交边界 | Go `Publish()` 上传后调用 `submitPublish()`；后者设置正文/可见范围/原创/商品后无条件 `clickPublishButton()`，然后用离开 `/publish/publish` 判断成功。不能以超时、取消或缺省设置当预览开关。服务还会关闭 page/browser。首版不得调用这条发布链。[publish.go][publish-submit] · [service.go][service] |
| 可分离预览 | Python `publish()` 方法只导航、上传和填写；pipeline 默认停填表，显式 flag 才 `_click_publish()`。可参考职责分离，但 `READY_TO_PUBLISH` 只是流程输出，没有所需逐项验收。[pipeline][pipeline] · [cdp_publish.py][python-cli] |
| 登录与持久会话 | Go 在 explore 页检查登录标记，扫码后把 Cookie JSON 保存，之后新浏览器导入；不是专用持久 profile 的完整会话模型。Python launcher 使用 `--user-data-dir`，但固定 CDP 端口已开便直接复用，未证明连接的是请求账号/profile。Redlet 应自行启动专用持久目录，用户在该窗口手动登录。[login.go][login] · [browser.go][browser] · [cookies.go][cookies] · [launcher][launcher] |
| 核对账号 | Go 当前用户从页面 `__INITIAL_STATE__` 读取，不提供创作平台昵称/ID DOM 选择器。Python 实际仅以当前 URL 是否含 `login` 判断登录；定义的宽泛 `login_indicator` 未用于身份校验。登录成立不等于预期账号已核对。[login.go][login] · [Python 登录][python-login] |
| 标题与正文 | Go 经 `humanize.Type` 逐字符 `InsertText`，没有分段回读。Python 按换行分割、过滤空段，把未 HTML 转义的段落拼成 `innerHTML`；空白行与 `<...>` 文本语义可能改变。不要复制这种正文写入方式；用文本输入并独立回读实际文本/段落。[humanize/input.go][input] · [Python 填写][python-fill] |
| 本地图片 | Go 按输入顺序逐张 `SetFiles`，等图片卡数量达到预期；只计数不证明对应图片或顺序。缺失文件被跳过，Redlet 应输入阶段明确失败。Python 上传后固定等待，也不等于上传完成或顺序核对。[Go 上传][publish-upload] · [Python 上传][python-fill] |
| AI 声明、原创、范围 | Go 的 `IsOriginal` 控制“原创声明”，不是 AI 内容声明；请求与填写链没有明确 AI 字段。Go 能选三种范围，但空值/公开直接返回，不回读当前值；Python 路径不设置 AI/范围。AI 控件定位仍需实际页面验证，不能把原创开关代替 AI 声明。[请求][service] · [声明与范围][publish-settings] |
| 域名 | Go/Python 固定 `creator.xiaohongshu.com`，登录页使用 `www.xiaohongshu.com` 或创作平台；Go 还为创作平台单独建立会话。没有据此确认其他 Rednote 海外域名兼容。首版应限制已实现的准确域名，其他入口另验，不能仅替换字符串宣称支持。[Go URL][publish] · [创作会话][creator] · [Python URLs][python-selectors] |

## 可参考的定位线索

这些来自固定源码，不代表平台承诺的稳定接口。Go 选择器散在 `publish.go`；Python 集中在 `SELECTORS`，其源码注释为 “Last verified: 2026-02”，不是本次验证。[Go 正文定位][publish-content] · [Python SELECTORS][python-selectors]

| 目标 | 上游选择器或读取方式 |
| --- | --- |
| 图文页签 | `div.upload-content` 内的 `div.creator-tab`，可见且文本为 `上传图文`。 |
| 首图 / 后续图片 | Go：`.upload-input`；后续 `input[type="file"]` 并检查 accept。Python：`input.upload-input`，后备 `input[type="file"]`。 |
| 已上传图片卡 | `.img-preview-area .pr`；上游以数量等待，没有图片身份回读。 |
| 标题 | Go：`div.d-input input`。Python：`input[placeholder*="填写标题"]`，后备 `input.d-text`。 |
| 正文 | Go 依次：`div[role="textbox"][contenteditable="true"]`、`div.tiptap[contenteditable="true"]`、`div.ql-editor`；最后由可见 `p[data-placeholder]` 包含 `输入正文描述` 向上找 role=textbox。Python：`div.tiptap.ProseMirror`，后备 `div.ProseMirror[contenteditable="true"]`。 |
| 可见范围 | 下拉 `div.permission-card-wrapper div.d-select-content`；选项 `div.d-options-wrapper div.d-grid-item div.custom-option`，文本含目标范围。支持 `公开可见`、`仅自己可见`、`仅互关好友可见`。 |
| 登录标记 | explore 页 `.main-container .user .link-wrapper .channel`；扫码图 `.login-container .qrcode-img`。这不是账号 ID。 |
| 当前账号 | explore 页 `window.__INITIAL_STATE__.user.userInfo`；若 `.value !== undefined` 用 `.value`；拒绝 guest。昵称 `nickname`，ID `userId || user_id`。未经验证可用于创作平台页面，不能假设同名全局结构存在。 |
| AI 声明 | 所审入口无可复用选择器；需独立核对实际控件、选项与选中状态。 |
| 最终发布（禁用边界） | Go 可查 `xhs-publish-btn` / `.publish-page-publish-btn button.bg-red`；Python 按 `发布` 文本查按钮。首版适配器不提供最终提交操作，不移植这些点击或坐标兜底。 |

来源：[Go 上传][publish-upload]、[Go 填写][publish-submit]、[Go 正文][publish-content]、[Go 范围][publish-settings]、[登录与账号][login]、[Python 定位器][python-selectors]。

## Playwright 能覆盖的基础能力

官方提供 `chromium.launchPersistentContext(userDataDir, { channel: 'chrome', headless: false })`：会话 Cookie/localStorage 保存在独立目录；同一目录不能同时启动多个实例。官方明确要求使用独立自动化目录，不支持指向日常 Chrome 主 profile。关闭 context 会关浏览器；需要人工审阅时，由 CLI 生命周期明确保留窗口，审阅结束再关闭。[持久上下文官方文档](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)

`locator.setInputFiles()` 支持本地文件及数组；动态文件选择器也有 `filechooser`。`locator.fill()` 可填写 input、textarea 和 contenteditable 并触发 input。它们只解决基础输入，不能替代富文本分段、图片顺序、声明和范围回读。[官方输入与上传文档](https://playwright.dev/docs/input)

工程建议：JSON 包只给显式正文文件/本地图片；先完整校验，再打开准确域名并核对预期账号，随后逐项填入、回读和留存本篇裁剪预览。无法确认账号或设置时失败并保留可审阅状态。preview-only 限制的是最终提交；图片仍会上传，平台是否自动保存草稿需要实际验证，本次没有断言无平台写入。

## 许可证与复用方式

上游 LICENSE 为 Apache-2.0，README 也明确标为该许可证。若复制或改写源代码，应保留适用版权/许可证/署名，分发时随附许可证并标注修改，保留适用 NOTICE 要求；具体以 §4 原文为准。源码许可并不确认平台当前 DOM 或账号可用性。本次只写调研；首版可独立实现这些公开 UI 步骤，并在参考资料记录上游版本。若实际移植源码，另加明确第三方声明。[固定版本 LICENSE][license] · [README][readme]

[repo]: https://github.com/xpzouying/xiaohongshu-mcp/tree/7797fd375aba02dcd33afe143f6bee13e5870859
[readme]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/README.md
[license]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/LICENSE
[service]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/service.go#L30-L40
[publish]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/xiaohongshu/publish.go#L36-L104
[publish-submit]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/xiaohongshu/publish.go#L348-L421
[publish-upload]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/xiaohongshu/publish.go#L244-L345
[publish-content]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/xiaohongshu/publish.go#L670-L712
[publish-settings]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/xiaohongshu/publish.go#L899-L1045
[login]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/xiaohongshu/login.go#L20-L71
[creator]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/xiaohongshu/creator_session.go
[browser]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/browser/browser.go#L46-L100
[cookies]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/cookies/cookies.go
[input]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/humanize/input.go#L247-L282
[python-selectors]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/skills/post-to-xhs/scripts/cdp_publish.py#L58-L96
[python-login]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/skills/post-to-xhs/scripts/cdp_publish.py#L229-L252
[python-fill]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/skills/post-to-xhs/scripts/cdp_publish.py#L324-L423
[python-cli]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/skills/post-to-xhs/scripts/cdp_publish.py#L767-L813
[pipeline]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/skills/post-to-xhs/scripts/publish_pipeline.py#L197-L234
[launcher]: https://github.com/xpzouying/xiaohongshu-mcp/blob/7797fd375aba02dcd33afe143f6bee13e5870859/skills/post-to-xhs/scripts/chrome_launcher.py#L57-L126

