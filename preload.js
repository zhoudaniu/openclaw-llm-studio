const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 窗口
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),

  // 配置
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (key, val) => ipcRenderer.invoke('config:set', key, val),
  getProvider: (id) => ipcRenderer.invoke('config:getProvider', id),
  setProvider: (id, data) => ipcRenderer.invoke('config:setProvider', id, data),

  // 对话
  listConversations: () => ipcRenderer.invoke('conversations:list'),
  saveConversations: (convos) => ipcRenderer.invoke('conversations:save', convos),

  // 聊天 API
  chatSend: (data) => ipcRenderer.invoke('chat:send', data),
  chatStream: (data) => ipcRenderer.invoke('chat:stream', data),
  onStreamChunk: (cb) => ipcRenderer.on('chat:stream-chunk', (_, chunk) => cb(chunk)),
  onStreamDone: (cb) => ipcRenderer.on('chat:stream-done', () => cb()),
  offStreamChunk: () => ipcRenderer.removeAllListeners('chat:stream-chunk'),
  offStreamDone: () => ipcRenderer.removeAllListeners('chat:stream-done'),

  // 引擎
  listEngines: () => ipcRenderer.invoke('engines:list'),
  updateEngine: (id, data) => ipcRenderer.invoke('engines:update', id, data),
  checkEngine: (id) => ipcRenderer.invoke('engines:check', id),
  startEngine: (id) => ipcRenderer.invoke('engines:start', id),
  stopEngine: (id) => ipcRenderer.invoke('engines:stop', id),
  getEngineStatus: () => ipcRenderer.invoke('engines:status'),
  detectEngine: (id) => ipcRenderer.invoke('engines:detect', id),
  installEngine: (id) => ipcRenderer.invoke('engines:install', id),

  // Ollama 专用
  ollamaStatus: () => ipcRenderer.invoke('ollama:status'),
  ollamaPull: (model) => ipcRenderer.invoke('ollama:pull', model),
  ollamaAvailable: () => ipcRenderer.invoke('ollama:available'),
  ollamaDownload: () => ipcRenderer.invoke('ollama:download'),
  ollamaStart: () => ipcRenderer.invoke('ollama:start'),
  ollamaStop: () => ipcRenderer.invoke('ollama:stop'),
  onEngineLog: (cb) => ipcRenderer.on('engine:log', (_, data) => cb(data)),
  onEngineExit: (cb) => ipcRenderer.on('engine:exit', (_, data) => cb(data)),

  // 工具
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  exportChat: (conv) => ipcRenderer.invoke('chat:export', conv),
});
