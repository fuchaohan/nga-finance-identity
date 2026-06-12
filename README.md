# NGA 大韭菜指数

一个 Tampermonkey 油猴脚本。

它会在 NGA 帖子页的用户名旁增加“大韭菜指数”按钮，一键抓取该用户的历史回帖，并调用任意 OpenAI 兼容的 AI 模型 API 进行“金融身份”分析。

## 来源说明

- 原始灵感与脚本思路来自 NGA 帖子: https://nga.178.com/read.php?tid=46969087
- 原作者: 贞先生
- 当前版本在原思路基础上做了 AI 改写，不再绑定豆包页面自动填充，而是改为直接调用任意 OpenAI 兼容接口进行分析

## 当前版本特点

- 支持在帖子页给用户增加“大韭菜指数”按钮
- 自动抓取指定用户历史回帖内容
- 自动拼接分析 Prompt
- 通过 `base_url`、`api_key`、`model` 三项配置调用第三方 AI
- 兼容 OpenAI 风格接口，例如:
  - OpenAI
  - DeepSeek
  - OpenRouter
  - OneAPI
  - 各类 OpenAI 兼容中转服务
- 在页面右侧抽屉直接展示分析结果

## 支持站点

- `bbs.nga.cn`
- `ngabbs.com`
- `*.ngabbs.com`
- `www.nga.cn`
- `g.nga.cn`
- `nga.178.com`

## 安装方式

1. 安装浏览器扩展 Tampermonkey
2. 新建一个脚本
3. 将 `nga-finance-identity.user.js` 的内容完整粘贴进去
4. 保存脚本

## 配置方式

安装后，在 Tampermonkey 菜单中配置以下三项:

- `Base URL`
  - 例如 `https://api.openai.com/v1`
  - 例如 `https://api.deepseek.com/v1`
- `API Key`
  - 你的模型服务密钥
- `Model`
  - 例如 `gpt-4o-mini`
  - 例如 `deepseek-chat`

## 使用方法

1. 打开 NGA 帖子页
2. 在用户名旁点击“大韭菜指数”
3. 脚本会自动抓取该用户历史回帖
4. 右侧抽屉会显示 AI 分析结果

## 适配说明

当前版本调用的是 OpenAI 兼容接口:

- 请求路径: `/chat/completions`
- 认证方式: `Authorization: Bearer <api_key>`
- 主要配置项:
  - `base_url`
  - `api_key`
  - `model`

如果你的服务商兼容 OpenAI Chat Completions 协议，通常可以直接使用。

## 注意事项

- 本脚本仅供娱乐和技术交流使用
- 分析结果完全依赖 AI 输出，不代表真实身份判断
- 部分站点页面结构变化后，可能需要调整选择器
- 如果接口返回空内容或报错，请优先检查 `base_url`、`api_key`、`model` 是否正确

## 致谢

感谢贞先生提供原始创意和脚本思路.
