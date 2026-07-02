import { app, BrowserWindow, BrowserView, ipcMain, session, Menu } from 'electron';
import * as path from 'path';
import { URL } from 'url';
import * as fs from 'fs';

interface Tab {
  id: number;
  view: BrowserView;
  url: string;
  title: string;
  cleanup?: () => void;
}

class NeonBrowser {
  private mainWindow: BrowserWindow | null = null;
  private tabs: Tab[] = [];
  private activeTabId: number = 0;
  private nextTabId: number = 1;
  private isPrivateMode: boolean = false;
  private adBlockNetworks: string[] = [];
  private adBlockWhitelist: string[] = [];
  private isAdBlockEnabled: boolean = true;

  constructor() {
    app.whenReady().then(() => {
      this.loadAdBlockRules();
      this.createWindow();
      this.setupSession();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createWindow();
      }
    });
  }

  private setupSession() {
    const ses = session.defaultSession;

    // ポップアップをブロック
    ses.setPermissionRequestHandler((webContents, permission, callback) => {
      if (permission === 'openExternal') {
        callback(false);
      } else {
        callback(true);
      }
    });

    // 広告リクエストをネットワークレベルでブロック（外部ファイルから読み込み）
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const url = details.url.toLowerCase();
      
      // 外部ファイルから読み込んだパターンでブロック
      const shouldBlock = this.adBlockNetworks.some(pattern => url.includes(pattern));
      
      if (shouldBlock) {
        console.log('🚫 Blocked ad request:', url);
        callback({ cancel: true });
      } else {
        callback({ cancel: false });
      }
    });

    // シークレットモードの設定
    if (this.isPrivateMode) {
      ses.clearStorageData();
    }
  }

  private loadAdBlockRules() {
    try {
      // ルートディレクトリのパスを取得（開発時とパッケージ化後の両方に対応）
      const appPath = app.getAppPath();
      
      // adblock-networks.txt を読み込み
      const networksPath = path.join(appPath, 'adblock-networks.txt');
      if (fs.existsSync(networksPath)) {
        const content = fs.readFileSync(networksPath, 'utf-8');
        this.adBlockNetworks = content
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
        console.log(`✅ Loaded ${this.adBlockNetworks.length} ad network patterns`);
      } else {
        console.warn('⚠️ adblock-networks.txt not found, ad blocking disabled');
      }

      // adblock-whitelist.txt を読み込み
      const whitelistPath = path.join(appPath, 'adblock-whitelist.txt');
      if (fs.existsSync(whitelistPath)) {
        const content = fs.readFileSync(whitelistPath, 'utf-8');
        this.adBlockWhitelist = content
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
        
        if (this.adBlockWhitelist.length === 0) {
          console.log('✅ DOM ad blocking enabled for ALL domains (empty whitelist)');
        } else {
          console.log(`✅ ${this.adBlockWhitelist.length} domains whitelisted (ad blocking disabled)`);
        }
      } else {
        console.log('✅ DOM ad blocking enabled for ALL domains (no whitelist)');
      }
    } catch (error) {
      console.error('❌ Error loading ad block rules:', error);
    }
  }

  private shouldInjectAdBlockingScripts(url: string): boolean {
    try {
      // ファイルが存在しないか空の場合は全サイトで有効
      if (this.adBlockWhitelist.length === 0) {
        return true;
      }

      // ホワイトリストに記載されている場合は広告除去を無効化
      const hostname = new URL(url).hostname;
      return !this.adBlockWhitelist.some(domain => hostname.includes(domain));
    } catch {
      return false;
    }
  }

  private createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      icon: path.join(__dirname, '../build/icon.ico'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
      autoHideMenuBar: true, // ALTキーで表示
    });

    this.mainWindow.loadFile(path.join(__dirname, '../index.html'));
    
    // UI準備完了後に初期状態を送信
    this.mainWindow.webContents.on('did-finish-load', () => {
      // アクティブタブがあればそのURLで広告ブロック状態を更新
      const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
      if (activeTab && activeTab.url) {
        this.updateAdBlockStatusForUrl(activeTab.url);
      } else {
        // アクティブタブがない場合はデフォルトで有効状態を送信
        this.sendToRenderer('update-adblock-status', { enabled: true, reason: 'active' });
      }
      this.sendToRenderer('update-private-mode', this.isPrivateMode);
    });
    
    // F12キーをキャプチャしてWebView DevToolsを開く
    this.mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        event.preventDefault();
        console.log('F12 pressed via before-input-event!');
        this.openDevTools();
      }
    });
    
    // メニューバーを非表示（キーボードショートカットのみ残す）
    this.createMenu();

    this.setupIpcHandlers();
    this.createTab('https://www.google.com');
  }

  private createMenu() {
    // メニューバーを完全に非表示にする
    Menu.setApplicationMenu(null);
    
    // キーボードショートカットは別途登録
    const { globalShortcut } = require('electron');
    
    // F12は before-input-event で処理するのでここでは登録しない
    
    // Ctrl+Shift+I: UI開発者ツール
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      if (this.mainWindow) {
        this.mainWindow.webContents.openDevTools({ mode: 'detach' });
        // 開いたDevToolsのコンソールにメッセージを表示
        setTimeout(() => {
          this.mainWindow?.webContents.executeJavaScript(
            'console.log("%c🛠️ UI DevTools (Ctrl+Shift+I) - ブラウザUI用", "color: #ff6600; font-size: 14px; font-weight: bold;");'
          ).catch(() => {});
        }, 500);
      }
    });
    
    // F5: リロード
    globalShortcut.register('F5', () => {
      this.reload();
    });
    
    // Ctrl+T: 新しいタブ
    globalShortcut.register('CommandOrControl+T', () => {
      this.createTab('https://www.google.com');
    });
    
    // Ctrl+W: タブを閉じる
    globalShortcut.register('CommandOrControl+W', () => {
      if (this.activeTabId) {
        this.closeTab(this.activeTabId);
      }
    });
  }

  private openDevTools() {
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (activeTab && !activeTab.view.webContents.isDestroyed()) {
      activeTab.view.webContents.openDevTools({ mode: 'detach' });
      // 開いたDevToolsのコンソールにメッセージを表示
      setTimeout(() => {
        activeTab.view.webContents.executeJavaScript(
          'console.log("%c🌐 WebView DevTools (F12) - ブラウザコンテンツ用", "color: #00ff00; font-size: 14px; font-weight: bold;");'
        ).catch(() => {});
      }, 500);
    }
  }

  private setupIpcHandlers() {
    ipcMain.on('navigate', (event, url: string) => {
      this.navigate(url);
    });

    ipcMain.on('go-back', () => {
      this.goBack();
    });

    ipcMain.on('go-forward', () => {
      this.goForward();
    });

    ipcMain.on('reload', () => {
      this.reload();
    });

    ipcMain.on('new-tab', (event, url: string) => {
      this.createTab(url);
    });

    ipcMain.on('close-tab', (event, tabId: number) => {
      this.closeTab(tabId);
    });

    ipcMain.on('switch-tab', (event, tabId: number) => {
      this.switchTab(tabId);
    });

    ipcMain.on('toggle-private-mode', () => {
      this.togglePrivateMode();
    });

    ipcMain.on('toggle-adblock', () => {
      this.toggleAdBlock();
    });

    ipcMain.on('open-link-in-new-tab', (event, url: string) => {
      // 同一ドメインチェック
      const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
      if (activeTab && !activeTab.view.webContents.isDestroyed()) {
        const currentDomain = this.getDomain(activeTab.url);
        const newDomain = this.getDomain(url);
        
        if (currentDomain === newDomain || currentDomain.includes('google')) {
          this.createTab(url);
        } else {
          this.showNotification(`異なるドメインへのタブは開けません: ${newDomain}`);
        }
      }
    });
  }

  private createTab(url: string) {
    if (!this.mainWindow) return;

    // タブ数を制限
    if (this.tabs.length >= 10) {
      this.showNotification('タブの上限に達しました（最大10タブ）');
      return;
    }

    const view = new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, 'webview-preload.js'),
        contextIsolation: false, // WebViewではfalseにしてIPCを使えるようにする
        nodeIntegration: false,
        javascript: true,
        webSecurity: true,
      },
    });

    const tabId = this.nextTabId++;
    const tab: Tab = {
      id: tabId,
      view: view,
      url: url,
      title: 'New Tab',
    };

    const updateBounds = () => {
      if (!this.mainWindow || view.webContents.isDestroyed()) return;
      try {
        const bounds = this.mainWindow.getContentBounds();
        view.setBounds({
          x: 0,
          y: 80,
          width: bounds.width,
          height: bounds.height - 80,
        });
      } catch (error) {
        console.error('Error updating bounds:', error);
      }
    };

    // ウィンドウリサイズ時の処理
    const resizeHandler = () => updateBounds();
    
    // クリーンアップ関数を保存
    tab.cleanup = () => {
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.removeListener('resize', resizeHandler);
        }
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    };

    this.tabs.push(tab);
    this.mainWindow.addBrowserView(view);
    updateBounds();
    this.mainWindow.on('resize', resizeHandler);

    // F12キーをキャプチャしてDevToolsを開く（このBrowserView用）
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        event.preventDefault();
        console.log('F12 pressed on BrowserView!');
        this.openDevTools();
      }
    });

    // ナビゲーション制限を追加
    view.webContents.on('will-navigate', (event, navigationUrl) => {
      try {
        this.handleNavigation(event, navigationUrl, view.webContents.getURL());
      } catch (error) {
        console.error('Navigation error:', error);
      }
    });

    // DOM準備完了時点でCSSとスクリプトを即座に注入（最速）
    view.webContents.on('dom-ready', () => {
      try {
        if (view.webContents.isDestroyed()) return;
        
        const currentUrl = view.webContents.getURL();
        
        // ドメインリストに基づいてDOM除去を実行
        if (this.shouldInjectAdBlockingScripts(currentUrl)) {
          // CSS注入: DOM構築前に広告要素を非表示
          this.injectAdBlockingCSS(view.webContents);
          
          // スクリプト注入: DOM監視を即座に開始
          this.injectBlockingScripts(view.webContents);
          console.log('✅ Ad blocking scripts injected for:', currentUrl);
        } else {
          console.log('⏭️ Skipping ad blocking for:', currentUrl);
        }
      } catch (error) {
        console.error('DOM ready error:', error);
      }
    });

    // ナビゲーションの設定（簡素化）
    const handleDidFinishLoad = () => {
      try {
        if (view.webContents.isDestroyed()) return;
        const currentUrl = view.webContents.getURL();
        const title = view.webContents.getTitle();
        tab.url = currentUrl;
        tab.title = title;
        
        if (tab.id === this.activeTabId) {
          this.sendToRenderer('update-url', currentUrl);
          this.sendToRenderer('update-title', title);
          // 現在のURLでの広告ブロック状態を更新
          this.updateAdBlockStatusForUrl(currentUrl);
        }
        this.sendToRenderer('update-tabs', this.getTabsInfo());
      } catch (error) {
        console.error('Load finish error:', error);
      }
    };

    view.webContents.on('did-finish-load', handleDidFinishLoad);

    view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      // -3 は中断なので無視
      if (errorCode === -3) return;
      
      console.error('Load failed:', errorCode, errorDescription, validatedURL);
      
      // 既にGoogle検索またはGoogleトップの場合は再試行しない
      if (validatedURL.includes('google.com')) return;
      
      if (!view.webContents.isDestroyed()) {
        // 失敗したURLをそのままGoogleで検索
        try {
          const urlObj = new URL(validatedURL);
          const searchQuery = urlObj.hostname + urlObj.pathname;
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
          view.webContents.loadURL(searchUrl).catch(console.error);
        } catch {
          // URL解析失敗時はGoogleトップへ
          view.webContents.loadURL('https://www.google.com').catch(console.error);
        }
      }
    });

    // 新しいウィンドウをブロック
    view.webContents.setWindowOpenHandler(() => {
      this.showNotification('ポップアップをブロックしました');
      return { action: 'deny' };
    });

    this.switchTab(tabId);
    this.loadUrl(view, url);
  }

  private handleNavigation(event: any, navigationUrl: string, currentUrl: string) {
    const currentDomain = this.getDomain(currentUrl);
    const newDomain = this.getDomain(navigationUrl);
    
    // Googleからの移動は許可
    if (currentDomain.includes('google')) {
      return;
    }
    
    // 同一ドメインでない場合はブロック
    if (currentDomain !== newDomain && currentDomain !== '') {
      event.preventDefault();
      console.log(`Blocked navigation from ${currentDomain} to ${newDomain}`);
      this.showNotification(`広告リダイレクトをブロックしました: ${newDomain}`);
    }
  }

  private getDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return '';
    }
  }

  private injectAdBlockingCSS(webContents: any) {
    if (!webContents || webContents.isDestroyed()) return;

    // CSSで広告を即座にブロック（より具体的なセレクター）
    webContents.insertCSS(`
      /* 広告関連の具体的なクラス・IDのみブロック */
      .ad-container,
      .ad-wrapper,
      .ad-slot,
      .ad-unit,
      .ads-container,
      .advertisement,
      .adsbygoogle,
      .gfpl-wrapper,
      #ad-container,
      #ads-container,
      #google_ads_iframe,
      [id^="google_ads_"],
      [id^="div-gpt-ad"],
      [class^="__"],
      [id^="__"],
      [data-ad-slot],
      [data-ad-unit],
      [data-google-query-id],
      [data-element="overlay"],
      [data-izone],
      [data-cfasync],
      div[id*="gfpl-"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      
      /* iframe広告をブロック */
      iframe[src*="doubleclick"],
      iframe[src*="googlesyndication"],
      iframe[src*="googleadservices"],
      iframe[src*="/pagead/"],
      iframe[src*="adnxs.com"],
      iframe[src*="advertising.com"],
      iframe[src*="adserver"],
      iframe[src*="stiffindividual"] {
        display: none !important;
      }
      
      /* スクロールロック解除 */
      body, html {
        overflow: auto !important;
      }
    `).catch((error: Error) => {
      console.error('Failed to inject CSS:', error);
    });
  }

  private injectBlockingScripts(webContents: any) {
    if (!webContents || webContents.isDestroyed()) return;

    webContents.executeJavaScript(`
      (function() {
        try {
          // 重複実行を防ぐ
          if (window.__neonBlockerInitialized) return;
          window.__neonBlockerInitialized = true;

          // 現在のドメインを保存
          const currentDomain = window.location.hostname;

          // 広告関連のキーワードパターン（より厳密に）
          const adPatterns = [
            /\bad-container\b/i,
            /\bad-wrapper\b/i,
            /\bad-slot\b/i,
            /\bad-unit\b/i,
            /\bads-container\b/i,
            /\badvertisement\b/i,
            /\badsbygoogle\b/i,
            /^google[-_]?ads/i,
            /^doubleclick/i,
            /\bgfpl[-_]/i,
            /__clb[-_]/i,
            /^div-gpt-ad/i,
          ];

          // 除外パターン（正常なコンテンツを保護）
          const excludePatterns = [
            /head/i,
            /header/i,
            /thread/i,
            /bread/i,
            /upload/i,
            /download/i,
            /loading/i,
            /ready/i,
            /read/i,
            /instead/i,
            /grad/i,
            /add/i,
            /address/i,
            /oadable/i,
          ];

          // 一般的な広告サイズ (width x height)
          const adSizes = [
            [300, 250], [728, 90], [300, 600], [160, 600],
            [320, 50], [468, 60], [336, 280], [250, 250]
          ];

          // 要素が広告かどうかをチェック
          function isAd(element) {
            try {
              // 自分自身をチェック
              if (checkAdElement(element)) return true;
              
              return false;
            } catch (e) {
              return false;
            }
          }
          
          // 親要素が広告コンテナかどうかをチェック（より慎重に）
          function shouldRemoveContainer(element) {
            try {
              // 要素自体が広告パターンに一致するか
              if (!checkAdElement(element)) return false;
              
              // 正常なコンテンツを含んでいないかチェック
              const tagName = element.tagName.toLowerCase();
              
              // article, main, section などの意味的な要素は保護
              if (['article', 'main', 'section', 'header', 'footer', 'nav', 'picture'].includes(tagName)) {
                return false;
              }
              
              // 子要素に正常なコンテンツがあるかチェック
              const hasContent = element.querySelector('img:not([src*="ad"]):not([src*="banner"]), p, h1, h2, h3, h4, h5, h6, article, main, picture, select, input[type="text"], textarea, button[id*="search"], button[class*="search"], form');
              if (hasContent) {
                return false; // 正常なコンテンツがある場合は削除しない
              }
              
              // 子要素がiframeのみまたは広告関連要素のみの場合は削除OK
              return true;
            } catch (e) {
              return false;
            }
          }
          
          // 要素自体の広告判定
          function checkAdElement(element) {
            try {
              const tagName = element.tagName.toLowerCase();
              
              // 重要なタグは保護
              if (['picture', 'source', 'article', 'main', 'section', 'header', 'footer', 'nav'].includes(tagName)) {
                return false;
              }
              
              // img タグの場合、親が picture なら保護
              if (tagName === 'img') {
                const parent = element.parentElement;
                if (parent && parent.tagName.toLowerCase() === 'picture') {
                  return false;
                }
              }
              
              // picture タグを含む要素は保護
              if (element.querySelector && element.querySelector('picture')) {
                return false;
              }
              
              // iframe は広告の可能性が高い
              if (tagName === 'iframe') {
                const src = element.src || '';
                if (src.includes('doubleclick') || src.includes('googlesyndication') || 
                    src.includes('googleadservices') || src.includes('/pagead/') ||
                    src.includes('adnxs.com') || src.includes('adform')) {
                  return true;
                }
                return false; // その他のiframeは保護
              }

              // id と class をチェック
              const id = element.id || '';
              const className = element.className || '';
              const combinedText = (id + ' ' + className).toLowerCase();
              
              // 除外パターンチェック（誤検出を防ぐ）
              for (const pattern of excludePatterns) {
                if (pattern.test(combinedText)) {
                  return false;
                }
              }
              
              // contents/content を含む要素は保護
              if (combinedText.includes('content')) {
                return false;
              }
              
              // 広告パターンマッチング
              for (const pattern of adPatterns) {
                if (pattern.test(combinedText)) {
                  return true;
                }
              }

              // data 属性をチェック（広告関連の属性のみ）
              if (element.hasAttribute && (
                  element.hasAttribute('data-ad-slot') ||
                  element.hasAttribute('data-ad-unit') ||
                  element.hasAttribute('data-google-query-id'))) {
                return true;
              }
              
              // scriptタグの場合、広告スクリプトかチェック
              if (tagName === 'script') {
                const src = element.src || '';
                if (src && (src.includes('doubleclick') || 
                    src.includes('googlesyndication') ||
                    src.includes('googleadservices'))) {
                  return true;
                }
              }
              
              // サイズチェックは厳密に（典型的な広告サイズのみ）
              const width = element.offsetWidth;
              const height = element.offsetHeight;
              
              if (width > 0 && height > 0 && tagName === 'div') {
                // 典型的な広告サイズにピッタリ一致する場合のみ
                for (const [adWidth, adHeight] of adSizes) {
                  if (width === adWidth && height === adHeight) {
                    // data-ad 属性がある場合のみ広告と判定
                    if (element.hasAttribute && (
                        element.hasAttribute('data-ad-slot') ||
                        element.hasAttribute('data-ad-unit'))) {
                      return true;
                    }
                  }
                }
              }

              return false;
            } catch (e) {
              return false;
            }
          }

          // 広告とオーバーレイを削除
          function removeAdsAndOverlays() {
            try {
              // Googleページでは広告削除をスキップ
              if (currentDomain.includes('google')) {
                return;
              }
              
              let removedCount = 0;
              const maxRemove = 100; // 削除数を増やす
              
              // data-element="overlay" を持つ要素を削除
              try {
                const overlays = document.querySelectorAll('[data-element="overlay"]');
                overlays.forEach(el => {
                  if (removedCount < maxRemove) {
                    el.remove();
                    removedCount++;
                    console.log('Overlay removed: data-element="overlay"');
                  }
                });
              } catch (e) {}
              
              // data-izone 属性を持つ要素を削除（広告の可能性が高い）
              try {
                const izoneElements = document.querySelectorAll('[data-izone]');
                izoneElements.forEach(el => {
                  if (removedCount < maxRemove) {
                    el.remove();
                    removedCount++;
                    console.log('Ad removed: data-izone');
                  }
                });
              } catch (e) {}
              
              // __ で始まるクラス名またはIDを持つ要素を削除（広告のランダムクラス/IDパターン）
              try {
                const allElements = document.querySelectorAll('*[class], *[id]');
                allElements.forEach(el => {
                  if (removedCount >= maxRemove) return;
                  
                  let shouldRemove = false;
                  
                  // クラス名をチェック
                  const className = el.className || '';
                  if (typeof className === 'string') {
                    const classes = className.split(' ');
                    for (const cls of classes) {
                      if (cls.startsWith('__')) {
                        console.log('Removing element with __ class:', cls);
                        shouldRemove = true;
                        break;
                      }
                    }
                  }
                  
                  // IDをチェック
                  if (!shouldRemove && el.id && el.id.startsWith('__')) {
                    console.log('Removing element with __ id:', el.id);
                    shouldRemove = true;
                  }
                  
                  if (shouldRemove) {
                    el.remove();
                    removedCount++;
                  }
                });
              } catch (e) {
                console.error('Double underscore removal error:', e);
              }
              
              // ランダムなクラス名を持つ要素を検出（広告の可能性が高い）
              try {
                const allDivs = document.querySelectorAll('div[class]');
                allDivs.forEach(el => {
                  if (removedCount >= maxRemove) return;
                  
                  const className = el.className || '';
                  if (typeof className === 'string') {
                    const classes = className.split(' ');
                    
                    // 各クラスをチェック
                    for (const cls of classes) {
                      // 意味のある単語を除外
                      const meaningfulWords = /content|header|footer|main|article|section|wrapper|container|button|input|nav|title|list|item|box|text|image|link|menu|card|grid|row|col|flex|body|form|table|cell|page/i;
                      if (meaningfulWords.test(cls)) {
                        continue; // 意味のある単語は保護
                      }
                      
                      // パターン1: 10文字以上で大文字小文字数字が混在
                      if (cls.length >= 10) {
                        const hasUpper = /[A-Z]/.test(cls);
                        const hasLower = /[a-z]/.test(cls);
                        const hasNumber = /[0-9]/.test(cls);
                        
                        // 大文字小文字数字が全て混在（ランダムクラスの特徴）
                        if (hasUpper && hasLower && hasNumber) {
                          el.remove();
                          removedCount++;
                          console.log('Random class removed (mixed):', cls);
                          break;
                        }
                        
                        // 大文字小文字のみ混在で12文字以上（例: zH02kz28s8CnED は14文字）
                        if (cls.length >= 12 && hasUpper && hasLower) {
                          el.remove();
                          removedCount++;
                          console.log('Random class removed (long):', cls);
                          break;
                        }
                      }
                    }
                  }
                });
              } catch (e) {
                console.error('Random class detection error:', e);
              }
              
              // 具体的な広告セレクターをチェック
              const adSelectors = [
                '.ad-container',
                '.ad-wrapper',
                '.ad-slot',
                '.ad-unit',
                '.advertisement',
                '.adsbygoogle',
                '[data-ad-slot]',
                '[data-ad-unit]',
                '[data-cfasync]',
                'iframe[src*="doubleclick"]',
                'iframe[src*="googlesyndication"]',
                'iframe[src*="googleadservices"]',
                'iframe[src*="stiffindividual"]',
                'div[id^="google_ads_"]',
                'div[id^="div-gpt-ad"]',
                'script[src*="stiffindividual"]',
                'script[src*="fervorsixtiesveteran"]',
              ];
              
              adSelectors.forEach(selector => {
                if (removedCount >= maxRemove) return;
                
                try {
                  const elements = document.querySelectorAll(selector);
                  elements.forEach(el => {
                    if (removedCount < maxRemove) {
                      el.remove();
                      removedCount++;
                      console.log('Ad removed:', selector);
                    }
                  });
                } catch (e) {
                  // セレクターエラーは無視
                }
              });

              // bodyのスクロールロックを解除
              if (document.body) {
                document.body.style.removeProperty('overflow');
                document.body.style.overflow = 'auto';
              }
              if (document.documentElement) {
                document.documentElement.style.removeProperty('overflow');
                document.documentElement.style.overflow = 'auto';
              }

              if (removedCount > 0) {
                console.log('✓ Removed ' + removedCount + ' ad/overlay elements');
              }
            } catch (error) {
              console.error('removeAdsAndOverlays error:', error);
            }
          }

          // window.openを無効化
          window.open = function() {
            console.log('window.open blocked');
            return null;
          };

          // location変更をブロック（異なるドメインへの移動）
          try {
            const originalHrefSetter = Object.getOwnPropertyDescriptor(window.location, 'href');
            
            if (originalHrefSetter && originalHrefSetter.set && originalHrefSetter.configurable !== false) {
              Object.defineProperty(window.location, 'href', {
                set: function(url) {
                  try {
                    const newUrl = new URL(url, window.location.href);
                    if (newUrl.hostname !== currentDomain && !currentDomain.includes('google')) {
                      console.log('Blocked redirect to:', url);
                      return;
                    }
                    originalHrefSetter.set.call(window.location, url);
                  } catch (e) {
                    console.error('Location setter error:', e);
                  }
                },
                get: originalHrefSetter.get,
                configurable: true
              });
            }
          } catch (e) {
            console.log('Could not override location.href:', e.message);
          }

          // window.location.replace/assign をオーバーライド
          try {
            const originalReplace = window.location.replace;
            window.location.replace = function(url) {
              try {
                const newUrl = new URL(url, window.location.href);
                if (newUrl.hostname !== currentDomain && !currentDomain.includes('google')) {
                  console.log('Blocked replace to:', url);
                  return;
                }
                originalReplace.call(window.location, url);
              } catch (e) {
                console.error('Replace error:', e);
              }
            };
          } catch (e) {
            console.log('Could not override location.replace:', e.message);
          }

          try {
            const originalAssign = window.location.assign;
            window.location.assign = function(url) {
              try {
                const newUrl = new URL(url, window.location.href);
                if (newUrl.hostname !== currentDomain && !currentDomain.includes('google')) {
                  console.log('Blocked assign to:', url);
                  return;
                }
                originalAssign.call(window.location, url);
              } catch (e) {
                console.error('Assign error:', e);
              }
            };
          } catch (e) {
            console.log('Could not override location.assign:', e.message);
          }

          // target="_blank"をブロック
          document.addEventListener('click', function(e) {
            const target = e.target.closest('a');
            if (target && target.target === '_blank') {
              e.preventDefault();
              e.stopPropagation();
              console.log('Blocked _blank link');
            }
          }, true);

          // 初回実行
          removeAdsAndOverlays();

          // DOM変更を監視（即座に実行 - デバウンスなし）
          const observer = new MutationObserver((mutations) => {
            // DOM変更を検知したら即座に実行（広告が表示される前にブロック）
            removeAdsAndOverlays();
          });

          if (document.body) {
            observer.observe(document.body, {
              childList: true,
              subtree: true,
            });
          }

        } catch (error) {
          console.error('Blocker error:', error);
        }
      })();
    `).catch((error: Error) => {
      console.error('Failed to inject blocking scripts:', error);
    });
  }

  private loadUrl(view: BrowserView, url: string) {
    if (!view || view.webContents.isDestroyed()) return;

    let finalUrl = url.trim();

    // URLかどうかを判定
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      // URLとして解析できるか試す
      try {
        new URL('http://' + finalUrl);
        if (finalUrl.includes('.')) {
          finalUrl = 'https://' + finalUrl;
        } else {
          // 検索クエリとして扱う
          finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl)}`;
        }
      } catch {
        // 検索クエリとして扱う
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl)}`;
      }
    }

    // エラー処理はdid-fail-loadイベントに任せる
    view.webContents.loadURL(finalUrl).catch((error) => {
      console.error('Load URL error:', error);
    });
  }

  private navigate(url: string) {
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (activeTab && !activeTab.view.webContents.isDestroyed()) {
      this.loadUrl(activeTab.view, url);
    }
  }

  private goBack() {
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (activeTab && !activeTab.view.webContents.isDestroyed() && activeTab.view.webContents.canGoBack()) {
      activeTab.view.webContents.goBack();
    }
  }

  private goForward() {
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (activeTab && !activeTab.view.webContents.isDestroyed() && activeTab.view.webContents.canGoForward()) {
      activeTab.view.webContents.goForward();
    }
  }

  private reload() {
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (activeTab && !activeTab.view.webContents.isDestroyed()) {
      activeTab.view.webContents.reload();
    }
  }

  private switchTab(tabId: number) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const newTab = this.tabs.find(tab => tab.id === tabId);
    if (!newTab || newTab.view.webContents.isDestroyed()) return;

    try {
      // 全てのビューを非表示
      this.tabs.forEach(tab => {
        if (!tab.view.webContents.isDestroyed()) {
          this.mainWindow!.removeBrowserView(tab.view);
        }
      });

      // 選択されたビューを表示
      this.mainWindow.addBrowserView(newTab.view);
      const bounds = this.mainWindow.getContentBounds();
      newTab.view.setBounds({
        x: 0,
        y: 80,
        width: bounds.width,
        height: bounds.height - 80,
      });

      this.activeTabId = tabId;
      this.sendToRenderer('update-url', newTab.url);
      this.sendToRenderer('update-title', newTab.title);
      this.sendToRenderer('update-tabs', this.getTabsInfo());
      // タブ切り替え時に現在のURLでの広告ブロック状態を更新
      this.updateAdBlockStatusForUrl(newTab.url);
    } catch (error) {
      console.error('Error switching tab:', error);
    }
  }

  private closeTab(tabId: number) {
    const tabIndex = this.tabs.findIndex(tab => tab.id === tabId);
    if (tabIndex === -1) return;

    const tab = this.tabs[tabIndex];
    
    try {
      // クリーンアップ関数を実行
      if (tab.cleanup) {
        tab.cleanup();
      }

      // BrowserViewを削除
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.removeBrowserView(tab.view);
      }

      // webContentsをクローズ
      if (!tab.view.webContents.isDestroyed()) {
        tab.view.webContents.close();
      }
    } catch (error) {
      console.error('Error closing tab:', error);
    }

    this.tabs.splice(tabIndex, 1);

    // 最後のタブを閉じた場合
    if (this.tabs.length === 0) {
      this.createTab('https://www.google.com');
    } else if (this.activeTabId === tabId) {
      // アクティブなタブを閉じた場合、隣のタブに切り替え
      const newActiveTab = this.tabs[Math.min(tabIndex, this.tabs.length - 1)];
      this.switchTab(newActiveTab.id);
    }

    this.sendToRenderer('update-tabs', this.getTabsInfo());
  }

  private getTabsInfo() {
    return this.tabs.map(tab => ({
      id: tab.id,
      title: tab.title || 'New Tab',
      url: tab.url,
      active: tab.id === this.activeTabId,
    }));
  }

  private togglePrivateMode() {
    this.isPrivateMode = !this.isPrivateMode;
    if (this.isPrivateMode) {
      session.defaultSession.clearStorageData();
    }
    this.sendToRenderer('update-private-mode', this.isPrivateMode);
  }

  private toggleAdBlock() {
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (!activeTab || !activeTab.url) {
      this.showNotification('アクティブなタブがありません');
      return;
    }

    try {
      const hostname = new URL(activeTab.url).hostname;
      const isCurrentlyWhitelisted = this.adBlockWhitelist.some(domain => hostname.includes(domain));

      if (isCurrentlyWhitelisted) {
        // ホワイトリストから削除（広告ブロックを有効化）
        this.adBlockWhitelist = this.adBlockWhitelist.filter(domain => !hostname.includes(domain));
        this.saveWhitelist();
        this.showNotification(`${hostname} で広告ブロックを有効化しました`);
        console.log(`✅ Removed ${hostname} from whitelist`);
      } else {
        // ホワイトリストに追加（広告ブロックを無効化）
        this.adBlockWhitelist.push(hostname);
        this.saveWhitelist();
        this.showNotification(`${hostname} で広告ブロックを無効化しました`);
        console.log(`➕ Added ${hostname} to whitelist`);
      }

      // 状態を更新してページをリロード
      this.updateAdBlockStatusForUrl(activeTab.url);
      this.reload();
    } catch (error) {
      console.error('Error toggling adblock:', error);
      this.showNotification('エラーが発生しました');
    }
  }

  private saveWhitelist() {
    try {
      const appPath = app.getAppPath();
      const whitelistPath = path.join(appPath, 'adblock-whitelist.txt');
      
      // ヘッダーコメントを保持
      const header = `# ========================================
# 日本語 / Japanese
# ========================================
# 広告除去を無効化するサイトのホワイトリスト
# 1行に1つのドメインを記述
# '#'で始まる行はコメント
# 空行は無視されます
# ★このファイルが空の場合、全サイトで広告除去が有効になります★
# ★広告除去を無効化したいサイトのドメインを下に追加してください★
#
# ========================================
# English
# ========================================
# Whitelist for Disabling Ad Removal
# Write one domain per line
# Lines starting with '#' are comments
# Empty lines are ignored
# ★If this file is empty, ad removal is enabled for ALL sites★
# ★Add domains below to disable ad removal for specific sites★
# ========================================

`;
      
      const content = header + this.adBlockWhitelist.join('\n');
      fs.writeFileSync(whitelistPath, content, 'utf-8');
      console.log('✅ Whitelist saved');
    } catch (error) {
      console.error('❌ Error saving whitelist:', error);
    }
  }

  private updateAdBlockStatusForUrl(url: string) {
    // ホワイトリストチェック
    try {
      const hostname = new URL(url).hostname;
      const isWhitelisted = this.adBlockWhitelist.some(domain => hostname.includes(domain));
      
      if (isWhitelisted) {
        this.sendToRenderer('update-adblock-status', { enabled: false, reason: 'whitelist' });
      } else {
        this.sendToRenderer('update-adblock-status', { enabled: true, reason: 'active' });
      }
    } catch {
      this.sendToRenderer('update-adblock-status', { enabled: true, reason: 'active' });
    }
  }

  private showNotification(message: string) {
    this.sendToRenderer('show-notification', message);
  }

  private sendToRenderer(channel: string, data: any) {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed() && !this.mainWindow.webContents.isDestroyed()) {
        this.mainWindow.webContents.send(channel, data);
      }
    } catch (error) {
      console.error('Error sending to renderer:', error);
    }
  }
}

new NeonBrowser();
