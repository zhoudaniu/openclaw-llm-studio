# 🦞 OpenClaw LLM Studio

> 大模型聚合平台 & 本地 AI 引擎管理 — Electron 绿色便携版

---

## 📋 项目简介

OpenClaw LLM Studio 是一款基于 Electron 打造的 **Windows 纯绿色便携客户端**，集成了：

- **多云端大模型聚合**：一个界面调用 OpenAI、Claude、Gemini、DeepSeek 等主流模型
- **本地 AI 引擎管理**：一键启动/停止 Ollama 等本地推理引擎，完全离线运行
- **免费模型开箱即用**：内置 SiliconFlow 免费模型，无需配置 API Key 即可体验

### 核心特性

| 特性 | 说明 |
|------|------|
| 🆓 免费开箱即用 | 内置 SiliconFlow 免费模型，无需 API Key |
| 🦙 本地模型支持 | 集成 Ollama，一键拉取模型，完全离线 |
| 🔗 多模型聚合 | 支持 OpenAI / Claude / Gemini / DeepSeek / 通义千问 / 智谱GLM 等 |
| ⚙️ 引擎管理 | Ollama / LM Studio / LocalAI / vLLM 一键启动 |
| 🎨 主题切换 | 暗色 / 亮色 / 跟随系统 |
| 🌐 多语言 | 简体中文 / 繁體中文 / English / 日本語 |
| 💾 绿色便携 | 解压即用、免安装、无注册表写入 |

---

## 📁 项目架构

```
openclaw-launcher/
├── package.json                 # 项目配置 & 打包配置
├── main.js                      # Electron 主进程
│   ├── 窗口管理
│   ├── IPC 通信层
│   ├── 多云端 API 适配（OpenAI/Claude/Gemini/DeepSeek/通义/智谱）
│   ├── Ollama 本地引擎管理
│   └── 引擎进程管理
├── preload.js                   # 安全桥接（contextIsolation）
├── src/
│   ├── index.html               # 主页面（SPA 单页应用）
│   ├── styles/
│   │   ├── main.css             # 全局样式 + 主题变量（暗色/亮色）
│   │   └── chat.css             # 聊天界面样式 + 级联选择器
│   └── js/
│       └── app.js               # 前端核心逻辑
│           ├── 聊天管理（多会话、流式输出、Markdown）
│           ├── 级联模型选择器
│           ├── 设置管理（主题/语言/供应商/参数）
│           ├── 引擎管理（检测/安装/启动/停止）
│           ├── Ollama 专用（安装向导、模型拉取、本地扫描）
│           └── 国际化（4 种语言 60+ 翻译节点）
├── engine/                      # 本地引擎文件（可选，Ollama 由用户安装）
├── data/
│   ├── config.json              # 用户配置（主题/语言/供应商/API Key）
│   ├── conversations.json       # 对话历史
│   └── engines/                 # 引擎相关数据
└── builds/                      # 打包输出目录
```

---

## 🚀 快速开始

### 环境要求

- **Node.js** 18+ (推荐 20+)
- **Windows** 10/11 x64

### 开发模式运行

```bash
# 1. 进入项目目录
cd openclaw-launcher

# 2. 安装依赖
npm install

# 3. 启动应用
npm start
```

### 首次使用流程

```
1. 启动应用 → 进入聊天页面
2. 默认已选中 SiliconFlow 免费模型
3. 在 SiliconFlow 设置中填入 API Key（免费注册获取）
4. 开始对话！
```

---

## 🔧 功能详解

### 1. 聊天对话

- **多会话管理**：新建、切换、删除对话
- **级联模型选择器**：左栏选供应商 → 右栏选模型
- **流式输出**：实时显示 AI 回复
- **Markdown 渲染**：代码高亮、表格、引用等
- **当前时间注入**：自动告诉模型当前日期

### 2. 供应商管理（设置页 → 供应商管理）

内置 10+ 预设供应商，一键添加：

