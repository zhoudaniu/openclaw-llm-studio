const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, nativeTheme } = require('electron');
const { spawn, exec } = require('child_process');
const http = require('http');
const https = require('https');

let mainWindow;
const isDev = process.argv.includes('--dev');

// ============ 路径 ============
const APP_ROOT = app.isPackaged ? path.dirname(app.getPath('exe')) : __dirname;
const DATA_DIR = path.join(APP_ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'openclaw.db');
const ENGINES_DIR = path.join(DATA_DIR, 'engines');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

// 确保目录存在
[DATA_DIR, ENGINES_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ============ 配置管理 ============
const DEFAULT_CONFIG = {
  theme: 'dark',
  defaultProvider: 'siliconflow',
  defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
  proxy: '',
  chatDefaults: { temperature: 0.7, top_p: 1.0, max_tokens: 4096 },
  providers: {
    openai:    { name: 'OpenAI',      enabled: true,  apiKey: '', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5','gpt-5-mini','gpt-5-nano','gpt-4.1','gpt-4.1-mini','gpt-4.1-nano','o3','o3-pro','o4-mini','gpt-4o','gpt-4o-mini'] },
    anthropic: { name: 'Anthropic',   enabled: true,  apiKey: '', baseUrl: 'https://api.anthropic.com', models: ['claude-opus-4-20250514','claude-sonnet-4-20250514','claude-3-7-sonnet-20250219','claude-3-5-haiku-20241022'] },
    gemini:    { name: 'Google Gemini',enabled: true,  apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com', models: ['gemini-2.5-pro','gemini-2.5-flash','gemini-2.0-flash','gemini-2.0-flash-lite'] },
    deepseek:  { name: 'DeepSeek',    enabled: true,  apiKey: '', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat','deepseek-reasoner','deepseek-coder'] },
    tongyi:    { name: '通义千问',     enabled: true,  apiKey: '', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen3-235b-a22b','qwen-max','qwen-plus','qwen-turbo','qwen-coder-plus'] },
    zhipu:     { name: '智谱 GLM',     enabled: true,  apiKey: '', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-plus','glm-4-flash','glm-4-long'] },
    moonshot:  { name: 'Moonshot (Kimi)', enabled: true, apiKey: '', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-128k','moonshot-v1-32k'] },
    doubao:    { name: '豆包 (ByteDance)', enabled: true, apiKey: '', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-1.5-pro-256k','doubao-1.5-lite-32k'] },
    siliconflow: { name: 'SiliconFlow (免费)', enabled: true, apiKey: 'sk-dnnyfirbokxmvhrcyxrgywcdtmhodcqrjbaamyvfcfwwqjoo', baseUrl: 'https://api.siliconflow.cn/v1', models: ['Qwen/Qwen2.5-7B-Instruct','THUDM/glm-4-9b-chat','deepseek-ai/DeepSeek-V2-Chat','meta-llama/Meta-Llama-3.1-8B-Instruct','internlm/internlm2_5-7b-chat'], free: true },
    custom:    { name: '自定义(兼容)',  enabled: false, apiKey: '', baseUrl: '', models: [] },
  },
  engines: [
    { id: 'openclaw',  name: '小龙虾 OpenClaw', type: 'command', command: '', port: 8088, statusUrl: '', autoDetect: true, description: '自部署 OpenClaw 本地推理引擎' },
    { id: 'ollama',   name: 'Ollama',     type: 'command', command: 'ollama serve',        port: 11434, statusUrl: 'http://localhost:11434/api/tags',   autoDetect: true },
    { id: 'lmstudio', name: 'LM Studio',  type: 'port',    command: '',                     port: 1234,  statusUrl: 'http://localhost:1234/v1/models',      autoDetect: true },
    { id: 'localai',  name: 'LocalAI',     type: 'command', command: 'local-ai',             port: 8080,  statusUrl: 'http://localhost:8080/v1/models',       autoDetect: true },
    { id: 'vllm',     name: 'vLLM',        type: 'command', command: 'python -m vllm.entrypoints.openai.api_server', port: 8000, statusUrl: 'http://localhost:8000/v1/models', autoDetect: false },
    { id: 'custom',   name: '自定义引擎',   type: 'custom',  command: '',                     port: 9090,  statusUrl: '',                                       autoDetect: false },
  ],
};

let config = { ...DEFAULT_CONFIG };
let engineProcesses = {}; // id -> ChildProcess

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      config = deepMerge(DEFAULT_CONFIG, raw);
    }
  } catch (e) { console.error('Config load error:', e); }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) { console.error('Config save error:', e); }
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = deepMerge(out[key] || {}, source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

// ============ 简易对话存储 (JSON文件) ============
const CONVERSATIONS_PATH = path.join(DATA_DIR, 'conversations.json');

function loadConversations() {
  try {
    if (fs.existsSync(CONVERSATIONS_PATH)) {
      return JSON.parse(fs.readFileSync(CONVERSATIONS_PATH, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return [];
}

function saveConversations(convos) {
  fs.writeFileSync(CONVERSATIONS_PATH, JSON.stringify(convos, null, 2), 'utf-8');
}

// ============ HTTP 请求工具 ============
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 60000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ============ IPC 处理 ============

// --- 窗口控制 ---
ipcMain.on('win:minimize', () => mainWindow?.minimize());
ipcMain.on('win:maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
ipcMain.on('win:close', () => mainWindow?.close());
ipcMain.handle('win:isMaximized', () => mainWindow?.isMaximized() || false);

// --- 配置 ---
ipcMain.handle('config:get', () => config);
ipcMain.handle('config:set', (e, key, value) => {
  if (key.includes('.')) {
    const parts = key.split('.');
    let obj = config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
  } else {
    config[key] = value;
  }
  saveConfig();
  return true;
});
ipcMain.handle('config:getProvider', (e, id) => config.providers?.[id] || null);
ipcMain.handle('config:setProvider', (e, id, data) => {
  config.providers[id] = { ...(config.providers[id] || {}), ...data };
  saveConfig();
  return true;
});

// --- 对话存储 ---
ipcMain.handle('conversations:list', () => loadConversations());
ipcMain.handle('conversations:save', (e, convos) => { saveConversations(convos); return true; });

// --- 模型 API 调用（流式） ---
ipcMain.handle('chat:send', async (e, { provider, model, messages, options }) => {
  const prov = config.providers?.[provider];
  if (!prov || !prov.apiKey) {
    return { error: `请先配置 ${provider} 的 API Key` };
  }

  try {
    const result = await callModelAPI(provider, prov, model, messages, options);
    return result;
  } catch (err) {
    return { error: err.message };
  }
});

// 流式请求 - 使用主进程直连
ipcMain.handle('chat:stream', async (e, { provider, model, messages, options }) => {
  const prov = config.providers?.[provider];
  if (!prov || !prov.apiKey) {
    return { error: `请先配置 ${prov?.name || provider} 的 API Key` };
  }

  console.log(`[chat:stream] provider=${provider}, model=${model}, url=${buildApiUrl(provider, prov)}`);

  return new Promise((resolve) => {
    const url = buildApiUrl(provider, prov);
    const headers = buildHeaders(provider, prov);
    const body = buildRequestBody(provider, model, messages, { ...options, stream: true });

    const mod = url.startsWith('https') ? https : http;
    const urlObj = new URL(url);

    const req = mod.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (url.startsWith('https') ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 120000,
    }, (res) => {
      console.log(`[chat:stream] response status=${res.statusCode}, content-type=${res.headers['content-type']}`);

      if (res.statusCode !== 200) {
        let errData = '';
        res.on('data', d => errData += d);
        res.on('end', () => {
          console.log(`[chat:stream] error body: ${errData.slice(0, 500)}`);
          mainWindow?.webContents.send('chat:stream-chunk', `\n\n❌ API 错误 (${res.statusCode}): ${errData.slice(0, 500)}`);
          mainWindow?.webContents.send('chat:stream-done');
          resolve({ error: `API 错误 (${res.statusCode}): ${errData.slice(0, 500)}` });
        });
        return;
      }

      const contentType = res.headers['content-type'] || '';

      // 情况1: 正常 SSE 流式响应 (text/event-stream)
      if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              mainWindow?.webContents.send('chat:stream-done');
              resolve({ ok: true });
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const content = extractStreamContent(provider, parsed);
              if (content) {
                mainWindow?.webContents.send('chat:stream-chunk', content);
              }
            } catch (e) { /* ignore parse errors */ }
          }
        });

        res.on('end', () => {
          // Process remaining buffer
          if (buffer) {
            for (const line of buffer.split('\n')) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const content = extractStreamContent(provider, parsed);
                if (content) mainWindow?.webContents.send('chat:stream-chunk', content);
              } catch (e) { /* ignore */ }
            }
          }
          mainWindow?.webContents.send('chat:stream-done');
          resolve({ ok: true });
        });
      } else {
        // 情况2: 非流式 JSON 响应 (application/json)
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          console.log(`[chat:stream] non-streaming response: ${data.slice(0, 300)}`);
          try {
            const json = JSON.parse(data);
            const content = extractResponse(provider, json);
            if (content) {
              mainWindow?.webContents.send('chat:stream-chunk', content);
            } else {
              mainWindow?.webContents.send('chat:stream-chunk', `(API 返回了 JSON，但未提取到内容)\n${data.slice(0, 300)}`);
            }
          } catch (e) {
            mainWindow?.webContents.send('chat:stream-chunk', `(无法解析响应)\n${data.slice(0, 300)}`);
          }
          mainWindow?.webContents.send('chat:stream-done');
          resolve({ ok: true });
        });
      }
    });

    req.on('error', (err) => {
      console.log(`[chat:stream] connection error: ${err.message}`);
      mainWindow?.webContents.send('chat:stream-chunk', `\n\n❌ 连接失败: ${err.message}`);
      mainWindow?.webContents.send('chat:stream-done');
      resolve({ error: err.message });
    });
    req.on('timeout', () => {
      req.destroy();
      mainWindow?.webContents.send('chat:stream-chunk', '\n\n❌ 请求超时，请检查网络或 API 地址');
      mainWindow?.webContents.send('chat:stream-done');
      resolve({ error: '请求超时' });
    });
    req.write(JSON.stringify(body));
    req.end();
  });
});

function callModelAPI(provider, prov, model, messages, options = {}) {
  const url = buildApiUrl(provider, prov);
  const headers = buildHeaders(provider, prov);
  const body = buildRequestBody(provider, model, messages, options);

  return httpRequest(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout: 120000,
  }).then(res => {
    if (res.status !== 200) {
      throw new Error(`API 错误 (${res.status}): ${res.data.slice(0, 500)}`);
    }
    const json = JSON.parse(res.data);
    return { content: extractResponse(provider, json) };
  });
}

