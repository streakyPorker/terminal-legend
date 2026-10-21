# Git hooks

## pre-commit —— 自动递增插件版本号

每次 `git commit` 都会把插件补丁版本号 +1：

- `.claude-plugin/plugin.json` 的 `version`
- `.claude-plugin/marketplace.json` 的 `metadata.version`

钩子会把改好的文件一并 `git add`，所以版本号随提交前进，不会回退。
临时跳过：`git commit --no-verify`。

### 启用

仓库已把 `core.hooksPath` 指向本目录；换机器或重新 clone 后执行一次：

```bash
git config core.hooksPath .githooks
```

### 提交后刷新本地插件

版本号变化后，让本地安装的插件同步到新版本（需重启会话生效）：

```bash
claude plugin update terminal-legend@terminal-legend
```
