# 现有工具与一手资料

2026-10-23核对。以下是参考与候选，不是已经安装、接入或验证通过的依赖。

- [xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp)：Apache-2.0 开源实现，支持图文与本地图片发布。
- [其许可证](https://github.com/xpzouying/xiaohongshu-mcp/blob/main/LICENSE)：适用条件以原文为准。免费源码使用与托管服务收费分开考虑。
- [发布请求与响应](https://github.com/xpzouying/xiaohongshu-mcp/blob/main/service.go)：当前阅读版本没有显式 AI 声明字段，发布响应没有笔记 ID。
- [发布实现](https://github.com/xpzouying/xiaohongshu-mcp/blob/main/xiaohongshu/publish.go)：以浏览器操作创作平台，需验证域名、声明及结果回执的适配。
- [官方授权范围](https://openaccount.xiaohongshu.com/docs/scope)：当前文档将 write_notes 标为规划中。
- [官方分享平台](https://agora.xiaohongshu.com/doc)：客户端分享能力与通用服务端发帖接口分别考虑。
- [蚁小二开放平台](https://open.yxiaoer.cn/)：商业发布 API 示例，不因此视为开源或免费。
- [Playwright 浏览器配置](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)：独立持久浏览器环境的候选实现方式。

本地初始文档没有复制上述项目的源码。后续若复用源码或依赖，须保留其许可证及适用的署名。
