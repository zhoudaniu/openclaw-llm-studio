/**
 * OpenClaw LLM Studio - 前端核心逻辑
 */
let config = null;
let conversations = [];
let currentConvId = null;
let isStreaming = false;
let streamBuffer = '';
let currentConvRef = null; // 当前正在处理的对话引用
let currentAiMsgRef = null; // 当前正在处理的 AI 消息引用
let attachedFiles = []; // 已附加的文件 [{name, size, content, ext}]

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', async () => {
    config = await api.getConfig();
    conversations = await api.listConversations();

    initNavigation();
    initChatInput();
    initSettingsListeners();
    initEngineListeners();
    initStreamListeners();

    // 应用保存的主题和语言
    applyTheme(config.theme || 'dark');
    applyLanguage(config.language || 'zh-CN');

    populateModelSelect();

    // 恢复上次对话
    if (conversations.length > 0) {
        renderConvList();
        switchToConversation(conversations[0].id);
    }
});

// ============ 导航 ============
function initNavigation() {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-page').forEach((p) => p.classList.remove('active'));
            document.getElementById(`tab-${tab}`)?.classList.add('active');

            // 聊天侧栏显示/隐藏
            const chatSidebar = document.getElementById('chatSidebar');
            if (chatSidebar) chatSidebar.classList.toggle('hidden', tab !== 'chat');

            if (tab === 'engines') renderEngines();
            if (tab === 'settings') renderSettings();
        });
    });
}

// ============ 模型选择 ============
const PROVIDER_ICONS = {
    openai: '🟢',
    anthropic: '🅰️',
    gemini: '💎',
    deepseek: '🐋',
    tongyi: '🧠',
    zhipu: '🔵',
    moonshot: '🌙',
    doubao: '🫘',
    siliconflow: '⚡',
    xiaomi: '📱',
    custom: '⚙️',
    ollama: '🦙'
};
let ollamaLocalModels = []; // 本地 Ollama 模型缓存

async function populateModelSelect() {
    const leftEl = document.getElementById('ddLeft');
    if (!leftEl) return;

    // 先刷新本地 Ollama 模型
    await refreshOllamaModels();

    let html = '';

    // 本地模型组（如果有）
    if (ollamaLocalModels.length > 0) {
        html += `<div class="dd-prov active-local" data-prov="__local__" onmouseenter="hoverProv('__local__')" onclick="clickProv('__local__')">
      <span class="dd-prov-icon">🦙</span>
      <span class="dd-prov-name">${L('localModels') || '本地模型'}</span>
      <span class="dd-prov-check">✓</span>
    </div>`;
    }

    // 云端供应商
    for (const [id, prov] of Object.entries(config.providers)) {
        if (!prov.enabled || !prov.models?.length) continue;
        const icon = PROVIDER_ICONS[id] || '🔹';
        const freeTag = prov.free
            ? ' <span style="font-size:9px;padding:1px 5px;border-radius:6px;background:var(--green-dim);color:var(--green);margin-left:4px;">FREE</span>'
            : '';
        html += `<div class="dd-prov" data-prov="${id}" onmouseenter="hoverProv('${id}')" onclick="clickProv('${id}')">
      <span class="dd-prov-icon">${icon}</span>
      <span class="dd-prov-name">${escapeHtml(prov.name)}${freeTag}</span>
      <span class="dd-prov-check">✓</span>
    </div>`;
    }

    leftEl.innerHTML = html || '<div style="padding:12px;color:var(--text-3);font-size:12px;">无可用供应商</div>';

    // 自动选中
    const savedProv = config.defaultProvider;
    if (savedProv === '__local__' && ollamaLocalModels.length > 0) {
        hoverProv('__local__');
    } else if (savedProv && config.providers[savedProv]?.models?.length) {
        hoverProv(savedProv);
    } else if (ollamaLocalModels.length > 0) {
        hoverProv('__local__');
    } else {
        const first = Object.keys(config.providers).find(
            (k) => config.providers[k]?.enabled && config.providers[k]?.models?.length
        );
        if (first) hoverProv(first);
    }

    updateModelLabel();
}

async function refreshOllamaModels() {
    try {
        const status = await api.ollamaStatus();
        ollamaLocalModels = (status.models || []).map((m) => ({
            name: m.name,
            size: m.sizeHuman || ''
        }));
    } catch (e) {
        ollamaLocalModels = [];
    }
}

function hoverProv(id) {
    activeProvId = id;
    document.querySelectorAll('.dd-prov').forEach((el) => {
        el.classList.toggle('active', el.dataset.prov === id);
    });

    const ddRightTitle = document.getElementById('ddRightTitle');
    const ddRightBadge = document.getElementById('ddRightBadge');
    const ddRightUrl = document.getElementById('ddRightUrl');
    const ddModels = document.getElementById('ddModels');
    const currentVal = `${config.defaultProvider}:${config.defaultModel}`;

    if (id === '__local__') {
        ddRightTitle.textContent = L('localModels') || '本地模型 (Ollama)';
        ddRightBadge.textContent = `${ollamaLocalModels.length} models`;
        ddRightBadge.className = 'dd-right-badge ok';
        ddRightUrl.textContent = 'localhost:11434';
        ddModels.innerHTML =
            ollamaLocalModels
                .map((m) => {
                    const val = `ollama:${m.name}`;
                    const sel = val === currentVal ? ' selected' : '';
                    return `<div class="dd-model-item${sel}" data-val="${val}" onclick="selectModel('${val}')">
        <span class="mi-id">${escapeHtml(m.name)}</span>
        <span style="font-size:11px;color:var(--text-3)">${m.size}</span>
        <span class="mi-check">✓</span>
      </div>`;
                })
                .join('') ||
            `<div style="padding:12px;color:var(--text-3);font-size:12px;">${L('noLocalModels') || '暂无本地模型，请先拉取'}</div>`;
        return;
    }

    const prov = config.providers[id];
    if (!prov) return;
    const hasKey = !!prov.apiKey;
    ddRightTitle.textContent = prov.name;
    ddRightBadge.textContent = hasKey ? L('configured') : L('noKeyHint');
    ddRightBadge.className = `dd-right-badge ${hasKey ? 'ok' : 'nokey'}`;
    ddRightUrl.textContent = prov.baseUrl || '';
    ddModels.innerHTML =
        (prov.models || [])
            .map((m) => {
                const val = `${id}:${m}`;
                const sel = val === currentVal ? ' selected' : '';
                return `<div class="dd-model-item${sel}" data-val="${val}" onclick="selectModel('${val}')">
      <span class="mi-id">${escapeHtml(m)}</span>
      <span class="mi-check">✓</span>
    </div>`;
            })
            .join('') || '<div style="padding:12px;color:var(--text-3)">无可用模型</div>';
}

function clickProv(id) {
    // 点击供应商也可以切换到该供应商
    hoverProv(id);
}

let dropdownOpen = false;

function toggleDropdown() {
    const cascade = document.getElementById('ddCascade');
    dropdownOpen = !dropdownOpen;
    cascade.classList.toggle('open', dropdownOpen);
    if (dropdownOpen) {
        setTimeout(() => document.addEventListener('click', closeDropdownOnClick), 0);
    }
}

function closeDropdownOnClick(e) {
    const dd = document.getElementById('modelDropdown');
    if (dd && !dd.contains(e.target)) {
        dropdownOpen = false;
        document.getElementById('ddCascade').classList.remove('open');
        document.removeEventListener('click', closeDropdownOnClick);
    }
}

function selectModel(val) {
    dropdownOpen = false;
    document.getElementById('ddCascade').classList.remove('open');
    document.removeEventListener('click', closeDropdownOnClick);

    const [provider, ...modelParts] = val.split(':');
    const model = modelParts.join(':');

    // 持久化
    api.setConfig('defaultProvider', provider);
    api.setConfig('defaultModel', model);
    config.defaultProvider = provider;
    config.defaultModel = model;

    // 更新选中态
    document.querySelectorAll('.dd-model-item').forEach((el) => {
        el.classList.toggle('selected', el.dataset.val === val);
    });

    updateModelLabel();
    const displayName = provider === 'ollama' ? `🦙 ${model}` : model;
    toast(`${L('switchModel')} ${displayName}`, 'success');
}

function updateModelLabel() {
    const model = config.defaultModel || L('selectModel');
    const provider = config.defaultProvider;
    const prefix = provider === 'ollama' ? '🦙 ' : '';
    document.getElementById('ddLabel').textContent = prefix + model;
}

function getCurrentModel() {
    return { provider: config.defaultProvider || '', model: config.defaultModel || '' };
}

// ============ 对话管理 ============
function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function createConversation() {
    const conv = {
        id: genId(),
        title: '新对话',
        model: document.getElementById('modelSelect')?.value || '',
        messages: [],
        createdAt: Date.now()
    };
    conversations.unshift(conv);
    saveConversations();
    renderConvList();
    switchToConversation(conv.id);
    return conv;
}

function switchToConversation(id) {
    currentConvId = id;
    renderConvList();
    renderMessages();
}

function deleteConversation(id) {
    conversations = conversations.filter((c) => c.id !== id);
    saveConversations();
    if (currentConvId === id) {
        currentConvId = conversations[0]?.id || null;
        renderMessages();
    }
    renderConvList();
}

function saveConversations() {
    api.saveConversations(conversations);
}

function renderConvList() {
    const list = document.getElementById('convList');
    list.innerHTML = conversations
        .map(
            (c) => `
    <div class="conv-item ${c.id === currentConvId ? 'active' : ''}" onclick="switchToConversation('${c.id}')">
      <div style="flex:1;min-width:0;">
        <div class="conv-title">${escapeHtml(c.title)}</div>
        <div class="conv-model">${c.model?.split(':')[1] || ''}</div>
      </div>
      <button class="conv-delete" onclick="event.stopPropagation();deleteConversation('${c.id}')" title="删除">✕</button>
    </div>
  `
        )
        .join('');
}