function buildApiUrl(provider, prov) {
  const base = prov.baseUrl.replace(/\/+$/, '');
  switch (provider) {
    case 'openai': case 'deepseek': case 'tongyi': case 'custom':
      return `${base}/chat/completions`;
    case 'anthropic':
      return `${base}/v1/messages`;
    case 'gemini':
      return `${base}/v1beta/models/${prov.models?.[0] || 'gemini-2.0-flash'}:streamGenerateContent?alt=sse&key=${prov.apiKey}`;
    case 'zhipu':
      return `${base}/chat/completions`;
    default:
      return `${base}/chat/completions`;
  }
}

function buildHeaders(provider, prov) {
  switch (provider) {
    case 'openai': case 'deepseek': case 'tongyi': case 'custom': case 'zhipu':
      return { 'Authorization': `Bearer ${prov.apiKey}` };
    case 'anthropic':
      return { 'x-api-key': prov.apiKey, 'anthropic-version': '2023-06-01' };
    case 'gemini':
      return {}; // key 在 URL 中
    default:
      return { 'Authorization': `Bearer ${prov.apiKey}` };
  }
}

function buildRequestBody(provider, model, messages, options = {}) {
  const params = {
    temperature: options.temperature ?? config.chatDefaults?.temperature ?? 0.7,
    top_p: options.top_p ?? config.chatDefaults?.top_p ?? 1.0,
    max_tokens: options.max_tokens ?? config.chatDefaults?.max_tokens ?? 4096,
  };

  switch (provider) {
    case 'anthropic':
      const systemMsg = messages.find(m => m.role === 'system');
      const chatMsgs = messages.filter(m => m.role !== 'system');
      return {
        model,
        messages: chatMsgs.map(m => ({ role: m.role, content: m.content })),
        ...(systemMsg ? { system: systemMsg.content } : {}),
        ...params,
        stream: options.stream || false,
      };
    case 'gemini':
      const contents = messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));
      const sysMsg = messages.find(m => m.role === 'system');
      return {
        contents,
        ...(sysMsg ? { systemInstruction: { parts: [{ text: sysMsg.content }] } } : {}),
        generationConfig: { temperature: params.temperature, topP: params.top_p, maxOutputTokens: params.max_tokens },
      };
    default: // OpenAI 兼容
      return {
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        ...params,
        stream: options.stream || false,
      };
  }
}

