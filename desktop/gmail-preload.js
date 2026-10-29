const { contextBridge, ipcRenderer } = require('electron');
// No filesystem, arbitrary IPC or process access is exposed to web content.
contextBridge.exposeInMainWorld('desktopGmail', {
  invoke: (action, input = {}) => ipcRenderer.invoke('gmail:command', action, input),
});

contextBridge.exposeInMainWorld('desktopApp', {
  openPhoneAccess: () => ipcRenderer.invoke('desktop:open-phone-access'),
});