// ============ 消息渲染 ============
function renderMessages() {
    const container = document.getElementById('chatMessages');
    const conv = conversations.find((c) => c.id === currentConvId);

    if (!conv || conv.messages.length === 0) {
        container.innerHTML = `
      <div class="welcome-screen">
        <div class="welcome-logo">🦞</div>
        <h2>OpenClaw LLM Studio</h2>
        <p>${L('tip1').replace(/^.{2}/, '')} · Claude · Gemini · DeepSeek · 通义千问 · 智谱GLM</p>
        <div class="welcome-tips">
          <div class="tip" onclick="insertPrompt('${L('tip1').replace(/^.{2}/, '')}')">${L('tip1')}</div>
          <div class="tip" onclick="insertPrompt('${L('tip2').replace(/^.{2}/, '')}')">${L('tip2')}</div>
          <div class="tip" onclick="insertPrompt('${L('tip3').replace(/^.{2}/, '')}')">${L('tip3')}</div>
        </div>
      </div>`;
        return;
    }

    container.innerHTML = conv.messages.map((m, i) => renderMessage(m, i)).join('');
    container.scrollTop = container.scrollHeight;
}

function renderMessage(msg, index) {
    const isUser = msg.role === 'user';
    const avatar = isUser ? '你' : '🦞';
    const label = isUser ? '你' : 'AI';
    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '';

    // 文件附件标记
    let fileTag = '';
    if (msg.files && msg.files.length > 0) {
        fileTag =
            '<div class="msg-files">' +
            msg.files
                .map(
                    (f) =>
                        `<span class="msg-file-tag">📄 ${escapeHtml(f.name)} <span style="opacity:0.5">(${formatFileSize(f.size)}${f.truncated ? `, 已读取${f.readPercent}%` : ''})</span></span>`
                )
                .join('') +
            '</div>';
    }

    // 用户消息显示时去掉文件内容块，只保留用户输入的文字
    let displayContent = msg.content;
    if (isUser && msg.files && msg.files.length > 0) {
        displayContent = msg.content.replace(/\n```\n[\s\S]*?```\s*$/g, '').trim();
    }

    return `
    <div class="msg-row ${msg.role}">
      <div class="msg-avatar">${avatar}</div>
      <div class="msg-body">
        <div class="msg-meta">${label} ${time}</div>
        ${fileTag}
        <div class="msg-content">${isUser ? escapeHtml(displayContent) : renderMarkdown(msg.content)}</div>
        <div class="msg-actions">
          <button class="msg-action" onclick="copyMessage(${index})">复制</button>
          ${!isUser ? `<button class="msg-action" onclick="regenerateMessage(${index})">重新生成</button>` : ''}
        </div>
      </div>
    </div>`;
}

// ============ 发送消息 ============
function initChatInput() {
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('btnSend');

    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 150) + 'px';
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    btn.addEventListener('click', () => {
        if (isStreaming) {
            stopStream();
            return;
        }
        sendMessage();
    });

    // 附件按钮
    // document.getElementById('btnAttach')?.addEventListener('click', async () => {
    //     const result = await api.openFileDialog();
    //     if (result?.paths) addFiles(result.paths);
    // });

    // 拖拽上传
    const chatArea = document.getElementById('chatMessages');
    const dropOverlay = document.getElementById('dropOverlay');
    let dragCounter = 0;

    chatArea?.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (dropOverlay) dropOverlay.classList.add('active');
    });

    chatArea?.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            if (dropOverlay) dropOverlay.classList.remove('active');
        }
    });

    chatArea?.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    chatArea?.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        if (dropOverlay) dropOverlay.classList.remove('active');
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            const paths = files.map((f) => f.path).filter(Boolean);
            if (paths.length > 0) addFiles(paths);
        }
    });

    // 同时支持在输入区域拖拽
    const inputArea = document.getElementById('chatInputArea');
    inputArea?.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (dropOverlay) dropOverlay.classList.add('active');
    });
    inputArea?.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            if (dropOverlay) dropOverlay.classList.remove('active');
        }
    });
    inputArea?.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    inputArea?.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        if (dropOverlay) dropOverlay.classList.remove('active');
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            const paths = files.map((f) => f.path).filter(Boolean);
            if (paths.length > 0) addFiles(paths);
        }
    });

    document.getElementById('btnNewChat')?.addEventListener('click', createConversation);
    document.getElementById('btnExportChat')?.addEventListener('click', exportChat);
    document.getElementById('btnClearChat')?.addEventListener('click', clearChat);
}

// ============ 文件上传 ============
const MAX_FILES = 5;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function addFiles(paths) {
    if (attachedFiles.length >= MAX_FILES) {
        toast(`最多同时附 ${MAX_FILES} 个文件`, 'error');
        return;
    }
    const remaining = MAX_FILES - attachedFiles.length;
    const toLoad = paths.slice(0, remaining);
    if (paths.length > remaining) {
        toast(`已达上限，仅添加前 ${remaining} 个文件`, 'error');
    }

    const results = await api.readFiles(toLoad);
    for (const file of results) {
        if (file.error) {
            toast(`❌ ${file.name}: ${file.error}`, 'error');
            continue;
        }
        if (file.truncated) {
            toast(`📄 ${file.name} 内容过长，已读取前 ${file.readPercent}%`, 'error');
        }
        // 避免重复添加同名文件
        attachedFiles = attachedFiles.filter((f) => f.name !== file.name);
        attachedFiles.push(file);
    }
    renderAttachmentBar();
}

function removeFile(index) {
    attachedFiles.splice(index, 1);
    renderAttachmentBar();
}

function renderAttachmentBar() {
    const bar = document.getElementById('attachmentBar');
    if (!bar) return;
    if (attachedFiles.length === 0) {
        bar.innerHTML = '';
        bar.style.display = 'none';
        return;
    }
    bar.style.display = 'flex';
    bar.innerHTML = attachedFiles
        .map(
            (f, i) => `
    <div class="attachment-chip">
      <span class="attachment-icon">📄</span>
      <span class="attachment-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span class="attachment-size">${formatFileSize(f.size)}</span>
      <button class="attachment-remove" onclick="removeFile(${i})" title="移除">✕</button>
    </div>
  `
        )
        .join('');
}

function insertPrompt(text) {
    const input = document.getElementById('chatInput');
    input.value = text;
    input.focus();
    input.dispatchEvent(new Event('input'));
}

async function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if ((!text && attachedFiles.length === 0) || isStreaming) return;

    // 确保有对话
    if (!currentConvId) createConversation();
    const conv = conversations.find((c) => c.id === currentConvId);
    if (!conv) return;

    // 构建完整消息内容（文件 + 文本）
    let fullContent = text;
    let fileAttachments = null;
    if (attachedFiles.length > 0) {
        fileAttachments = attachedFiles.map((f) => ({ name: f.name, size: f.size, ext: f.ext }));
        const fileParts = attachedFiles.map((f) => `\n\`\`\`\n${f.content}\n\`\`\``);
        // 用户问题在前，文件内容在后，模型更容易理解
        fullContent = (text || '请分析以上文件') + '\n' + fileParts.join('\n');
        console.log('[sendMessage] fullContent length:', fullContent.length);
        console.log('[sendMessage] fullContent preview:', fullContent.slice(0, 200));
    }

    // 添加用户消息
    const userMsg = { role: 'user', content: fullContent, timestamp: Date.now(), files: fileAttachments };
    conv.messages.push(userMsg);

    // 自动标题（取第一条消息前20字）
    if (conv.messages.length === 1) {
        conv.title = (text || fileAttachments?.[0]?.name || '新对话').slice(0, 20);
        renderConvList();
    }

    input.value = '';
    input.style.height = 'auto';
    attachedFiles = [];
    renderAttachmentBar();
    renderMessages();

    // 获取模型
    const { provider, model } = getCurrentModel();
    if (!provider || !model) {
        toast(L('selectModel') || '请先选择模型', 'error');
        return;
    }
    const isOllama = provider === 'ollama';

    // 添加 AI 占位消息
    const aiMsg = { role: 'assistant', content: '', timestamp: Date.now() };
    conv.messages.push(aiMsg);

    // 开始流式输出
    isStreaming = true;
    streamBuffer = '';
    currentConvRef = conv;
    currentAiMsgRef = aiMsg;
    setSendButtonLoading(true);
    renderMessages();
    showTypingIndicator();

    // 注入当前时间到系统提示
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
    });
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    let sysContent = L('sysPrompt').replace('{date}', dateStr).replace('{time}', timeStr);

    // 从最后一条用户消息中提取文件内容，放到系统提示词中
    const lastUserMsg = conv.messages[conv.messages.length - 2]; // AI placeholder 前面那条
    let userText = lastUserMsg?.content || text;
    if (lastUserMsg?.files && lastUserMsg.files.length > 0) {
        const fileMatch = lastUserMsg.content.match(/\n```\n([\s\S]*?)```\s*$/);
        if (fileMatch) {
            sysContent +=
                '\n\n【用户上传的文件内容】以下是用户上传的文件，请根据用户的问题分析此文件，不要复述文件内容，直接回答问题：\n```\n' +
                fileMatch[1] +
                '\n```';
            userText = lastUserMsg.content.replace(/\n```\n[\s\S]*?```\s*$/g, '').trim();
        }
    }
    const sysMsg = { role: 'system', content: sysContent };

    // 构建 API 消息：用户消息只保留文字，文件内容已在系统提示中
    const allMsgs = conv.messages.slice(0, -1);
    const historyMsgs = allMsgs.map((m, i) => {
        let content = m.content;
        // 所有用户消息都去掉文件内容块
        if (m.role === 'user' && m.files && m.files.length > 0) {
            content = content.replace(/\n```\n[\s\S]*?```\s*$/g, '').trim();
        }
        return { role: m.role, content };
    });
    const apiMessages = [sysMsg, ...historyMsgs];

    // Debug: 打印发送给 API 的最后一条用户消息
    const debugLastUser = [...apiMessages].reverse().find((m) => m.role === 'user');
    console.log('[sendMessage] last user msg for API:', debugLastUser?.content?.slice(0, 300));

    if (isOllama) {
        // Ollama 本地调用
        ollamaChat(model, apiMessages).catch((err) => {
            if (isStreaming) finishStreaming(`❌ ${err.message}`);
        });
    } else {
        // 云端 API 调用
        api.chatStream({
            provider,
            model,
            messages: apiMessages,
            options: {
                temperature: config.chatDefaults?.temperature,
                top_p: config.chatDefaults?.top_p,
                max_tokens: config.chatDefaults?.max_tokens
            }
        })
            .then((result) => {
                if (result?.error && isStreaming) finishStreaming(`❌ ${result.error}`);
            })
            .catch((err) => {
                if (isStreaming) finishStreaming(`❌ ${err.message}`);
            });
    }
}

