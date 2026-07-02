import { ipcRenderer } from 'electron';

// WebView用のpreload - リンククリックとホバーを処理

// リンクプレビュー要素を作成
let linkPreviewElement: HTMLDivElement | null = null;

function createLinkPreview() {
  if (linkPreviewElement) return linkPreviewElement;
  
  linkPreviewElement = document.createElement('div');
  linkPreviewElement.style.cssText = `
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(49, 50, 68, 0.95);
    color: #cdd6f4;
    padding: 4px 12px;
    font-size: 11px;
    font-family: 'Consolas', 'Courier New', monospace;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
    z-index: 999999;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-top: 1px solid rgba(69, 71, 90, 0.8);
  `;
  
  document.body.appendChild(linkPreviewElement);
  return linkPreviewElement;
}

// リンクホバー時にURLを表示（即座に設定、passive）
document.addEventListener('mouseover', (e: MouseEvent) => {
  const target = (e.target as HTMLElement).closest('a') as HTMLAnchorElement;
  if (target && target.href) {
    console.log('🔗 Link hover:', target.href);
    const preview = createLinkPreview();
    preview.textContent = target.href;
    preview.style.opacity = '1';
    ipcRenderer.send('show-link-preview', target.href);
  }
}, { passive: true, capture: true });

document.addEventListener('mouseout', (e: MouseEvent) => {
  const target = (e.target as HTMLElement).closest('a') as HTMLAnchorElement;
  if (target && target.href) {
    if (linkPreviewElement) {
      linkPreviewElement.style.opacity = '0';
    }
    ipcRenderer.send('show-link-preview', null);
  }
}, { passive: true, capture: true });

// Ctrl+クリックと中クリックを処理
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
