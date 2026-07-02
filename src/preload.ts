import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  navigate: (url: string) => ipcRenderer.send('navigate', url),
  goBack: () => ipcRenderer.send('go-back'),
  goForward: () => ipcRenderer.send('go-forward'),
  reload: () => ipcRenderer.send('reload'),
  newTab: (url: string) => ipcRenderer.send('new-tab', url),
  closeTab: (tabId: number) => ipcRenderer.send('close-tab', tabId),
  switchTab: (tabId: number) => ipcRenderer.send('switch-tab', tabId),
  toggleAdBlock: () => ipcRenderer.send('toggle-adblock'),
  
  onUpdateUrl: (callback: (url: string) => void) => {
    ipcRenderer.on('update-url', (event, url) => callback(url));
  },
  onUpdateTitle: (callback: (title: string) => void) => {
    ipcRenderer.on('update-title', (event, title) => callback(title));
  },
  onUpdateTabs: (callback: (tabs: any[]) => void) => {
    ipcRenderer.on('update-tabs', (event, tabs) => callback(tabs));
  },
  onShowNotification: (callback: (message: string) => void) => {
    ipcRenderer.on('show-notification', (event, message) => callback(message));
  },
  onUpdateAdBlockStatus: (callback: (enabled: boolean) => void) => {
    ipcRenderer.on('update-adblock-status', (event, enabled) => callback(enabled));
  },
});
