import { ipcRenderer } from 'electron';

// WebView用のpreload - リンククリックを処理
document.addEventListener('DOMContentLoaded', () => {
  // Ctrl+クリックと中クリックを処理
  document.addEventListener('click', (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest('a') as HTMLAnchorElement;
    if (!target || !target.href) return;

    // Ctrl+クリックまたは中クリック
    if (e.ctrlKey || e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      
      console.log('Opening in new tab:', target.href);
      ipcRenderer.send('open-link-in-new-tab', target.href);
    }
  }, true);

  // 中クリック（auxclick）も処理
  document.addEventListener('auxclick', (e: MouseEvent) => {
    if (e.button === 1) { // 中クリック
      const target = (e.target as HTMLElement).closest('a') as HTMLAnchorElement;
      if (target && target.href) {
        e.preventDefault();
        e.stopPropagation();
        
        console.log('Opening in new tab (auxclick):', target.href);
        ipcRenderer.send('open-link-in-new-tab', target.href);
      }
    }
  }, true);
});