// Ollama 本地流式调用
async function ollamaChat(model, messages) {
    try {
        const response = await fetch('http://localhost:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: messages.map((m) => ({ role: m.role, content: m.content })),
                stream: true
            })
        });
        if (!response.ok) {
            const err = await response.text();
            return finishStreaming(`❌ Ollama (${response.status}): ${err.slice(0, 200)}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line);
                    if (json.message?.content) {
                        streamBuffer += json.message.content;
                        updateStreamingMessage(streamBuffer);
                    }
                } catch (e) {
                    /* ignore */
                }
            }
        }
        finishStreaming(null);
    } catch (err) {
        finishStreaming(`❌ Ollama 连接失败: ${err.message}`);
    }
}

// 统一的流式结束处理
function finishStreaming(content) {
    const conv = currentConvRef;
    const aiMsg = currentAiMsgRef;

    if (conv && aiMsg) {
        // 优先使用 streamBuffer（流式输出的内容），其次用传入的 content（错误信息）
        aiMsg.content = streamBuffer || content || '(空响应)';
        aiMsg.timestamp = Date.now();
    }

    isStreaming = false;
    streamBuffer = '';
    currentConvRef = null;
    currentAiMsgRef = null;
    setSendButtonLoading(false);
    renderMessages();
    saveConversations();
}

function initStreamListeners() {
    api.onStreamChunk((chunk) => {
        if (!isStreaming) return; // 忽略非活动流的 chunk
        streamBuffer += chunk;
        updateStreamingMessage(streamBuffer);
    });

    api.onStreamDone(() => {
        if (!isStreaming) return; // 忽略非活动流的 done
        finishStreaming(null);
    });
}

function showTypingIndicator() {
    const container = document.getElementById('chatMessages');
    const rows = container.querySelectorAll('.msg-row');
    const lastRow = rows[rows.length - 1];
    if (!lastRow) return;

    const contentEl = lastRow.querySelector('.msg-content');
    if (contentEl) {
        contentEl.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    }
}

function updateStreamingMessage(text) {
    const container = document.getElementById('chatMessages');
    const rows = container.querySelectorAll('.msg-row');
    const lastRow = rows[rows.length - 1];
    if (!lastRow) return;

    const contentEl = lastRow.querySelector('.msg-content');
    if (contentEl) {
        contentEl.innerHTML = renderMarkdown(text);
    }
    container.scrollTop = container.scrollHeight;
}

function setSendButtonLoading(loading) {
    const btn = document.getElementById('btnSend');
    if (loading) {
        btn.classList.add('loading');
        btn.disabled = false; // 保持可点击，用于停止
        btn.innerHTML =
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
        btn.title = '停止生成';
    } else {
        btn.classList.remove('loading');
        btn.disabled = false;
        btn.innerHTML =
            '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/></svg>';
        btn.title = '发送';
    }
}

async function stopStream() {
    await api.stopStream();
    finishStreaming(null);
}

// ============ 消息操作 ============
function copyMessage(index) {
    const conv = conversations.find((c) => c.id === currentConvId);
    if (!conv || !conv.messages[index]) return;
    api.copyText(conv.messages[index].content);
    toast('已复制到剪贴板', 'success');
}

async function regenerateMessage(index) {
    if (isStreaming) return;
    const conv = conversations.find((c) => c.id === currentConvId);
    if (!conv) return;

    // 删除从这条消息开始的所有消息
    conv.messages = conv.messages.slice(0, index);
    saveConversations();
    renderMessages();

    // 重新发送最后一条用户消息
    const lastUserMsg = [...conv.messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
        document.getElementById('chatInput').value = lastUserMsg.content;
        conv.messages = conv.messages.filter((m) => m !== lastUserMsg);
        renderMessages();
        await sendMessage();
    }
}

async function clearChat() {
    const conv = conversations.find((c) => c.id === currentConvId);
    if (!conv) return;
    if (!(await confirmDialog('确定清空当前对话？'))) return;
    conv.messages = [];
    saveConversations();
    renderMessages();
}

async function exportChat() {
    const conv = conversations.find((c) => c.id === currentConvId);
    if (!conv) return;
    const result = await api.exportChat(conv);
    if (result.ok) toast('导出成功: ' + result.path, 'success');
    else if (!result.canceled) toast('导出失败', 'error');
}

// ============ 引擎管理 ============
let engineStatusCache = {}; // id -> { status, models }

function initEngineListeners() {
    api.onEngineLog(({ id, type, data }) => {
        const logEl = document.getElementById(`engine-log-${id}`);
        if (logEl) {
            logEl.style.display = 'block';
            logEl.textContent += data;
            logEl.scrollTop = logEl.scrollHeight;
        }
    });

    api.onEngineExit(({ id, code, error }) => {
        if (code !== 0) {
            const logEl = document.getElementById(`engine-log-${id}`);
            let displayError = '';
            if (error.startsWith('CMD_NOT_FOUND:')) {
                const cmd = error.split(':')[1];
                displayError = L('cmdNotFound').replace('{cmd}', cmd);
            } else if (error.startsWith('MODULE_MISSING:')) {
                displayError = error.replace('MODULE_MISSING:', '');
            } else if (error.startsWith('ERROR:')) {
                displayError = error.replace('ERROR:', '');
            } else if (error.startsWith('EXIT_CODE:')) {
                displayError = `${L('engineStartFailed')} (code: ${error.split(':')[1]})`;
            } else {
                displayError = error || `${L('engineStartFailed')} (code: ${code})`;
            }

            if (logEl) {
                logEl.style.display = 'block';
                logEl.textContent = `❌ ${displayError}`;
                logEl.style.color = 'var(--red)';
            }
            toast(`⚠️ ${displayError}`, 'error');
        }
        delete engineStatusCache[id];
        setTimeout(() => updateEngineCard(id, { status: 'stopped' }), 500);
    });
}

// ============ Ollama 安装向导 & 模型拉取 ============
let ollamaStatusCache = null;

async function openOllamaWizard() {
    const status = await api.ollamaStatus();
    ollamaStatusCache = status;

    if (!status.installed) {
        // 未安装 → 安装向导
        const result = await showModal({
            title: '🦙 Ollama 安装向导',
            fields: [
                {
                    id: 'info',
                    type: 'textarea',
                    label: 'Ollama 是什么？',
                    value: 'Ollama 是最流行的本地大模型推理框架，支持 Llama、Qwen、DeepSeek 等 100+ 模型。\n\n安装后即可在本应用中直接使用本地模型，完全离线运行，无需 API Key。'
                },
                {
                    id: 'step1',
                    label: '安装步骤',
                    value: '1. 点击下方按钮打开下载页\n2. 下载并运行安装程序\n3. 安装完成后回到此页面点击「检测」'
                }
            ],
            buttons: [
                { label: L('cancel'), style: 'btn-sm', action: false },
                { label: '🔗 下载 Ollama', style: 'btn-primary', action: 'install' }
            ]
        });
        if (result?._action === 'install') {
            api.ollamaDownload();
            toast('已打开 Ollama 下载页面', 'success');
        }
        return;
    }

    // 已安装 → 模型管理面板
    renderOllamaPanel(status);
}

function renderOllamaPanel(status) {
    const grid = document.getElementById('engineGrid');
    if (!grid) return;

    const modelsHtml = (status.models || [])
        .map(
            (m) => `
    <div class="ollama-model-item">
      <span class="ollama-model-name">🦙 ${escapeHtml(m.name)}</span>
      <span class="ollama-model-size">${m.sizeHuman}</span>
    </div>
  `
        )
        .join('');

    // 在引擎卡片前面插入 Ollama 管理面板
    const panel = document.createElement('div');
    panel.className = 'ollama-panel';
    panel.innerHTML = `
    <div class="ollama-panel-header">
      <h3>🦙 Ollama 本地模型管理</h3>
      <span class="engine-status ${status.running ? 'running' : 'stopped'}">${status.running ? L('running') : L('stopped')}</span>
    </div>
    <div class="ollama-models">
      ${modelsHtml || `<div style="padding:12px;color:var(--text-3);font-size:13px;">暂无已安装模型，拉取一个开始使用：</div>`}
    </div>
    <div class="ollama-actions">
      <div class="pull-section">
        <select id="ollamaPullSelect" class="sel-text" style="width:auto;min-width:200px;">
          <option value="">选择要拉取的模型...</option>
        </select>
        <button class="btn-primary btn-sm" onclick="pullOllamaModel()" id="btnPullModel">⬇️ 拉取</button>
      </div>
      <div id="pullProgress" style="display:none;margin-top:8px;font-size:12px;color:var(--accent);"></div>
    </div>`;

    // 移除旧面板
    const oldPanel = grid.querySelector('.ollama-panel');
    if (oldPanel) oldPanel.remove();
    grid.insertBefore(panel, grid.firstChild);

    // 加载可用模型列表
    loadAvailableModels();
}

async function loadAvailableModels() {
    const models = await api.ollamaAvailable();
    const sel = document.getElementById('ollamaPullSelect');
    if (!sel) return;
    const existing = ollamaLocalModels.map((m) => m.name);
    sel.innerHTML =
        '<option value="">选择要拉取的模型...</option>' +
        models
            .filter((m) => !existing.includes(m.name))
            .map(
                (m) => `<option value="${m.name}">${m.tag ? m.tag + ' ' : ''}${m.name} - ${m.desc} (${m.size})</option>`
            )
            .join('') +
        (existing.length > 0
            ? '<option disabled>── 已安装 ──</option>' +
              models
                  .filter((m) => existing.includes(m.name))
                  .map((m) => `<option disabled>✅ ${m.name}</option>`)
                  .join('')
            : '');
}

async function pullOllamaModel() {
    const sel = document.getElementById('ollamaPullSelect');
    const progressEl = document.getElementById('pullProgress');
    const btn = document.getElementById('btnPullModel');
    const modelName = sel?.value;
    if (!modelName) {
        toast('请选择一个模型', 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ 拉取中...';
    progressEl.style.display = 'block';
    progressEl.textContent = `正在拉取 ${modelName}，请稍候（模型较大可能需要几分钟）...`;

    const result = await api.ollamaPull(modelName);

    btn.disabled = false;
    btn.textContent = '⬇️ 拉取';

    if (result.ok) {
        toast(`✅ ${modelName} 拉取成功！`, 'success');
        progressEl.textContent = `✅ ${modelName} 已安装完成`;
        // 刷新本地模型列表
        const status = await api.ollamaStatus();
        ollamaStatusCache = status;
        renderOllamaPanel(status);
        populateModelSelect();
    } else {
        progressEl.textContent = `❌ 拉取失败: ${result.error || '未知错误'}`;
        toast(`拉取失败: ${result.error || result.output?.slice(-100)}`, 'error');
    }
}

async function renderEngines() {
    const grid = document.getElementById('engineGrid');
    if (!grid) return;
    const engines = await api.listEngines();

    // 先渲染普通引擎卡片（同步）
    const otherCards = engines
        .filter((eng) => eng.id !== 'openclaw')
        .map((eng) => {
            const st = engineStatusCache[eng.id];
            const running = st?.status === 'running';
            const models = st?.models || [];
            const statusClass = st ? (running ? 'running' : 'stopped') : 'checking';
            const statusText = st ? (running ? L('running') : L('stopped')) : L('detecting');

            return `
      <div class="engine-card" id="card-${eng.id}">
        <div class="engine-head">
          <span class="engine-name">${escapeHtml(eng.name)}</span>
          <span class="engine-status ${statusClass}" id="est-${eng.id}">${statusText}</span>
        </div>
        <div class="engine-meta">
          <div style="margin-bottom:6px;">
            <span style="color:var(--text-3)">${L('port')}</span> ${eng.port}
            <span style="color:var(--text-3);margin-left:12px">${L('type')}</span> ${eng.type}
          </div>
          ${eng.description ? `<div style="color:var(--text-3);margin-bottom:6px;">${escapeHtml(eng.description)}</div>` : ''}
          <div style="margin-bottom:4px;">
            <span style="color:var(--text-3)">${L('cmd')}</span>
            <code style="background:var(--bg-0);padding:2px 6px;border-radius:3px;font-size:11px;color:var(--orange)">${escapeHtml(eng.command || L('notConfigured'))}</code>
          </div>
          ${models.length > 0 ? `<div style="margin-top:6px;color:var(--green);font-size:12px;">✅ ${L('availableModels')}: ${models.slice(0, 5).join(', ')}${models.length > 5 ? ` (+${models.length - 5})` : ''}</div>` : ''}
        </div>
        <div class="engine-actions">
          ${
              running
                  ? `<button class="btn-danger-sm" onclick="stopEngine('${eng.id}')">${L('stop')}</button>`
                  : `<button class="btn-success-sm" onclick="startEngine('${eng.id}')" ${!eng.command ? 'disabled style="opacity:0.4"' : ''}>${L('start')}</button>`
          }
          <button class="btn-sm" onclick="detectAndCheck('${eng.id}')">${L('detect')}</button>
          <button class="btn-sm" onclick="editEngine('${eng.id}')">${L('editConfig')}</button>
        </div>
        <div id="engine-log-${eng.id}" style="margin-top:10px;max-height:120px;overflow-y:auto;font-size:11px;color:var(--text-3);font-family:monospace;background:var(--bg-0);border-radius:4px;padding:6px 8px;display:none;white-space:pre-wrap;"></div>
      </div>`;
        })
        .join('');

    // 异步渲染小龙虾卡片
    const openclawEng = engines.find((eng) => eng.id === 'openclaw');
    const openclawCard = openclawEng ? await renderOpenClawCard(openclawEng) : '';

    grid.innerHTML = openclawCard + otherCards;

    await detectAllEngines(engines);
}

async function detectAllEngines(engines) {
    for (const eng of engines) {
        if (eng.autoDetect || eng.command) {
            try {
                const result = await api.checkEngine(eng.id);
                engineStatusCache[eng.id] = result;
                updateEngineCard(eng.id, result);
            } catch (e) {
                engineStatusCache[eng.id] = { status: 'stopped' };
                updateEngineCard(eng.id, { status: 'stopped' });
            }
        } else {
            engineStatusCache[eng.id] = { status: 'stopped' };
        }
    }
}

function updateEngineCard(id, result) {
    const card = document.getElementById(`card-${id}`);
    if (!card) return;

    const statusEl = card.querySelector('.engine-status');
    const running = result.status === 'running';
    if (statusEl) {
        statusEl.className = `engine-status ${running ? 'running' : 'stopped'}`;
        statusEl.textContent = running ? '运行中' : '未运行';
    }

    if (result.models?.length > 0) {
        const metaEl = card.querySelector('.engine-meta');
        const existing = metaEl.querySelector('.models-info');
        if (existing) existing.remove();
        const div = document.createElement('div');
        div.className = 'models-info';
        div.style.cssText = 'margin-top:6px;color:var(--green);font-size:12px;';
        div.textContent = `✅ 可用模型: ${result.models.slice(0, 5).join(', ')}${result.models.length > 5 ? ` (+${result.models.length - 5})` : ''}`;
        metaEl.appendChild(div);
    }

    const actionsEl = card.querySelector('.engine-actions');
    actionsEl.innerHTML = running
        ? `<button class="btn-danger-sm" onclick="stopEngine('${id}')">⏹ 停止</button>`
        : `<button class="btn-success-sm" onclick="startEngine('${id}')">▶ 启动</button>`;
    actionsEl.innerHTML += `
    <button class="btn-sm" onclick="detectAndCheck('${id}')">🔍 检测</button>
    <button class="btn-sm" onclick="editEngine('${id}')">✏️ 配置</button>`;
}

// 🔍 检测引擎是否安装 → 未安装则弹窗询问
async function detectAndCheck(id) {
    const eng = (await api.listEngines()).find((e) => e.id === id);
    if (!eng) return;

    const statusEl = document.getElementById(`est-${id}`);
    if (statusEl) {
        statusEl.textContent = '检测中...';
        statusEl.className = 'engine-status checking';
    }

    // 先检测是否已安装
    const detectResult = await api.detectEngine(id);

    if (detectResult.installed) {
        toast(`✅ ${detectResult.preset?.name || id} ${L('installed')}`, 'success');
        const st = await api.checkEngine(id);
        engineStatusCache[id] = st;
        updateEngineCard(id, st);
        if (st.status === 'running') {
            toast(`${id}: ${L('running')} - ${(st.models || []).length} models`, 'success');
        }
        return;
    }

    // 未安装 → 弹窗询问
    const preset = detectResult.preset;
    if (!preset) {
        toast(`${id}: ${L('notInstalled')}`, 'error');
        return;
    }

    const result = await showModal({
        title: `${preset.name} ${L('notInstalled')}`,
        fields: [
            { id: 'info', type: 'textarea', label: L('installHint'), value: preset.installHint || '' },
            { id: 'link', label: L('downloadUrl'), value: preset.installUrl || '' }
        ],
        buttons: [
            { label: L('doNotInstall'), style: 'btn-sm', action: false },
            { label: L('oneClickInstall'), style: 'btn-primary', action: 'install' },
            { label: L('openDownloadPage'), style: 'btn-sm', action: 'link' }
        ]
    });
    if (!result) return;

    if (result._action === 'install') {
        toast(`${L('installing')} ${preset.name}...`, 'success');
        const installResult = await api.installEngine(id);
        if (installResult.ok) toast(`✅ ${installResult.message}`, 'success');
        else toast(`❌ ${installResult.error}`, 'error');
    } else if (result._action === 'link') {
        api.openExternal(preset.installUrl);
        toast(`${L('openDownload')} ${preset.name}`, 'success');
    }
}

async function startEngine(id) {
    const engines = await api.listEngines();
    const eng = engines.find((e) => e.id === id);
    const name = eng?.name || id;
    const result = await api.startEngine(id);
    if (result.error) {
        toast(`❌ ${result.error}`, 'error');
        return;
    }
    toast(`⏳ ${L('installing').replace('安装', name)}... (PID: ${result.pid})`, 'success');
    setTimeout(async () => {
        const st = await api.checkEngine(id);
        engineStatusCache[id] = st;
        updateEngineCard(id, st);
        if (st.status === 'running') {
            toast(`✅ ${name}: ${L('running')}`, 'success');
        }
    }, 3000);
}

async function stopEngine(id) {
    const engines = await api.listEngines();
    const eng = engines.find((e) => e.id === id);
    const name = eng?.name || id;
    const result = await api.stopEngine(id);
    if (result.error) toast(`❌ ${result.error}`, 'error');
    else {
        toast(`${name}: ${L('stopped')}`, 'success');
        delete engineStatusCache[id];
        setTimeout(() => updateEngineCard(id, { status: 'stopped' }), 1000);
    }
}

// ============ 小龙虾 OpenClaw 专用卡片 ============
let openclawInstalled = null; // 缓存安装状态

async function renderOpenClawCard(eng) {
    // 检测是否已安装
    if (openclawInstalled === null) {
        const detect = await api.detectEngine('openclaw');
        openclawInstalled = detect.installed;
    }
    const installed = openclawInstalled;
    const st = engineStatusCache['openclaw'];
    const running = st?.status === 'running';
    const statusClass = st ? (running ? 'running' : 'stopped') : installed ? 'stopped' : 'checking';
    const statusText = st ? (running ? L('running') : L('stopped')) : installed ? '已安装' : '检测中...';

    return `
    <div class="engine-card" id="card-openclaw">
      <div class="engine-head">
        <span class="engine-name">${escapeHtml(eng.name)}</span>
        <span class="engine-status ${statusClass}" id="est-openclaw">${statusText}</span>
      </div>
      <div class="engine-meta">
        <div style="margin-bottom:6px;">
          <span style="color:var(--text-3)">端口</span> ${eng.port}
          <span style="color:var(--text-3);margin-left:12px">类型</span> ${eng.type}
        </div>
        <div style="color:var(--text-3);margin-bottom:6px;">本地推理引擎，推荐配合 Open WebUI 使用</div>
        <div style="margin-bottom:4px;">
          <span style="color:var(--text-3)">命令</span>
          <code style="background:var(--bg-0);padding:2px 6px;border-radius:3px;font-size:11px;color:var(--orange)">${escapeHtml(eng.command || '未配置')}</code>
        </div>
      </div>
      <div class="engine-actions">
        ${
            running
                ? `<button class="btn-danger-sm" onclick="stopEngine('openclaw')">⏹ 停止</button>`
                : `<button class="btn-success-sm" onclick="startOpenClaw()" ${!installed ? 'disabled style="opacity:0.4"' : ''}>▶ 启动</button>`
        }
        <button class="btn-sm btn-blue" onclick="detectOpenClawHardware()">🔍 检测</button>
        ${!installed ? `<button class="btn-sm btn-orange" onclick="installOpenClaw()">🔧 配置</button>` : ''}
      </div>
      <div id="engine-log-openclaw" style="margin-top:10px;max-height:200px;overflow-y:auto;font-size:11px;color:var(--text-3);font-family:monospace;background:var(--bg-0);border-radius:4px;padding:6px 8px;display:none;white-space:pre-wrap;"></div>
    </div>`;
}

// 启动小龙虾：先检测安装状态
async function startOpenClaw() {
    const statusEl = document.getElementById('est-openclaw');
    if (statusEl) {
        statusEl.textContent = '检测中...';
        statusEl.className = 'engine-status checking';
    }

    const detect = await api.detectEngine('openclaw');
    if (!detect.installed) {
        openclawInstalled = false;
        toast('❌ 小龙虾 OpenClaw 未安装，请先点击「配置」安装', 'error');
        renderEngines();
        return;
    }

    openclawInstalled = true;
    // 如果有安装路径但没配置命令，自动配置
    if (detect.path) {
        const engines = await api.listEngines();
        const eng = engines.find((e) => e.id === 'openclaw');
        if (eng && !eng.command) {
            await api.updateEngine('openclaw', { command: detect.path, autoDetect: true });
        }
    }

    const result = await api.startEngine('openclaw');
    if (result.error) {
        toast(`❌ ${result.error}`, 'error');
        if (statusEl) {
            statusEl.textContent = '启动失败';
            statusEl.className = 'engine-status stopped';
        }
        return;
    }

    toast('⏳ 小龙虾正在启动... (PID: ' + result.pid + ')', 'success');
    if (statusEl) {
        statusEl.textContent = '启动中...';
        statusEl.className = 'engine-status checking';
    }

    setTimeout(async () => {
        const st = await api.checkEngine('openclaw');
        engineStatusCache['openclaw'] = st;
        if (statusEl) {
            statusEl.textContent = st.status === 'running' ? '运行中' : '未运行';
            statusEl.className = `engine-status ${st.status === 'running' ? 'running' : 'stopped'}`;
        }
        if (st.status === 'running') toast('✅ 小龙虾已启动', 'success');
    }, 3000);
}

// 硬件检测
async function detectOpenClawHardware() {
    const logEl = document.getElementById('engine-log-openclaw');
    if (!logEl) return;
    logEl.style.display = 'block';
    logEl.innerHTML = '<span style="color:var(--yellow)">⏳ 正在检测硬件环境...</span>\n';

    const hw = await api.checkHardware();

    const lines = [
        '══════════════════════════════════════',
        '  🔍 硬件环境检测报告',
        '══════════════════════════════════════',
        '',
        `  ${hw.gpu.available ? '✅' : '❌'} NVIDIA GPU:  ${hw.gpu.name}  (${hw.gpu.memory})`,
        `  ${hw.python.available ? '✅' : '❌'} Python:      ${hw.python.version}`,
        `  ${hw.memory.sufficient ? '✅' : '⚠️'} 内存:        ${hw.memory.total}  ${hw.memory.sufficient ? '(充足)' : '(建议 ≥ 8GB)'}`,
        `  ${hw.disk.sufficient ? '✅' : '⚠️'} C盘剩余:     ${hw.disk.free}  ${hw.disk.sufficient ? '(充足)' : '(建议 ≥ 2GB)'}`,
        '',
        '──────────────────────────────────────',
        `  综合评估: ${hw.overall ? '✅ 满足运行要求' : '⚠️ 部分条件不满足，可能影响运行'}`,
        '══════════════════════════════════════'
    ];

    logEl.innerHTML = '';
    for (let i = 0; i < lines.length; i++) {
        await new Promise((r) => setTimeout(r, 80));
        logEl.innerHTML += escapeHtml(lines[i]) + '\n';
        logEl.scrollTop = logEl.scrollHeight;
    }
}

// 一键安装小龙虾
async function installOpenClaw() {
    const logEl = document.getElementById('engine-log-openclaw');
    if (!logEl) return;
    logEl.style.display = 'block';

    const steps = [
        { icon: '🔍', text: '环境检查', status: 'pending' },
        { icon: '📥', text: '下载安装包', status: 'pending' },
        { icon: '🔧', text: '启动安装程序', status: 'pending' },
        { icon: '✅', text: '安装完成', status: 'pending' }
    ];

    function renderSteps() {
        logEl.innerHTML =
            '<div style="color:var(--text-2);margin-bottom:8px;font-size:12px;font-family:var(--text-font);">📦 小龙虾 OpenClaw 安装向导</div>';
        steps.forEach((s) => {
            const icon = s.status === 'done' ? '✅' : s.status === 'active' ? '⏳' : s.status === 'error' ? '❌' : '⬜';
            const color =
                s.status === 'done'
                    ? 'var(--green)'
                    : s.status === 'active'
                      ? 'var(--yellow)'
                      : s.status === 'error'
                        ? 'var(--red)'
                        : 'var(--text-3)';
            logEl.innerHTML += `<div style="color:${color};margin:4px 0;font-size:12px;font-family:var(--text-font);">${icon} ${s.icon} ${s.text}${s.detail ? ` — ${s.detail}` : ''}</div>`;
        });
        logEl.scrollTop = logEl.scrollHeight;
    }

    // Step 1: 环境检查
    steps[0].status = 'active';
    renderSteps();

    const hw = await api.checkHardware();
    if (!hw.python.available) {
        steps[0].status = 'error';
        steps[0].detail = '未检测到 Python 环境';
        renderSteps();
        toast('❌ 需要 Python 3.8+ 环境，请先安装 Python', 'error');
        return;
    }
    steps[0].status = 'done';
    steps[0].detail = `Python ${hw.python.version}`;
    renderSteps();

    await new Promise((r) => setTimeout(r, 500));

    // Step 2: 下载安装包
    steps[1].status = 'active';
    renderSteps();

    const installResult = await api.installEngine('openclaw');

    if (installResult.ok) {
        steps[1].status = 'done';
        steps[1].detail = '下载完成';
        renderSteps();

        await new Promise((r) => setTimeout(r, 300));

        // Step 3: 启动安装程序
        steps[2].status = 'active';
        renderSteps();
        await new Promise((r) => setTimeout(r, 500));
        steps[2].status = 'done';
        steps[2].detail = '请在弹出的安装向导中完成安装';
        renderSteps();

        await new Promise((r) => setTimeout(r, 300));

        // Step 4: 安装完成
        steps[3].status = 'done';
        renderSteps();

        toast('✅ 安装程序已启动，请按向导完成安装', 'success');

        // 安装后重新检测
        setTimeout(async () => {
            const detect = await api.detectEngine('openclaw');
            openclawInstalled = detect.installed;
            renderEngines();
        }, 5000);
    } else {
        steps[1].status = 'error';
        steps[1].detail = installResult.error || '下载失败';
        renderSteps();
        toast(`❌ ${installResult.error}`, 'error');
    }
}

// 引擎配置编辑弹窗
async function editEngine(id) {
    const engines = await api.listEngines();
    const eng = engines.find((e) => e.id === id);
    if (!eng) return;

    const result = await showModal({
        title: `配置 "${eng.name}"`,
        fields: [
            { id: 'command', label: '启动命令', value: eng.command || '', placeholder: '例如: ollama serve' },
            { id: 'port', label: '端口号', type: 'number', value: String(eng.port || ''), placeholder: '8088' },
            {
                id: 'statusUrl',
                label: '状态检测 URL',
                value: eng.statusUrl || '',
                placeholder: `http://localhost:${eng.port}/v1/models`,
                hint: '（可留空）'
            }
        ]
    });

    if (!result) return;

    const newCommand = result.command;
    const newPort = parseInt(result.port) || eng.port;
    const newStatusUrl = result.statusUrl;

    await api.updateEngine(id, {
        command: newCommand,
        port: newPort,
        statusUrl: newStatusUrl,
        autoDetect: !!newCommand
    });

    if (!config.engines) config.engines = [];
    const idx = config.engines.findIndex((e) => e.id === id);
    if (idx >= 0) {
        config.engines[idx] = {
            ...config.engines[idx],
            command: newCommand,
            port: newPort,
            statusUrl: newStatusUrl,
            autoDetect: !!newCommand
        };
    }

    toast(`${eng.name} 配置已保存`, 'success');
    renderEngines();
}

