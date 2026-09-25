// 「用手机访问」窗口和主进程之间的桥。只有这个本地窗口有，
// 主窗口（Next 页面，手机上也能打开的那个）拿不到这些接口 ——
// 否则一台配对过的手机就能自己打开开关、发新二维码、踢掉别的设备。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lan', {
  state: () => ipcRenderer.invoke('lan:state'),
  setEnabled: (on) => ipcRenderer.invoke('lan:set-enabled', on),
  setAddress: (a) => ipcRenderer.invoke('lan:set-address', a),
  newCode: () => ipcRenderer.invoke('lan:new-code'),
  removeDevice: (id) => ipcRenderer.invoke('lan:remove-device', id),
  onChange: (fn) => ipcRenderer.on('lan:changed', () => fn()),
});