function extractResponse(provider, json) {
  switch (provider) {
    case 'anthropic':
      return json.content?.[0]?.text || '';
    case 'gemini':
      return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    default:
      return json.choices?.[0]?.message?.content || json.choices?.[0]?.text || '';
  }
}

function extractStreamContent(provider, parsed) {
  switch (provider) {
    case 'anthropic':
      if (parsed.type === 'content_block_delta') {
        return parsed.delta?.text || '';
      }
      return '';
    case 'gemini':
      return parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
    default:
      return parsed.choices?.[0]?.delta?.content || '';
  }
}

// --- Ollama 专用管理 ---
ipcMain.handle('ollama:status', async () => {
  // 检测 Ollama 是否安装
  const { execSync } = require('child_process');
  let installed = false;
  let ollamaPath = '';
  try {
    ollamaPath = execSync('where ollama', { encoding: 'utf-8', timeout: 5000 }).trim().split('\n')[0];
    installed = true;
  } catch (e) { installed = false; }

  // 检测是否正在运行
  let running = false;
  let models = [];
  if (installed) {
    try {
      const res = await httpRequest('http://localhost:11434/api/tags', { timeout: 3000 });
      if (res.status === 200) {
        running = true;
        const json = JSON.parse(res.data);
        models = (json.models || []).map(m => ({
          name: m.name,
          size: m.size,
          modified: m.modified_at,
          sizeHuman: formatBytes(m.size),
        }));
      }
    } catch (e) { running = false; }
  }

  return { installed, ollamaPath, running, models };
});

