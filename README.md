# Redlet

本地运行的小红书图文发布工具。把文案、图片和设置放进一份素材包，Redlet 打开浏览器，填好编辑器并核对预览。

首版提供素材检查、独立浏览器登录和预览。最终提交留在后续版本。

![Redlet 在 Rednote 创作平台生成的示例预览](docs/assets/rednote-preview.png)

## 开始使用

需要 Node.js 20 或更新版本。Windows 默认使用已安装的 Chrome；其他系统使用 Playwright Chromium（安装后运行 `npx playwright install chromium`）。

```sh
npm ci
npm run build
node dist/cli.js check examples/demo/post.json
node dist/cli.js login --site rednote
node dist/cli.js preview examples/demo/post.json
```

第一次在 Redlet 打开的专用窗口里手动登录。程序识别创作平台显示名后，会保留这份独立会话。之后的预览会核对该显示名；也可用 `--account "昵称"` 指定预期账号。

预览完成后，浏览器保持打开供你查看。关闭窗口结束命令，或加 `--close` 在保存结果后自动关闭。预览会上传指定图片，平台可能自动存草稿。

## 一份素材包

```json
{
  "schema_version": 1,
  "content_id": "my-note-001",
  "title": "今天改了一个小地方",
  "body_file": "body.txt",
  "images": ["images/01.png", "images/02.png"],
  "site": "rednote",
  "ai_generated": true,
  "visibility": "private"
}
```

正文是 UTF-8 纯文本，也可以用 `body` 直接写进 JSON，二者选一。文件路径相对素材包，不允许走出该目录。标题上限 20 个 Unicode 字符，正文上限 1000 个；支持 1–18 张 PNG、JPEG、WebP，单张最大 32 MiB。

`site` 可选 `rednote`、`xiaohongshu`。`visibility` 可选 `private`（仅自己可见）、`public`（公开可见）。`ai_generated` 对应“笔记含AI合成内容”。两个入口的实际验收状态见 [验证记录](docs/VERIFICATION.md)。

## 预览怎么核对

程序逐张上传图片，核对上传完成响应，并将本地缩略图的字节摘要与素材逐张比较，再填写标题、正文和设置。随后回读标题、空行（含末尾空段）、图片数量与顺序、AI 声明及可见范围。平台若转换了缩略图字节或换成无法读取的远程图，当前版本会停止并报告无法核对。账号不符、已有内容或无法核实时会停止，并报告失败。

每次结果和编辑区截图保存在 `.runtime/receipts/`。截图遮盖匹配的账号显示名和头像。浏览器配置、账号绑定与回执均保留在本地，`.runtime/` 已被 Git 忽略。用 `--state-dir DIR` 可另选运行目录。

## 开发

```sh
npm test
npm run check
npm run build
```

浏览器测试使用本机 Chrome（Windows）或 Playwright Chromium，只访问拦截的受控页面。实际创作平台试验单独记录。

- [首版设计](docs/DESIGN.md)
- [上游复用调研](docs/REUSE_RESEARCH.md)
- [制作记录](docs/BUILD_LOG.md)
- [验证记录](docs/VERIFICATION.md)

参考 [xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) 的页面步骤与定位线索，首版使用 TypeScript 和 Playwright 独立实现。项目采用 [Apache-2.0](LICENSE) 许可证。
