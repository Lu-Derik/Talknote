# TalkNote VS Code Extension

TalkNote 提供一个聊天参与者 `@talknote`，将对话转发给 Copilot 模型并自动记录每次对话。

> 说明：受 VS Code 公开 API 限制，扩展无法直接拦截“内置 Copilot 参与者”的所有全局聊天消息。
> TalkNote 采用最接近无感的方案：首次切换到 `@talknote` 后，参与者会保持 sticky，后续对话可持续自动记录。

## 功能

- 在工作区根目录自动创建 `.talknote` 隐藏文件夹。
- 文件名格式：`项目名-日期-talkid.md`。
- 按天归档：同一天写入同一个 Markdown 文件。
- 每次交互记录：用户提示 + Copilot 回复。

## 使用

1. 安装并启动扩展（按 `F5` 运行 Extension Development Host）。
2. 打开 Chat 视图，选择 `@talknote` 参与者。
3. 输入问题并发送。
4. 记录文件将写入：`.talknote/项目名-YYYYMMDD-talkid.md`。

## 无感模式（可行边界）

- 已支持：扩展安装后随 VS Code 启动自动激活。
- 已支持：首次安装自动弹出引导，点击后打开 Chat 并预填 `@talknote`。
- 已支持：使用 `@talknote` 时全自动记录，无需额外命令。
- 当前不可行：在不使用 `@talknote` 的前提下，监听原生 Copilot 全部聊天。

## talkid 规则

- talkid 使用 `sha1(projectName + '-' + YYYYMMDD)` 的前 8 位十六进制字符。
- 同一项目同一天 talkid 固定，满足“每天一个文件”。

## 打包与发布

### 打包（生成 .vsix）

1. 安装依赖：`npm install`
2. 编译扩展：`npm run compile`
3. 打包（允许缺少 repository 字段）：`npm run package`
4. 产物默认位于项目根目录：`talknote-<version>.vsix`

### 发布到 VS Code Marketplace

1. 在 Marketplace 创建发布者（publisher）。
2. 在 Azure DevOps 创建 PAT（需包含 Marketplace 发布权限）。
3. 登录发布者：`npx @vscode/vsce login <publisher>`
4. 发布扩展：`npm run publish`
	- 或自动升版本发布：`npm run publish:patch`（也可 `npm run publish:minor` / `npm run publish:major`）

> 提示：当前项目已可用 `vsce` 打包。若准备长期发布，建议迁移到 `@vscode/vsce`。

## 本地安装与试用

### 方式一：开发模式试用（推荐）

1. 在本项目中按 `F5` 启动 `Extension Development Host`。
2. 在新窗口打开 Chat，使用 `@talknote` 发起对话。
3. 检查当前工作区是否生成：`.talknote/项目名-YYYYMMDD-talkid.md`。

### 方式二：安装 VSIX 试用

1. 先执行打包：`npm run package`
2. 在 VS Code 执行命令：`Extensions: Install from VSIX...`
3. 选择项目根目录生成的 `.vsix` 文件。
4. 安装后重载窗口，打开 Chat 使用 `@talknote` 测试。