// ============ 设置子菜单 ============
function switchSettingsTab(tab, btnEl) {
    document.querySelectorAll('.snav-item').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('.settings-panel').forEach((el) => el.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    document.getElementById(`sp-${tab}`)?.classList.add('active');
}

// ============ 主题切换 ============
function setTheme(theme) {
    config.theme = theme;
    api.setConfig('theme', theme);
    applyTheme(theme);
    document.querySelectorAll('.theme-card').forEach((el) => {
        el.classList.toggle('active', el.dataset.theme === theme);
    });
    toast(`主题已切换为: ${theme === 'dark' ? '暗色' : theme === 'light' ? '亮色' : '跟随系统'}`, 'success');
}

function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        // 监听系统主题变化
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (config.theme === 'system') {
                root.setAttribute('data-theme', e.matches ? 'dark' : 'light');
            }
        });
    } else {
        root.setAttribute('data-theme', theme);
    }
    document.querySelectorAll('.theme-card').forEach((el) => {
        el.classList.toggle('active', el.dataset.theme === theme);
    });
}

// ============ 语言切换 ============
const LANG_MAP = {
    'zh-CN': {
        name: '简体中文',
        // 通用
        save: '保存',
        cancel: '取消',
        confirm: '确定',
        delete: '删除',
        close: '关闭',
        success: '操作成功',
        error: '操作失败',
        // 导航
        chat: '对话',
        engines: '引擎管理',
        settings: '设置',
        // 聊天页
        chatPlaceholder: '输入消息... (Enter 发送, Shift+Enter 换行)',
        newChat: '新对话',
        noConvs: '暂无对话',
        welcome: '欢迎回来！',
        tip1: '💡 写一段快速排序代码',
        tip2: '🎓 解释量子计算',
        tip3: '✨ 起几个创意项目名',
        exportChat: '导出对话',
        clearChat: '清空对话',
        copyMsg: '复制',
        regenerate: '重新生成',
        switchModel: '已切换到',
        selectModel: '选择模型',
        noKeyHint: '需配置Key',
        configured: '已配置',
        sysPrompt:
            '当前日期时间：{date} {time}。请基于此时间回答用户问题。\n\n【核心规则】\n1. 如果用户提供了文件内容，直接回答用户的具体问题，严禁复述、引用、转述文件原文\n2. 回答要简短精炼，只给出用户问的答案\n3. 如果用户问"第N行是什么"，直接回答那一行的内容，不要展示其他内容',
        // 引擎页
        enginesTitle: '本地引擎管理',
        enginesSub: '一键启动 / 停止本地推理引擎，自动检测已安装的服务',
        port: '端口',
        type: '类型',
        cmd: '命令',
        notConfigured: '(未配置)',
        start: '▶ 启动',
        stop: '⏹ 停止',
        detect: '🔍 检测',
        editConfig: '✏️ 配置',
        running: '运行中',
        stopped: '未运行',
        detecting: '检测中...',
        availableModels: '可用模型',
        // 引擎安装
        notInstalled: '未安装',
        installHint: '安装方式',
        downloadUrl: '下载地址',
        oneClickInstall: '🚀 一键安装',
        openDownloadPage: '🔗 打开下载页',
        doNotInstall: '❌ 不安装',
        installing: '正在安装',
        installSuccess: '安装成功',
        installFailed: '安装失败',
        openDownload: '已打开下载页面',
        manualInstall: '请手动下载安装',
        cmdNotFound: '命令 "{cmd}" 未找到，请先安装',
        engineStartFailed: '启动失败',
        engineNotRunning: '启动后检测未运行，命令可能有误',
        noApiKey: '请先配置 {name} 的 API Key',
        apiError: 'API 错误',
        connectFailed: '连接失败',
        requestTimeout: '请求超时',
        localModels: '本地模型 (Ollama)',
        noLocalModels: '暂无本地模型，请先拉取',
        ollamaWizard: 'Ollama 安装向导',
        pullModel: '拉取模型',
        pulling: '拉取中',
        pullSuccess: '拉取成功',
        pullFailed: '拉取失败',
        // 设置页
        appearance: '界面配色',
        language: '界面语言',
        providerMgmt: '供应商管理',
        chatParams: '对话参数',
        themeTitle: '🎨 界面配色',
        themeDark: '🌙 暗色',
        themeLight: '☀️ 亮色',
        themeSystem: '💻 跟随系统',
        langTitle: '🌐 界面语言',
        addProvider: '+ 添加新供应商',
        editProvider: '编辑',
        provName: '供应商名称',
        apiKey: 'API Key',
        apiKeyHint: '填入后自动检测',
        requestUrl: '请求地址',
        urlWarn: '⚠️ 填写兼容 OpenAI/Claude API 的端点地址',
        modelList: '模型列表',
        modelListHint: '(每行一个)',
        saved: '已保存',
        deleted: '已删除',
        // 参数页
        temperature: 'Temperature (创造性)',
        topP: 'Top P',
        maxTokens: 'Max Tokens',
        defaultProvider: '默认供应商',
        saveParams: '💾 保存参数',
        // 预设供应商
        presetHint: '预设供应商（点击自动填充）',
        custom: '✏️ 自定义',
        addProvTitle: '添加新供应商'
    },
    en: {
        name: 'English',
        save: 'Save',
        cancel: 'Cancel',
        confirm: 'OK',
        delete: 'Delete',
        close: 'Close',
        success: 'Done',
        error: 'Error',
        chat: 'Chat',
        engines: 'Engines',
        settings: 'Settings',
        chatPlaceholder: 'Type a message... (Enter to send, Shift+Enter for newline)',
        newChat: 'New Chat',
        noConvs: 'No conversations',
        welcome: 'Welcome!',
        tip1: '💡 Write a quick sort algorithm',
        tip2: '🎓 Explain quantum computing',
        tip3: '✨ Generate creative project names',
        exportChat: 'Export',
        clearChat: 'Clear',
        copyMsg: 'Copy',
        regenerate: 'Regenerate',
        switchModel: 'Switched to',
        selectModel: 'Select model',
        noKeyHint: 'Key required',
        configured: 'Configured',
        sysPrompt:
            'Current date/time: {date} {time}. Please answer based on this. If asked about current time, answer directly.',
        enginesTitle: 'Local Engine Manager',
        enginesSub: 'Start/stop local inference engines with one click',
        port: 'Port',
        type: 'Type',
        cmd: 'Command',
        notConfigured: '(not configured)',
        start: '▶ Start',
        stop: '⏹ Stop',
        detect: '🔍 Detect',
        editConfig: '✏️ Config',
        running: 'Running',
        stopped: 'Stopped',
        detecting: 'Detecting...',
        availableModels: 'Available models',
        notInstalled: 'Not installed',
        installHint: 'Install method',
        downloadUrl: 'Download URL',
        oneClickInstall: '🚀 Install Now',
        openDownloadPage: '🔗 Open download page',
        doNotInstall: '❌ Skip',
        installing: 'Installing',
        installSuccess: 'Installed',
        installFailed: 'Install failed',
        openDownload: 'Download page opened',
        manualInstall: 'Please install manually',
        cmdNotFound: 'Command "{cmd}" not found, please install first',
        engineStartFailed: 'Start failed',
        engineNotRunning: 'Engine not running after start, command may be wrong',
        noApiKey: 'Please configure {name} API Key first',
        apiError: 'API error',
        connectFailed: 'Connection failed',
        requestTimeout: 'Request timed out',
        appearance: 'Appearance',
        language: 'Language',
        providerMgmt: 'Providers',
        chatParams: 'Parameters',
        themeTitle: '🎨 Theme',
        themeDark: '🌙 Dark',
        themeLight: '☀️ Light',
        themeSystem: '💻 System',
        langTitle: '🌐 Language',
        addProvider: '+ Add Provider',
        editProvider: 'Edit',
        provName: 'Provider name',
        apiKey: 'API Key',
        apiKeyHint: 'Enter to auto-detect',
        requestUrl: 'Request URL',
        urlWarn: '⚠️ Enter an OpenAI/Claude-compatible endpoint',
        modelList: 'Models',
        modelListHint: '(one per line)',
        saved: 'Saved',
        deleted: 'Deleted',
        temperature: 'Temperature (creativity)',
        topP: 'Top P',
        maxTokens: 'Max Tokens',
        defaultProvider: 'Default provider',
        saveParams: '💾 Save',
        presetHint: 'Preset providers (click to auto-fill)',
        custom: '✏️ Custom',
        addProvTitle: 'Add Provider'
    },
    'zh-TW': {
        name: '繁體中文',
        save: '儲存',
        cancel: '取消',
        confirm: '確定',
        delete: '刪除',
        close: '關閉',
        success: '操作成功',
        error: '操作失敗',
        chat: '對話',
        engines: '引擎管理',
        settings: '設定',
        chatPlaceholder: '輸入訊息... (Enter 發送, Shift+Enter 換行)',
        newChat: '新對話',
        noConvs: '暫無對話',
        welcome: '歡迎回來！',
        tip1: '💡 寫一段快速排序',
        tip2: '🎓 解釋量子運算',
        tip3: '✨ 起幾個創意名字',
        exportChat: '匯出',
        clearChat: '清空',
        copyMsg: '複製',
        regenerate: '重新生成',
        switchModel: '已切換到',
        selectModel: '選擇模型',
        noKeyHint: '需配置Key',
        configured: '已配置',
        sysPrompt: '當前日期時間：{date} {time}。請基於此時間回答用戶問題。如果用戶詢問當前時間，請直接回答。',
        enginesTitle: '本地引擎管理',
        enginesSub: '一鍵啟動/停止本地推理引擎',
        port: '端口',
        type: '類型',
        cmd: '命令',
        notConfigured: '(未配置)',
        start: '▶ 啟動',
        stop: '⏹ 停止',
        detect: '🔍 偵測',
        editConfig: '✏️ 配置',
        running: '運行中',
        stopped: '未運行',
        detecting: '偵測中...',
        availableModels: '可用模型',
        notInstalled: '未安裝',
        installHint: '安裝方式',
        downloadUrl: '下載地址',
        oneClickInstall: '🚀 一鍵安裝',
        openDownloadPage: '🔗 開啟下載頁',
        doNotInstall: '❌ 不安裝',
        installing: '正在安裝',
        installSuccess: '安裝成功',
        installFailed: '安裝失敗',
        openDownload: '已開啟下載頁面',
        manualInstall: '請手動下載安裝',
        appearance: '介面配色',
        language: '介面語言',
        providerMgmt: '供應商管理',
        chatParams: '對話參數',
        themeTitle: '🎨 介面配色',
        themeDark: '🌙 暗色',
        themeLight: '☀️ 亮色',
        themeSystem: '💻 跟隨系統',
        langTitle: '🌐 介面語言',
        addProvider: '+ 新增供應商',
        editProvider: '編輯',
        provName: '供應商名稱',
        apiKey: 'API Key',
        apiKeyHint: '填入後自動偵測',
        requestUrl: '請求地址',
        urlWarn: '⚠️ 填寫相容 OpenAI/Claude API 的端點地址',
        modelList: '模型列表',
        modelListHint: '(每行一個)',
        saved: '已儲存',
        deleted: '已刪除',
        temperature: 'Temperature (創造性)',
        topP: 'Top P',
        maxTokens: 'Max Tokens',
        defaultProvider: '預設供應商',
        saveParams: '💾 儲存參數',
        presetHint: '預設供應商（點擊自動填入）',
        custom: '✏️ 自訂',
        addProvTitle: '新增供應商'
    },
    ja: {
        name: '日本語',
        save: '保存',
        cancel: 'キャンセル',
        confirm: 'OK',
        delete: '削除',
        close: '閉じる',
        success: '完了',
        error: 'エラー',
        chat: 'チャット',
        engines: 'エンジン',
        settings: '設定',
        chatPlaceholder: 'メッセージを入力... (Enter 送信, Shift+Enter 改行)',
        newChat: '新しいチャット',
        noConvs: '会話なし',
        welcome: 'ようこそ！',
        tip1: '💡 ソートアルゴリズムを書く',
        tip2: '🎓 量子コンピューティングを解説',
        tip3: '✨ プロジェクト名を考案',
        exportChat: 'エクスポート',
        clearChat: 'クリア',
        copyMsg: 'コピー',
        regenerate: '再生成',
        switchModel: '切り替え完了',
        selectModel: 'モデルを選択',
        noKeyHint: 'キー必要',
        configured: '設定済み',
        sysPrompt:
            '現在の日時: {date} {time}。この情報を基に回答してください。現在の時刻を聞かれたらそのまま答えてください。',
        enginesTitle: 'ローカルエンジン管理',
        enginesSub: 'ワンクリックで起動/停止',
        port: 'ポート',
        type: 'タイプ',
        cmd: 'コマンド',
        notConfigured: '(未設定)',
        start: '▶ 起動',
        stop: '⏹ 停止',
        detect: '🔍 検出',
        editConfig: '✏️ 設定',
        running: '実行中',
        stopped: '停止中',
        detecting: '検出中...',
        availableModels: '利用可能なモデル',
        notInstalled: '未インストール',
        installHint: 'インストール方法',
        downloadUrl: 'ダウンロードURL',
        oneClickInstall: '🚀 インストール',
        openDownloadPage: '🔗 ダウンロードページ',
        doNotInstall: '❌ スキップ',
        installing: 'インストール中',
        installSuccess: 'インストール完了',
        installFailed: 'インストール失敗',
        openDownload: 'ダウンロードページを開きました',
        manualInstall: '手動でインストールしてください',
        cmdNotFound: 'コマンド "{cmd}" が見つかりません。先にインストールしてください',
        engineStartFailed: '起動失敗',
        engineNotRunning: '起動後に稼働していません。コマンドが正しいか確認してください',
        noApiKey: '{name} の API Key を先に設定してください',
        apiError: 'API エラー',
        connectFailed: '接続失敗',
        requestTimeout: 'タイムアウト',
        appearance: '外観',
        language: '言語',
        providerMgmt: 'プロバイダー',
        chatParams: 'パラメータ',
        themeTitle: '🎨 テーマ',
        themeDark: '🌙 ダーク',
        themeLight: '☀️ ライト',
        themeSystem: '💻 システム',
        langTitle: '🌐 言語',
        addProvider: '+ 追加',
        editProvider: '編集',
        provName: 'プロバイダー名',
        apiKey: 'API Key',
        apiKeyHint: '入力で自動検出',
        requestUrl: 'リクエストURL',
        urlWarn: '⚠️ OpenAI/Claude互換エンドポイントを入力',
        modelList: 'モデル',
        modelListHint: '(1行1モデル)',
        saved: '保存済み',
        deleted: '削除済み',
        temperature: 'Temperature (創造性)',
        topP: 'Top P',
        maxTokens: 'Max Tokens',
        defaultProvider: 'デフォルトプロバイダー',
        saveParams: '💾 保存',
        presetHint: 'プリセット（クリックで自動入力）',
        custom: '✏️ カスタム',
        addProvTitle: 'プロバイダー追加'
    }
};