| 供应商 | 免费 | 说明 |
|--------|------|------|
| **SiliconFlow** | ✅ 免费额度 | 国内聚合平台，多款免费模型 |
| **DeepSeek** | 极低价 | 性价比最高的国产模型 |
| **OpenAI** | — | GPT-5 / GPT-4.1 / o3 等 |
| **Anthropic** | — | Claude Opus 4 / Sonnet 4 |
| **Google Gemini** | — | Gemini 2.5 Pro/Flash |
| **通义千问** | — | Qwen3-235B / Qwen-Max |
| **智谱 GLM** | — | GLM-4-Plus / GLM-4-Flash |
| **Moonshot (Kimi)** | — | 128K 超长上下文 |
| **豆包** | — | 字节跳动大模型 |
| **OpenRouter** | 部分免费 | 聚合 100+ 模型 |
| **自定义** | — | 任何 OpenAI 兼容接口 |

### 3. 本地引擎管理（引擎管理页）

| 引擎 | 说明 | 一键安装 |
|------|------|---------|
| **Ollama** | 最流行的本地推理框架 | ✅ 引导下载 |
| **LM Studio** | 图形界面管理本地模型 | ✅ 引导下载 |
| **LocalAI** | OpenAI API 兼容引擎 | 🔗 打开下载页 |
| **vLLM** | 高性能 GPU 推理 | pip 安装 |
| **小龙虾 OpenClaw** | 自部署引擎 | 用户自配 |

### 4. Ollama 一键拉取模型

引擎管理页 → 点击「🦙 Ollama 管理」：

```
已安装模型列表
├── llama3.1:8b          4.7 GB
├── qwen2.5:7b           4.4 GB
└── deepseek-r1:8b       4.9 GB

[选择模型 v]  [⬇️ 拉取]
→ 正在拉取 model-name，请稍候...
✅ 拉取成功！
```

内置热门模型推荐：
- 🔥 **llama3.1** — Meta 通用对话
- 🇨🇳 **qwen2.5** — 通义千问，中文最优
- 🧠 **deepseek-r1** — 推理模型
- 💻 **codellama** — 代码专用
- ⚡ **phi3** / **tinyllama** — 轻量/极小

### 5. 界面设置

| 设置 | 选项 |
|------|------|
| 🎨 主题 | 暗色 / 亮色 / 跟随系统 |
| 🌐 语言 | 简体中文 / 繁體中文 / English / 日本語 |
| 🎛️ 参数 | Temperature / Top P / Max Tokens |

---

## 📦 打包为绿色版

```bash
# 打包为目录（解压即用）
npm run build

# 打包为单个 exe
npm run build:portable
```

输出目录：`builds/`

---

## 🛠️ 技术栈

| 技术 | 用途 |
|------|------|
| Electron 28 | 桌面应用框架 |
| Node.js | 后端逻辑（API 调用、进程管理） |
| 原生 HTML/CSS/JS | 前端界面（零依赖，轻量） |
| CSS Variables | 主题切换系统 |
| Fetch API | 流式 HTTP 请求 |
| child_process | 引擎进程管理 |

---

## 📝 API Key 获取指南

### SiliconFlow（推荐，有免费额度）

1. 访问 https://siliconflow.cn
2. 注册账号
3. 进入控制台 → API Key
4. 创建 Key → 复制到应用设置中

### DeepSeek

1. 访问 https://platform.deepseek.com
2. 注册并充值（极低价）
3. 创建 API Key

### OpenAI

1. 访问 https://platform.openai.com
2. 需要海外手机号或虚拟号码
3. 充值后获取 Key

---

## ❓ 常见问题

**Q: 为什么模型回复显示"空响应"？**
A: 检查 API Key 是否正确配置，或者切换到 SiliconFlow 免费模型试试。

**Q: Ollama 启动失败？**
A: 需要先安装 Ollama。点击引擎管理页的「🦙 Ollama 管理」→ 下载安装。

**Q: 如何使用本地模型？**
A: 安装 Ollama → 拉取模型（如 `ollama pull llama3.1`）→ 在模型选择器中选择本地模型。

**Q: 绿色版如何分发？**
A: 执行 `npm run build` 后，将 `builds/` 目录下的文件夹打包为 zip 即可。

---

## 📄 许可证

MIT License

---

## 🔗 相关链接

- [Ollama](https://ollama.com) — 本地大模型推理框架
- [SiliconFlow](https://siliconflow.cn) — 国内大模型聚合平台
- [OpenAI](https://openai.com) — GPT 系列模型
- [Anthropic](https://anthropic.com) — Claude 系列模型
