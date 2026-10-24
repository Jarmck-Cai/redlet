# Hello, Redlet

一份可改着用的公开预览样例。两张配图是本项目制作的普通示例，正文包含四段及空行。

```text
hello-redlet/
  post.json       标题、图片顺序和设置
  body.txt        公开正文
  images/01.png   封面
  images/02.png   图片顺序卡
  cards.html      配图源文件
  render.mjs      配图重绘脚本
  LICENSE         Apache-2.0 许可
```

在 Redlet 仓库根目录安装依赖并构建后：

```sh
node dist/cli.js check examples/hello-redlet/post.json
node dist/cli.js login --site rednote
node dist/cli.js preview examples/hello-redlet/post.json
```

首次使用在 Redlet 自己的浏览器窗口手动登录；已有绑定会话可跳过 login。预览会上传指定图片，平台可能自动保存草稿，完成后窗口保留供你查看。关闭窗口结束命令；如需保存预览回执后关闭，可给 preview 加 `--close`。

这个样例默认 `private`（仅自己可见），标有 AI 辅助声明。上面的命令只到预览。正文和两图实际核对见仓库 `docs/VERIFICATION.md` 中的 Hello Redlet 记录。入口为 `creator.rednote.com`，不将本次结果算作国内创作入口的验收。

## 换成自己的内容

修改 `body.txt`；在 `post.json` 改标题及图片文件名，数组顺序就是上传顺序。路径相对这一份素材包，不要在正文里混入内部备注。改完再运行 check 和 preview。

如果写的是另一篇将要发布的原创内容，为它分配自己的内容 ID；已尝试提交的那篇继续使用 verify，不换 ID 重发。实际发布说明见仓库 README。

配图来自 `cards.html`，可在仓库根目录运行 `node examples/hello-redlet/render.mjs` 重绘。重绘使用项目已有的 Playwright；Windows 使用 Chrome，其他系统先安装 Playwright Chromium。样例文件沿用仓库 Apache-2.0 许可证。