let currentLang = 'zh-CN';

function setLanguage(lang) {
    currentLang = lang;
    config.language = lang;
    api.setConfig('language', lang);
    applyLanguage(lang);
    document.querySelectorAll('.lang-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.lang === lang);
    });
    toast(`语言已切换为: ${LANG_MAP[lang]?.name || lang}`, 'success');
}

function applyLanguage(lang) {
    currentLang = lang || 'zh-CN';
    const L = LANG_MAP[currentLang] || LANG_MAP['zh-CN'];

    // --- 输入框 ---
    const chatInput = document.getElementById('chatInput');
    if (chatInput) chatInput.placeholder = L.chatPlaceholder;

    // --- 导航栏 tooltip ---
    document.querySelectorAll('.nav-btn').forEach((btn) => {
        const tab = btn.dataset.tab;
        if (tab === 'chat') btn.title = L.chat;
        if (tab === 'engines') btn.title = L.engines;
        if (tab === 'settings') btn.title = L.settings;
    });

    // --- 聊天侧栏 ---
    const btnNewChat = document.getElementById('btnNewChat');
    if (btnNewChat)
        btnNewChat.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/></svg> ${L.newChat}`;

    // --- 模型选择器标签 ---
    const modelLabel = document.getElementById('modelLabel');
    if (modelLabel) modelLabel.textContent = L.selectModel;
    const modelInfoLabel = document.getElementById('modelInfoLabel');
    if (modelInfoLabel)
        modelInfoLabel.innerHTML = `${L.selectModel}: <strong id="currentModelLabel">${config.defaultModel || L.selectModel}</strong>`;
    updateModelLabel();

    // --- 设置导航标题 ---
    const settingsNavTitle = document.querySelector('.settings-nav-title');
    if (settingsNavTitle) settingsNavTitle.textContent = L.settings;

    // --- 设置子菜单 ---
    const menuKeys = {
        appearance: L.appearance,
        language: L.language,
        providers: L.providerMgmt,
        params: L.chatParams
    };
    document.querySelectorAll('.snav-item').forEach((el) => {
        const key = el.dataset.settings;
        const labelEl = el.querySelector('span');
        if (labelEl && menuKeys[key]) labelEl.textContent = menuKeys[key];
    });

    // --- 设置面板标题 ---
    const appTitle = document.getElementById('sp-title-appearance');
    if (appTitle) appTitle.textContent = L.themeTitle;
    const langTitle = document.getElementById('sp-title-language');
    if (langTitle) langTitle.textContent = L.langTitle;
    const paramsTitle = document.getElementById('sp-title-params');
    if (paramsTitle) paramsTitle.textContent = `🎛️ ${L.chatParams}`;

    // --- 主题卡片 ---
    const themeLabels = document.querySelectorAll('.theme-label');
    const themeKeys = [L.themeDark, L.themeLight, L.themeSystem];
    themeLabels.forEach((el, i) => {
        if (themeKeys[i]) el.textContent = themeKeys[i];
    });

    // --- 供应商管理 ---
    const provHeader = document.querySelector('#sp-providers .pm-header h2');
    if (provHeader) provHeader.textContent = L.providerMgmt;
    const addProvBtn = document.querySelector('#sp-providers .pm-header .btn-primary');
    if (addProvBtn) addProvBtn.textContent = L.addProvider;

    // --- 对话参数 ---
    const paramLabels = document.querySelectorAll('#sp-params .param-item label');
    const paramKeys = [L.temperature, L.topP, L.maxTokens, L.defaultProvider];
    paramLabels.forEach((el, i) => {
        if (paramKeys[i]) el.textContent = paramKeys[i];
    });
    const saveParamsBtn = document.querySelector('#sp-params .btn-primary');
    if (saveParamsBtn) saveParamsBtn.textContent = L.saveParams;

    // --- 引擎页面 ---
    const engTitle = document.querySelector('#tab-engines .page-header h1');
    if (engTitle) engTitle.textContent = `🔧 ${L.enginesTitle}`;
    const engSub = document.querySelector('#tab-engines .page-header .subtitle');
    if (engSub) engSub.textContent = L.enginesSub;

    // --- 引擎卡片（动态渲染的，需要重新渲染）---
    renderEngines();
    renderConvList();
    renderMessages();
    renderProviderList();
}

function L(key) {
    return LANG_MAP[currentLang]?.[key] || LANG_MAP['zh-CN']?.[key] || key;
}
let editingProviderId = null;

// 预设供应商数据库
const PRESETS = {
    'claude-official': {
        name: 'Claude Official',
        baseUrl: 'https://api.anthropic.com',
        models: [
            'claude-opus-4-20250514',
            'claude-sonnet-4-20250514',
            'claude-3-7-sonnet-20250219',
            'claude-3-5-haiku-20241022'
        ],
        icon: '🅰️',
        apiType: 'anthropic'
    },
    deepseek: {
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
        icon: '🐋',
        apiType: 'openai'
    },
    openai: {
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-5', 'gpt-5-mini', 'o3', 'o3-pro', 'o4-mini', 'gpt-4.1', 'gpt-4o'],
        icon: '🟢',
        apiType: 'openai'
    },
    gemini: {
        name: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
        icon: '💎',
        apiType: 'gemini'
    },
    tongyi: {
        name: '通义千问',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        models: ['qwen3-235b-a22b', 'qwen-max', 'qwen-plus'],
        icon: '🧠',
        apiType: 'openai'
    },
    zhipu: {
        name: '智谱 GLM',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        models: ['glm-4-plus', 'glm-4-flash'],
        icon: '🔵',
        apiType: 'openai'
    },
    moonshot: {
        name: 'Moonshot (Kimi)',
        baseUrl: 'https://api.moonshot.cn/v1',
        models: ['moonshot-v1-128k', 'moonshot-v1-32k'],
        icon: '🌙',
        apiType: 'openai'
    },
    doubao: {
        name: '豆包 (ByteDance)',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        models: ['doubao-1.5-pro-256k', 'doubao-1.5-lite-32k'],
        icon: '🫘',
        apiType: 'openai'
    },
    siliconflow: {
        name: 'SiliconFlow (免费)',
        baseUrl: 'https://api.siliconflow.cn/v1',
        models: [
            'Qwen/Qwen2.5-7B-Instruct',
            'THUDM/glm-4-9b-chat',
            'deepseek-ai/DeepSeek-V2-Chat',
            'meta-llama/Meta-Llama-3.1-8B-Instruct',
            'internlm/internlm2_5-7b-chat'
        ],
        icon: '⚡',
        apiType: 'openai',
        free: true
    },
    openrouter: {
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        models: ['anthropic/claude-sonnet-4', 'openai/gpt-4o', 'google/gemini-2.5-pro'],
        icon: '🔀',
        apiType: 'openai'
    }
};

function renderSettings() {
    renderProviderList();
    document.getElementById('cfgTemperature').value = config.chatDefaults?.temperature ?? 0.7;
    document.getElementById('cfgTemperatureVal').textContent = config.chatDefaults?.temperature ?? 0.7;
    document.getElementById('cfgTopP').value = config.chatDefaults?.top_p ?? 1.0;
    document.getElementById('cfgTopPVal').textContent = config.chatDefaults?.top_p ?? 1.0;
    document.getElementById('cfgMaxTokens').value = config.chatDefaults?.max_tokens ?? 8192;
    const sel = document.getElementById('cfgDefaultProvider');
    sel.innerHTML = Object.entries(config.providers)
        .map(
            ([id, prov]) =>
                `<option value="${id}" ${id === config.defaultProvider ? 'selected' : ''}>${escapeHtml(prov.name)}</option>`
        )
        .join('');
}

function renderProviderList() {
    const list = document.getElementById('providerList');
    if (!list) return;
    list.innerHTML = Object.entries(config.providers)
        .map(([id, prov]) => {
            const hasKey = !!prov.apiKey;
            const firstLetter = (prov.name || id).charAt(0).toUpperCase();
            return `
      <div class="pl-item ${editingProviderId === id ? 'active' : ''}" onclick="openEditor('${id}')">
        <div class="pl-icon">${firstLetter}</div>
        <div class="pl-info">
          <div class="pl-name">${escapeHtml(prov.name)}</div>
          <div class="pl-url">${escapeHtml(prov.baseUrl || '未设置')}</div>
        </div>
        <div class="pl-status">
          <span class="pl-badge ${hasKey ? 'ok' : 'nokey'}">${hasKey ? '已配置' : '未配置'}</span>
          <div class="pl-balance">${(prov.models || []).length} 个模型</div>
        </div>
      </div>`;
        })
        .join('');
}

function openEditor(id) {
    editingProviderId = id;
    const prov = config.providers[id];
    const isBuiltIn = [
        'openai',
        'anthropic',
        'gemini',
        'deepseek',
        'tongyi',
        'zhipu',
        'moonshot',
        'doubao',
        'siliconflow',
        'custom'
    ].includes(id);

    document.getElementById('providerEditor').style.display = 'block';
    document.getElementById('editorTitle').textContent = `编辑 - ${prov.name}`;
    document.getElementById('editorBody').innerHTML = `
    <div class="form-row"><label>供应商名称</label><input type="text" class="input-text" id="ed-name" value="${escapeHtml(prov.name)}"></div>
    <div class="form-row"><label>API Key <span class="hint">填入后自动检测</span></label><input type="password" class="input-text" id="ed-apikey" value="${prov.apiKey || ''}" placeholder="sk-..."></div>
    <div class="form-row"><label>请求地址</label><input type="text" class="input-text" id="ed-baseurl" value="${escapeHtml(prov.baseUrl || '')}" placeholder="https://api.example.com/v1"><div class="pe-warn">⚠️ 填写兼容 OpenAI/Claude API 的端点地址</div></div>
    <div class="form-row"><label>模型列表 <span class="hint">(每行一个)</span></label><textarea class="input-text" id="ed-models" rows="6">${(prov.models || []).join('\n')}</textarea></div>
    <div class="pe-actions">
      <button class="btn-primary" onclick="saveEditor('${id}')">💾 保存</button>
      ${!isBuiltIn || id === 'custom' ? `<button class="btn-danger-sm" onclick="deleteProvider('${id}')">🗑️ 删除</button>` : ''}
    </div>`;
    renderProviderList();
}

function closeEditor() {
    editingProviderId = null;
    document.getElementById('providerEditor').style.display = 'none';
    renderProviderList();
}

async function saveEditor(id) {
    const name = document.getElementById('ed-name').value.trim();
    const apiKey = document.getElementById('ed-apikey').value.trim();
    const baseUrl = document.getElementById('ed-baseurl').value.trim();
    const models = document
        .getElementById('ed-models')
        .value.split('\n')
        .map((m) => m.trim())
        .filter(Boolean);
    if (!name) {
        toast('名称不能为空', 'error');
        return;
    }
    config.providers[id] = { ...config.providers[id], name, apiKey, baseUrl, models };
    await api.setProvider(id, { name, apiKey, baseUrl, models });
    populateModelSelect();
    renderProviderList();
    toast(`${name} 已保存`, 'success');
}

async function deleteProvider(id) {
    if (!(await confirmDialog(`确定删除 "${config.providers[id]?.name}"？`))) return;
    delete config.providers[id];
    await api.setConfig('providers', config.providers);
    closeEditor();
    populateModelSelect();
    toast('已删除', 'success');
}

function showAddProvider() {
    const tags = Object.entries(PRESETS)
        .map(([k, p]) => `<button class="preset-tag" onclick="addFromPreset('${k}')">${p.icon} ${p.name}</button>`)
        .join('');
    document.getElementById('providerEditor').style.display = 'block';
    document.getElementById('editorTitle').textContent = '添加新供应商';
    document.getElementById('editorBody').innerHTML = `
    <div style="margin-bottom:16px"><label style="font-size:13px;color:var(--text-2);display:block;margin-bottom:8px;">预设供应商 <span class="hint">（点击自动填充）</span></label>
    <div class="preset-grid">${tags}<button class="preset-tag" onclick="addFromPreset('custom')">✏️ 自定义</button></div></div><div id="addPresetForm"></div>`;
    renderProviderList();
}

async function addFromPreset(key) {
    const preset = PRESETS[key];
    const id = key === 'custom' ? 'custom_' + Date.now().toString(36) : key;
    if (config.providers[id]) {
        openEditor(id);
        return;
    }
    config.providers[id] = {
        name: preset.name,
        enabled: true,
        apiKey: '',
        baseUrl: preset.baseUrl,
        models: [...preset.models]
    };
    await api.setProvider(id, config.providers[id]);
    openEditor(id);
    populateModelSelect();
    toast(`已添加 "${preset.name}"，请填写 API Key`, 'success');
}

function initSettingsListeners() {
    ['cfgTemperature', 'cfgTopP'].forEach((id) => {
        document.getElementById(id)?.addEventListener('input', (e) => {
            document.getElementById(id + 'Val').textContent = e.target.value;
        });
    });
}

// ============ Markdown 简易渲染 ============
function renderMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);

    // 代码块
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        return `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`;
    });

    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 粗体 & 斜体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // 标题
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // 引用
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // 链接
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // 换行
    html = html.replace(/\n/g, '<br>');

    return html;
}

// ============ 工具 ============
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toast(msg, type = 'info') {
    const box = document.getElementById('toastBox');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

// ============ 模态弹窗 (替代 prompt/confirm) ============
function showModal({ title, fields, buttons }) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('modalOverlay');
        const titleEl = document.getElementById('modalTitle');
        const bodyEl = document.getElementById('modalBody');
        const footerEl = document.getElementById('modalFooter');

        titleEl.textContent = title || '提示';
        bodyEl.innerHTML = fields
            .map(
                (f) => `
      <div class="form-row">
        <label>${f.label}${f.hint ? `<span style="color:var(--text-3);font-weight:normal;margin-left:4px">${f.hint}</span>` : ''}</label>
        ${
            f.type === 'textarea'
                ? `<textarea class="input-text" id="mf-${f.id}" rows="3" placeholder="${f.placeholder || ''}">${f.value || ''}</textarea>`
                : `<input type="${f.type || 'text'}" class="input-text" id="mf-${f.id}" value="${escapeHtml(f.value || '')}" placeholder="${f.placeholder || ''}">`
        }
      </div>
    `
            )
            .join('');

        footerEl.innerHTML = (
            buttons || [
                { label: '取消', style: 'btn-sm', action: false },
                { label: '确定', style: 'btn-primary', action: true }
            ]
        )
            .map((b, i) => `<button class="${b.style}" id="mbtn-${i}">${b.label}</button>`)
            .join('');

        overlay.style.display = 'flex';

        // 绑定按钮
        const close = (result) => {
            overlay.style.display = 'none';
            resolve(result);
        };

        (
            buttons || [
                { label: '取消', action: false },
                { label: '确定', action: true }
            ]
        ).forEach((b, i) => {
            document.getElementById(`mbtn-${i}`).addEventListener('click', () => {
                if (b.action === true || b.action === 'install' || b.action === 'link') {
                    const values = {};
                    fields.forEach((f) => {
                        const el = document.getElementById(`mf-${f.id}`);
                        values[f.id] = el ? el.value : '';
                    });
                    values._action = b.action;
                    close(values);
                } else {
                    close(null);
                }
            });
        });

        // ESC 关闭
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                close(null);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    });
}

function closeModal() {
    document.getElementById('modalOverlay').style.display = 'none';
}

async function confirmDialog(msg) {
    const result = await showModal({
        title: '确认',
        fields: [{ id: 'msg', type: 'textarea', value: msg }],
        buttons: [
            { label: '取消', style: 'btn-sm', action: false },
            { label: '确定', style: 'btn-danger-sm', action: true }
        ]
    });
    return result !== null;
}