// 拉取模型
ipcMain.handle('ollama:pull', async (e, modelName) => {
  return new Promise((resolve) => {
    const child = spawn('ollama', ['pull', modelName], {
      shell: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    let output = '';
    child.stdout?.on('data', (d) => {
      const text = d.toString();
      output += text;
      mainWindow?.webContents.send('engine:log', { id: 'ollama-pull', type: 'stdout', data: text });
    });
    child.stderr?.on('data', (d) => {
      const text = d.toString();
      output += text;
      mainWindow?.webContents.send('engine:log', { id: 'ollama-pull', type: 'stderr', data: text });
    });
    child.on('exit', (code) => {
      resolve({ ok: code === 0, output, code });
    });
    child.on('error', (err) => {
      resolve({ ok: false, error: err.message });
    });
  });
});

// 获取可用模型列表（热门模型）
ipcMain.handle('ollama:available', async () => {
  // Ollama 热门模型库
  return [
    { name: 'llama3.1', desc: 'Meta Llama 3.1 8B - 通用对话', size: '~4.7GB', tag: '🔥 推荐' },
    { name: 'llama3.1:70b', desc: 'Meta Llama 3.1 70B - 高质量', size: '~40GB', tag: '高性能' },
    { name: 'qwen2.5:7b', desc: '通义千问 2.5 7B - 中文优秀', size: '~4.4GB', tag: '🇨🇳 中文推荐' },
    { name: 'qwen2.5:32b', desc: '通义千问 2.5 32B - 高质量中文', size: '~20GB', tag: '🇨🇳 高质量' },
    { name: 'deepseek-r1:8b', desc: 'DeepSeek R1 8B - 推理模型', size: '~4.9GB', tag: '🧠 推理' },
    { name: 'deepseek-v3:8b', desc: 'DeepSeek V3 8B', size: '~4.9GB', tag: '' },
    { name: 'gemma2:9b', desc: 'Google Gemma 2 9B', size: '~5.4GB', tag: '' },
    { name: 'mistral', desc: 'Mistral 7B - 高效', size: '~4.1GB', tag: '' },
    { name: 'codellama', desc: 'Code Llama - 代码专用', size: '~3.8GB', tag: '💻 代码' },
    { name: 'phi3', desc: 'Microsoft Phi-3 - 轻量', size: '~2.2GB', tag: '⚡ 轻量' },
    { name: 'tinyllama', desc: 'TinyLlama 1.1B - 极小', size: '~637MB', tag: '⚡ 极小' },
  ];
});

// 下载 Ollama
ipcMain.handle('ollama:download', async () => {
  const url = 'https://ollama.com/download/OllamaSetup.exe';
  const { shell: shellMod } = require('child_process');
  shellMod.openExternal(url);
  return { ok: true, message: '已打开 Ollama 下载页面' };
});

// 启动 Ollama 服务
ipcMain.handle('ollama:start', async () => {
  try {
    const child = spawn('ollama', ['serve'], {
      detached: true, stdio: 'ignore', shell: true,
    });
    child.unref();
    engineProcesses['ollama'] = child;
    return { ok: true, pid: child.pid };
  } catch (err) {
    return { error: err.message };
  }
});

// 停止 Ollama
ipcMain.handle('ollama:stop', async () => {
  try {
    const { execSync } = require('child_process');
    execSync('taskkill /F /IM ollama.exe', { timeout: 5000 });
    delete engineProcesses['ollama'];
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// --- 引擎管理 ---
const ENGINE_PRESETS = {
  ollama: {
    name: 'Ollama',
    checkCmd: 'where ollama',
    installUrl: 'https://ollama.com/download/OllamaSetup.exe',
    installHint: 'Ollama 是最流行的本地大模型推理工具，支持 Llama、Qwen、DeepSeek 等模型。',
    installMethod: 'exe', // 下载 exe 安装
    postInstall: 'ollama serve',
  },
  lmstudio: {
    name: 'LM Studio',
    checkCmd: 'where lmstudio',
    installUrl: 'https://lmstudio.ai/installer/LM-Studio-Setup.exe',
    installHint: 'LM Studio 提供图形界面管理本地模型，支持 GGUF 格式。',
    installMethod: 'exe',
    postInstall: '',
  },
  localai: {
    name: 'LocalAI',
    checkCmd: 'where local-ai',
    installUrl: 'https://github.com/mudler/LocalAI/releases/latest',
    installHint: 'LocalAI 是 OpenAI API 兼容的本地推理引擎。',
    installMethod: 'manual',
  },
  vllm: {
    name: 'vLLM',
    checkCmd: 'python -c "import vllm"',
    installUrl: 'https://docs.vllm.ai/en/latest/getting_started/installation.html',
    installHint: 'vLLM 是高性能 LLM 推理引擎，需要 NVIDIA GPU 和 Python 3.9+。',
    installMethod: 'pip',
    pipCmd: 'pip install vllm',
  },
  openclaw: {
    name: '小龙虾 OpenClaw',
    checkCmd: '',
    installUrl: 'https://github.com/pjasicek/OpenClaw',
    installHint: 'OpenClaw 是 Captain Claw 的开源重制版引擎。',
    installMethod: 'manual',
  },
};

ipcMain.handle('engines:list', () => config.engines || []);

// 检测引擎是否已安装
ipcMain.handle('engines:detect', async (e, id) => {
  const preset = ENGINE_PRESETS[id];
  if (!preset || !preset.checkCmd) return { installed: false, preset: preset || null };

  return new Promise((resolve) => {
    exec(preset.checkCmd, { timeout: 10000 }, (err, stdout, stderr) => {
      resolve({
        installed: !err && err === null,
        path: stdout?.trim() || '',
        preset,
      });
    });
  });
});

// 一键安装引擎
ipcMain.handle('engines:install', async (e, id) => {
  const preset = ENGINE_PRESETS[id];
  if (!preset) return { error: '未知引擎' };

  const { shell: shellMod } = require('child_process');

  if (preset.installMethod === 'exe') {
    // 下载 exe 并运行
    const tmpPath = path.join(DATA_DIR, 'temp_install.exe');
    mainWindow?.webContents.send('engine:log', { id, type: 'install', data: `正在下载 ${preset.name}...\n` });

    try {
      const res = await httpRequest(preset.installUrl, { timeout: 300000 });
      fs.writeFileSync(tmpPath, Buffer.from(res.data, 'binary'));
      mainWindow?.webContents.send('engine:log', { id, type: 'install', data: `下载完成，启动安装程序...\n` });

      // 打开安装程序
      const { spawn: spawn2 } = require('child_process');
      spawn2(tmpPath, [], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, message: `${preset.name} 安装程序已启动，请按向导完成安装` };
    } catch (err) {
      return { error: `下载失败: ${err.message}。请手动访问 ${preset.installUrl}` };
    }
  } else if (preset.installMethod === 'pip') {
    // pip 安装
    mainWindow?.webContents.send('engine:log', { id, type: 'install', data: `正在执行: ${preset.pipCmd}\n` });

    return new Promise((resolve) => {
      const child = spawn(preset.pipCmd, [], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout?.on('data', d => { output += d.toString(); mainWindow?.webContents.send('engine:log', { id, type: 'install', data: d.toString() }); });
      child.stderr?.on('data', d => { output += d.toString(); mainWindow?.webContents.send('engine:log', { id, type: 'install', data: d.toString() }); });
      child.on('exit', (code) => {
        if (code === 0) resolve({ ok: true, message: `${preset.name} 安装成功！` });
        else resolve({ error: `安装失败 (code: ${code})。请手动执行: ${preset.pipCmd}` });
      });
      child.on('error', (err) => resolve({ error: `安装失败: ${err.message}` }));
    });
  } else {
    // manual - 打开下载页面
    shellMod.openExternal(preset.installUrl);
    return { ok: true, message: `已打开 ${preset.name} 下载页面，请手动下载安装` };
  }
});

ipcMain.handle('engines:update', (e, id, data) => {
  const idx = config.engines.findIndex(e => e.id === id);
  if (idx >= 0) {
    config.engines[idx] = { ...config.engines[idx], ...data };
  } else {
    config.engines.push(data);
  }
  saveConfig();
  return true;
});

ipcMain.handle('engines:check', async (e, id) => {
  const eng = config.engines.find(e => e.id === id);
  if (!eng) return { status: 'unknown' };

  // 尝试多个检测 URL
  const urls = [
    eng.statusUrl,
    `http://localhost:${eng.port}/v1/models`,
    `http://localhost:${eng.port}/api/tags`,
    `http://localhost:${eng.port}/`,
  ].filter(Boolean);
  // 去重
  const uniqueUrls = [...new Set(urls)];

  for (const url of uniqueUrls) {
    try {
      const res = await httpRequest(url, { timeout: 3000 });
      if (res.status === 200) {
        let models = [];
        try {
          const json = JSON.parse(res.data);
          models = json.models || json.data?.map(m => m.id || m) || [];
        } catch (e) { /* ignore */ }
        return { status: 'running', models, url };
      }
    } catch (e) {
      // 继续尝试下一个 URL
    }
  }

  return { status: 'stopped' };
});

ipcMain.handle('engines:start', async (e, id) => {
  const eng = config.engines.find(e => e.id === id);
  if (!eng) return { error: '引擎不存在' };
  if (engineProcesses[id]) return { error: '引擎已在运行' };
  if (!eng.command) return { error: '未配置启动命令' };

  try {
    const child = spawn(eng.command, [], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      cwd: DATA_DIR,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });

    engineProcesses[id] = child;

    // 收集启动初期的输出，用于判断是否启动失败
    let earlyOutput = '';
    const earlyHandler = (d) => {
      // Windows cmd 输出是 GBK 编码，尝试转换为 UTF-8
      let text = d.toString('utf-8');
      // 如果包含大量非 ASCII 字符，可能是编码问题，尝试 latin1 解码后标记
      if (/[�]/.test(text) || (text.match(/[^\x00-\x7F]/g) || []).length > text.length * 0.3) {
        text = d.toString('latin1');
      }
      earlyOutput += text;
      mainWindow?.webContents.send('engine:log', { id, type: 'stderr', data: text });
    };
    child.stderr?.on('data', earlyHandler);
    child.stdout?.on('data', (d) => {
      mainWindow?.webContents.send('engine:log', { id, type: 'stdout', data: d.toString() });
    });

    child.on('exit', (code) => {
      delete engineProcesses[id];
      let errorMsg = '';
      if (code !== 0) {
        const cmdName = (eng.command || '').split(' ')[0];
        // 检测常见错误模式（GBK 乱码也包含这些 ASCII 片段）
        const hasGarbled = (earlyOutput.match(/[\x80-\xFF]/g) || []).length > 5;
        if (hasGarbled || earlyOutput.includes('not recognized') || earlyOutput.includes('not found') || earlyOutput.includes('No such file')) {
          errorMsg = `CMD_NOT_FOUND:${cmdName}`;
        } else if (earlyOutput.includes('No module named')) {
          errorMsg = `MODULE_MISSING:${earlyOutput.match(/No module named \w+/)?.[0] || earlyOutput.trim().slice(0, 80)}`;
        } else if (earlyOutput.includes('Error') || earlyOutput.includes('error')) {
          const errLine = earlyOutput.split('\n').find(l => l.toLowerCase().includes('error'));
          errorMsg = `ERROR:${errLine?.trim().slice(0, 120) || 'Unknown error'}`;
        } else {
          errorMsg = `EXIT_CODE:${code}`;
        }
      }
      mainWindow?.webContents.send('engine:exit', { id, code, error: errorMsg });
    });
    child.on('error', (err) => {
      delete engineProcesses[id];
      mainWindow?.webContents.send('engine:exit', { id, code: -1, error: err.message });
    });

    return { ok: true, pid: child.pid };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('engines:stop', (e, id) => {
  const proc = engineProcesses[id];
  if (!proc) return { error: '引擎未运行' };
  try {
    proc.kill('SIGTERM');
    setTimeout(() => { if (engineProcesses[id]) engineProcesses[id].kill('SIGKILL'); }, 5000);
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('engines:status', () => {
  const result = {};
  for (const id in engineProcesses) {
    result[id] = { running: true, pid: engineProcesses[id].pid };
  }
  return result;
});

// --- 工具 ---
ipcMain.handle('shell:openExternal', (e, url) => shell.openExternal(url));
ipcMain.handle('clipboard:write', (e, text) => { clipboard.writeText(text); return true; });

// --- 聊天文件操作 ---
ipcMain.handle('chat:export', async (e, conv) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出对话',
    defaultPath: `${conv.title || '对话'}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled) return { canceled: true };

  const isJson = result.filePath.endsWith('.json');
  const content = isJson
    ? JSON.stringify(conv, null, 2)
    : conv.messages.map(m => `**${m.role === 'user' ? '你' : 'AI'}**\n\n${m.content}`).join('\n\n---\n\n');

  fs.writeFileSync(result.filePath, content, 'utf-8');
  return { ok: true, path: result.filePath };
});

// ============ 窗口创建 ============
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0d1117',
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ============ 生命周期 ============
app.whenReady().then(() => {
  loadConfig();
  createWindow();
  app.on('activate', () => { if (!mainWindow) createWindow(); });
});

app.on('window-all-closed', () => {
  // 停止所有引擎进程
  for (const id in engineProcesses) {
    try { engineProcesses[id].kill(); } catch (e) { /* */ }
  }
  if (process.platform !== 'darwin') app.quit();
});
