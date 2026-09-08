# 微信小游戏分包检查

2026-09-07 核对微信官方分包文档：主包不超过 4M，主包与分包合计不超过 30M；单个普通分包没有单独大小限制，独立分包不超过 4M。[微信官方分包说明](https://developers.weixin.qq.com/minigame/dev/guide/base-ability/subPackage/useSubPackage.html)

本项目 `game.json` 的 `pkg_audio`、`pkg_assets`、`pkg_boss` 都是普通分包。新增敌人图集仍可放在 `pkg_assets` 中，无须移动图片、改写引用路径或拆分启动加载流程。

`game.js` 会按顺序加载这三个分包，再创建菜单。因此浏览器预览与微信包继续使用相同的 `subpackages/pkg_assets/images/...` 路径。

## 每次新增资源后检查

```powershell
node tools/check-package-size.cjs
```

需要结构化结果时使用 `--json`。检查器只读取文件，确认：

- 遵守 `project.config.json` 的 `packOptions.ignore/include`；测试、工具、文档不计入发布包。
- 主包及总包大小符合预算；采用更保守的十进制 4 MB / 30 MB。
- 普通分包不套用独立分包的大小上限。
- 每个分包有入口文件，`game.js` 启动列表与 `game.json` 的分包名称一致。

本次敌人与角色图集完成后的检查快照：

| 包 | 原始文件大小 |
| --- | ---: |
| 主包 | 570,494 字节 |
| 音频分包 | 3,060,931 字节 |
| 贴图分包 | 17,432,135 字节 |
| Boss 分包 | 115,010 字节 |
| 合计 | 21,178,570 字节 |

这是未经过开发者工具编译、压缩的保守文件统计。后续资源变更后应重新运行检查器；最终上传大小以微信开发者工具给出的结果为准。
