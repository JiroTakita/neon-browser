import { app, BrowserWindow, BrowserView, ipcMain, session, Menu } from 'electron';
import * as path from 'path';
import { URL } from 'url';

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

  constructor() {
    app.whenReady().then(() => {
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

    // シークレットモードの設定
    if (this.isPrivateMode) {
      ses.clearStorageData();
    }
  }

  private createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
      autoHideMenuBar: false, // メニューバーを表示
    });

    this.mainWindow.loadFile(path.join(__dirname, '../index.html'));
    
    // メニューを作成
    this.createMenu();

    this.setupIpcHandlers();
    this.createTab('https://www.google.com');
  }

  private createMenu() {
    const template: any[] = [
      {
        label: '表示',
        submenu: [
          {
            label: '開発者ツール (WebView)',
            accelerator: 'F12',
            click: () => {
              this.openDevTools();
            }
          },
          {
            label: 'UI開発者ツール',
            accelerator: 'Ctrl+Shift+I',
            click: () => {
              if (this.mainWindow) {
                this.mainWindow.webContents.openDevTools();
              }
            }
          },
          { type: 'separator' },
          {
            label: 'リロード',
            accelerator: 'F5',
            click: () => {
              this.reload();
            }
          }
        ]
      },
      {
        label: 'タブ',
        submenu: [
          {
            label: '新しいタブ',
            accelerator: 'Ctrl+T',
            click: () => {
              this.createTab('https://www.google.com');
            }
          },
          {
            label: 'タブを閉じる',
            accelerator: 'Ctrl+W',
            click: () => {
              if (this.activeTabId) {
                this.closeTab(this.activeTabId);
              }
            }
          }
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  private openDevTools() {
    const activeTab = this.tabs.find(tab => tab.id === this.activeTabId);
    if (activeTab && !activeTab.view.webContents.isDestroyed()) {
      activeTab.view.webContents.openDevTools();
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

    // ナビゲーション制限を追加
    view.webContents.on('will-navigate', (event, navigationUrl) => {
      try {
        this.handleNavigation(event, navigationUrl, view.webContents.getURL());
      } catch (error) {
        console.error('Navigation error:', error);
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
        }
        this.sendToRenderer('update-tabs', this.getTabsInfo());
        
        // スクリプトインジェクションは最小限に
        setTimeout(() => {
          if (!view.webContents.isDestroyed()) {
            this.injectBlockingScripts(view.webContents);
          }
        }, 500);
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

          // 広告関連のキーワードパターン
          const adPatterns = [
            /ad[s]?[-_]?/i,
            /banner/i,
            /sponsor/i,
            /promo/i,
            /popup/i,
            /overlay/i,
            /advertisement/i,
            /\bad\b/i,
            /google[-_]?ads/i,
            /doubleclick/i,
            /advert/i,
            /_ad_/i,
            /-ad-/i,
            /ad[-_]?container/i,
            /ad[-_]?wrapper/i,
            /ad[-_]?slot/i,
            /ad[-_]?unit/i,
            /gfpl/i,  // gfpl-wrapper などの広告コンテナ
            /__clb[-_]/i  // __clb- 広告スクリプトクラス
          ];

          // 一般的な広告サイズ (width x height)
          const adSizes = [
            [300, 250], [728, 90], [300, 600], [160, 600],
            [320, 50], [300, 100], [320, 100], [468, 60],
            [234, 60], [120, 600], [120, 240], [336, 280],
            [250, 250], [200, 200], [180, 150], [125, 125],
            [360, 190], [380, 200], [350, 180], [900, 250] // 900x250追加
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
              
              // picture, source タグは保護
              if (['picture', 'source'].includes(tagName)) {
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
              if (element.querySelector('picture')) {
                return false;
              }
              
              // iframe は広告の可能性が高い
              if (tagName === 'iframe') {
                const src = element.src || '';
                if (src.includes('doubleclick') || src.includes('googlesyndication') || 
                    src.includes('advertising') || src.includes('/ads/') ||
                    src.includes('adserver') || src.includes('ad.') || src.includes('.ad/') ||
                    src.includes('rtbbtr') || src.includes('adnxs') || src.includes('adform')) {
                  return true;
                }
              }

              // id と class をチェック
              const id = element.id || '';
              const className = element.className || '';
              const combinedText = (id + ' ' + className).toLowerCase();
              
              // 除外パターン（誤検出を防ぐ）
              if (combinedText.includes('contents') || combinedText.includes('content')) {
                return false; // contents/content を含む要素は保護
              }
              
              for (const pattern of adPatterns) {
                if (pattern.test(combinedText)) {
                  return true;
                }
              }

              // data 属性をチェック（広告関連の属性）
              const attrs = element.attributes;
              for (let i = 0; i < attrs.length; i++) {
                const attrName = attrs[i].name.toLowerCase();
                const attrValue = attrs[i].value.toLowerCase();
                if (attrName.startsWith('data-ad') || attrName.includes('ad-slot') || 
                    attrName.includes('ad-unit') || attrValue.includes('advertisement') || 
                    attrValue.includes('sponsor') || attrValue.includes('google-ad') ||
                    attrName === 'data-cbi' || attrName === 'data-role' ||
                    attrName === 'data-cfasync') {  // Cloudflare広告スクリプト
                  return true;
                }
              }
              
              // scriptタグの場合、広告スクリプトかチェック
              if (tagName === 'script') {
                const src = element.src || '';
                if (src && (src.includes('ad') || src.includes('.com/lv/') || 
                    src.includes('chaseherbalpasty') || src.includes('code.js'))) {
                  return true;
                }
              }
              
              // scriptタグのみを含むdivは広告コンテナの可能性が高い
              if (tagName === 'div') {
                const children = Array.from(element.children);
                if (children.length === 1 && children[0].tagName.toLowerCase() === 'script') {
                  const script = children[0];
                  const scriptSrc = script.src || '';
                  if (scriptSrc && (scriptSrc.includes('ad') || scriptSrc.includes('.com/lv/') ||
                      scriptSrc.includes('chaseherbalpasty'))) {
                    return true;
                  }
                }
              }

              // サイズチェック（一般的な広告サイズ）
              const width = element.offsetWidth;
              const height = element.offsetHeight;
              
              if (width > 0 && height > 0) {
                for (const [adWidth, adHeight] of adSizes) {
                  // 正確なサイズまたは±10pxの誤差を許容
                  if (Math.abs(width - adWidth) <= 10 && Math.abs(height - adHeight) <= 10) {
                    // 典型的な広告サイズ（300x250, 728x90など）はz-indexなしでも削除
                    const isTypicalAdSize = (adWidth === 300 && adHeight === 250) || 
                                           (adWidth === 728 && adHeight === 90) ||
                                           (adWidth === 300 && adHeight === 600) ||
                                           (adWidth === 160 && adHeight === 600) ||
                                           (adWidth === 320 && adHeight === 50) ||
                                           (adWidth === 360 && adHeight === 190) ||
                                           (adWidth === 900 && adHeight === 250);
                    
                    if (isTypicalAdSize) {
                      return true;
                    }
                    
                    // その他のサイズは追加条件をチェック
                    const style = window.getComputedStyle(element);
                    if ((style.position === 'relative' || style.position === 'absolute' || style.position === 'fixed') && 
                        parseInt(style.zIndex) > 0) {
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
                console.log('Ad removal skipped on Google domain');
                return;
              }
              
              let removedCount = 0;
              const maxRemove = 100; // 制限を設ける
              
              // すべての要素をチェック
              const elements = document.querySelectorAll('*');
              
              elements.forEach(el => {
                if (removedCount >= maxRemove) return;
                
                try {
                  const style = window.getComputedStyle(el);
                  const position = style.position;
                  const zIndex = parseInt(style.zIndex) || 0;
                  const width = el.offsetWidth;
                  const height = el.offsetHeight;
                  const display = style.display;

                  // オーバーレイの検出（既存のロジック）
                  if ((position === 'fixed' || position === 'absolute') &&
                      zIndex >= 1000 &&
                      width > window.innerWidth * 0.9 &&
                      height > window.innerHeight * 0.9) {
                    el.remove();
                    removedCount++;
                    console.log('Overlay removed:', el);
                    return;
                  }

                  // 広告要素の検出と削除
                  const tagName = el.tagName.toLowerCase();
                  
                  // 広告スクリプトタグを削除
                  if (tagName === 'script') {
                    const src = el.src || '';
                    if (src && (src.includes('ad') || src.includes('.com/lv/') || 
                        src.includes('chaseherbalpasty') || src.includes('code.js'))) {
                      el.remove();
                      removedCount++;
                      console.log('Ad script removed:', el);
                      return;
                    }
                  }
                  
                  // iframeは慎重に判定して削除
                  if (tagName === 'iframe') {
                    const src = el.src || '';
                    if (src.includes('doubleclick') || src.includes('googlesyndication') || 
                        src.includes('advertising') || src.includes('/ads/') ||
                        src.includes('adserver') || src.includes('ad.') || src.includes('.ad/') ||
                        src.includes('rtbbtr') || src.includes('adnxs') || src.includes('adform')) {
                      el.remove();
                      removedCount++;
                      console.log('Ad iframe removed:', el);
                      return;
                    }
                  }
                  
                  // 通常の広告パターンマッチング
                  if (isAd(el)) {
                    // コンテナ要素の場合は、正常なコンテンツがないか追加チェック
                    if (['div', 'aside', 'span'].includes(tagName)) {
                      if (!shouldRemoveContainer(el)) {
                        console.log('Skipped removal (has content):', el);
                        return; // 正常なコンテンツがあるのでスキップ
                      }
                    }
                    
                    el.remove();
                    removedCount++;
                    console.log('Ad removed:', el);
                    return;
                  }

                } catch (error) {
                  // 個別の要素エラーは無視
                }
              });

              // bodyのスクロールロックを解除（より積極的に）
              if (document.body) {
                document.body.style.removeProperty('overflow');
                document.body.style.overflow = 'auto';
                document.body.style.removeProperty('position');
                document.body.style.removeProperty('height');
                document.body.style.removeProperty('width');
              }
              if (document.documentElement) {
                document.documentElement.style.removeProperty('overflow');
                document.documentElement.style.overflow = 'auto';
                document.documentElement.style.removeProperty('position');
                document.documentElement.style.removeProperty('height');
                document.documentElement.style.removeProperty('width');
              }

              console.log('Removed ' + removedCount + ' ad elements');
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

          // DOM変更を監視（デバウンス付き）
          let timeoutId = null;
          const observer = new MutationObserver((mutations) => {
            // DOM変更のたびに実行（デバウンスで100ms待機）
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
              removeAdsAndOverlays();
            }, 100);
          });

          if (document.body) {
            observer.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,  // 属性変更も監視（class/id変更を検知）
              attributeFilter: ['class', 'id', 'style', 'src']  // 重要な属性のみ
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
