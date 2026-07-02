# Neon Browser

積極的な広告ブロック機能を備えた、軽量で高速なElectronベースのブラウザです。

## 主な特徴

### カスタマイズ可能な広告ブロック
- **外部ファイルで設定可能** - `adblock-networks.txt`と`adblock-whitelist.txt`で完全カスタマイズ
- **ネットワークレベル遮断** - 広告ネットワークドメインやパスパターンを自由に設定可能
- **ホワイトリスト方式** - 指定したドメインのみ広告除去を無効化
- **ホットリロード対応** - アプリ再起動で設定を即座に反映
- **パフォーマンス影響なし** - 起動時の1回読み込みのみ、実行速度はハードコード版と同一

### 積極的な広告ブロック
- **17種類の広告パターン検出** - クラス名/ID/data属性による識別
- **19種類の広告サイズ検出** - 300x250、728x90、900x250など一般的な広告サイズを自動検出
- **広告iframe/scriptの完全ブロック** - doubleclick、googlesyndication、rtbbtr、adnxsなど主要広告ネットワークを遮断
- **高速DOM監視** - 100msデバウンスで動的に追加される広告も即座に検出・削除
- **属性変更検知** - class、id、style、srcの変更を監視し、広告の再挿入を防止
- **コンテンツ保護** - select、input、form要素を含む正常なコンテンツは保護

### ポップアップ・リダイレクト完全ブロック
- `window.open()` 無効化
- `target="_blank"` 自動ブロック
- クロスドメインナビゲーション制限（同一ドメイン内のみ許可、Googleは例外）
- JavaScriptリダイレクトブロック（location.href、replace、assign）
- スクロールロック自動解除

### モダンなUI
- **タブシステム** - 最大10タブ、直感的なタブ切り替え
- **ダークテーマ** - 目に優しいダークカラースキーム
- **Ctrl+クリック/中クリック** - 同一ドメイン内で新しいタブを開く
- **シークレットモード** - SVG鍵アイコン、ワンクリックで履歴/Cookie削除

### 開発者機能
- **F12** - WebViewの開発者ツール
- **Ctrl+Shift+I** - ブラウザUIの開発者ツール
- リアルタイム広告削除ログ

## 機能一覧

### ブラウザ機能
- タブ機能（最大10タブ）
- 戻る・進む・リロード
- URL入力/検索（Google検索対応）
- URLエラー時の自動Google検索フォールバック
- シークレットモード

### 広告ブロック機能
- パターンベース検出（ad、banner、sponsor、promo、gfpl、__clbなど17種類）
- サイズベース検出（300x250、728x90、300x600、900x250など19種類）
- iframe広告ブロック（主要広告ネットワーク対応）
- 広告スクリプトブロック（code.js、.com/lv/など）
- オーバーレイ自動削除（z-index ≥ 1000、画面90%以上）
- DOM変更監視（100msデバウンス）
- 属性変更検知（class、id、style、src）
- コンテンツ保護（picture、select、input、form、検索ボタンなど）
- Googleページでの広告削除スキップ

### セキュリティ機能
- window.open() 無効化
- target="_blank" ブロック
- クロスドメインナビゲーション制限
- JavaScriptリダイレクトブロック
- ポップアップ通知システム

## セットアップ

1. 依存関係のインストール:
```bash
npm install
```

2. TypeScriptのコンパイル:
```bash
npm run build
```

3. アプリケーションの起動:
```bash
npm start
```

または、開発モードで起動:
```bash
npm run dev
```

## ビルド（実行ファイル作成）

### ポータブル実行ファイル（.exe）の作成

インストール不要で、どこでも実行できる単体のアプリケーションを作成できます：

```bash
npm run pack-simple
```

実行ファイルは `release\NeonBrowser-win32-x64\NeonBrowser.exe` に作成されます。

### デスクトップショートカットの作成

PowerShellで以下を実行（プロジェクトフォルダから）：

```powershell
$DesktopPath = [Environment]::GetFolderPath('Desktop')
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$DesktopPath\Neon Browser.lnk")
$Shortcut.TargetPath = "$PWD\release\NeonBrowser-win32-x64\NeonBrowser.exe"
$Shortcut.WorkingDirectory = "$PWD\release\NeonBrowser-win32-x64"
$Shortcut.Save()
```

または、簡易起動用バッチファイル（`start.bat`）を使用してショートカットを作成することもできます。

### 配布方法

`NeonBrowser-win32-x64` フォルダ全体をコピーして配布してください。`NeonBrowser.exe` は単体では動作しません（同じフォルダ内の resources、locales などのファイルが必要です）。

## 使い方

### 基本操作
1. アプリケーションを起動すると、Googleのホームページが開きます
2. アドレスバーにURLを入力するか、検索キーワードを入力してEnterキーを押します
3. **Ctrl+T** - 新しいタブを開く
4. **Ctrl+W** - 現在のタブを閉じる
5. **F5** - ページをリロード
6. **F12** - 開発者ツールを開く

### 広告ブロック
- ページ読み込み時に自動的に広告を検出・削除
- DOM変更を監視し、動的に追加される広告も100ms以内に削除
- 削除された広告の数はコンソールログで確認可能（F12で開発者ツールを開く）

### タブ機能
- **Ctrl+クリック** または **中クリック** - 同一ドメインのリンクを新しいタブで開く
- 異なるドメインへのタブ作成は自動的にブロックされます
- タブは最大10個まで開けます

### シークレットモード
- 鍵アイコンをクリックしてシークレットモードを切り替え
- アクティブ時は鍵アイコンが緑色になります
- ストレージデータ（Cookie、履歴など）が自動的にクリアされます

## 広告ブロックのカスタマイズ

### 設定ファイル

ブラウザのルートディレクトリ（`NeonBrowser.exe`と同じ場所）に2つの設定ファイルがあります：

#### 1. `adblock-networks.txt` - ネットワークレベルの遮断リスト

広告ネットワークのドメインやパスパターンを記述します。これらのURLへのリクエストは完全にブロックされます。

```txt
# Google広告
doubleclick.net
googlesyndication.com
googleadservices.com

# 主要広告ネットワーク
adnxs.com
criteo.com
outbrain.com

# パスパターン
/ads/
/ad/
```

#### 2. `adblock-whitelist.txt` - 広告除去を無効化するホワイトリスト

このリストに記載されたドメインでは、広告除去が無効化されます（広告が表示されます）。

```txt
# 広告除去を無効化したいサイト
example.com
trustedsite.net
```

**重要：**
- **ファイルが空の場合、全サイトで広告除去が有効になります（デフォルト）**
- 広告除去を無効化したいサイトがあれば、ドメインを追加してください
- `#`で始まる行はコメント

### カスタマイズ方法

1. **ネットワーク遮断の追加**：
   - `adblock-networks.txt`を開く
   - 1行に1つのドメインまたはパスパターンを追加
   - `#`で始まる行はコメント

2. **ホワイトリストへの追加**：
   - `adblock-whitelist.txt`を開く
   - 広告除去を**無効化**したいサイトのドメインを追加
   - `#`で始まる行はコメント

3. **設定の反映**：
   - ブラウザを再起動すると、設定が自動的に読み込まれます
   - コンソール（F12）で読み込み状況を確認できます

### 初回起動時の自動初期化

ブラウザを初めて起動するとき、または設定ファイルが削除された場合、以下のように自動的に作成されます：

- **adblock-networks.txt**: 
  - `adblock-networks.txt.template`が存在すればコピー
  - テンプレートがない場合は、デフォルトの設定（例のみ）を含むファイルを作成
  
- **adblock-whitelist.txt**:
  - ファイルが存在しない場合、検索エンジン（google.com、yahoo.comなど）をホワイトリストとして含むデフォルトファイルを作成

これにより、常に正しい状態で起動できます。個人的なブロックリストは `adblock-networks.txt` にカスタマイズしてください。

### パフォーマンス

- ファイル読み込みは起動時に1回だけ（数ミリ秒）
- 実行時のブロック処理はメモリ上の配列を使用
- ハードコード版と実質的に同じ速度

## 広告ブロック技術詳細

### 検出パターン
```typescript
// 広告キーワード（17種類）
ad, ads, banner, sponsor, promo, popup, overlay, 
advertisement, google-ads, doubleclick, advert, 
ad-container, ad-wrapper, ad-slot, ad-unit, gfpl, __clb

// 広告サイズ（19種類）
300x250, 728x90, 300x600, 160x600, 320x50, 300x100,
320x100, 468x60, 234x60, 120x600, 120x240, 336x280,
250x250, 200x200, 180x150, 125x125, 360x190, 380x200,
350x180, 900x250
```

### ブロック対象
- **iframe**: doubleclick、googlesyndication、advertising、rtbbtr、adnxs、adform
- **script**: 広告スクリプトドメイン（chaseherbalpasty、code.jsなど）
- **data属性**: data-ad、data-cbi、data-role、data-cfasync
- **オーバーレイ**: z-index ≥ 1000、画面の90%以上を覆う要素

### 保護されるコンテンツ
- `picture`, `source`, `img` タグ（picture要素内）
- `article`, `main`, `section`, `header`, `footer`, `nav`
- `select`, `input[type="text"]`, `textarea`, `form`
- `button[id*="search"]`, `button[class*="search"]`
- クラス名/IDに "contents" または "content" を含む要素

## キーボードショートカット

| ショートカット | 機能 |
|--------------|------|
| **Ctrl+T** | 新しいタブ |
| **Ctrl+W** | タブを閉じる |
| **F5** | リロード |
| **F12** | WebView開発者ツール |
| **Ctrl+Shift+I** | UI開発者ツール |
| **Ctrl+クリック** | 新しいタブで開く |
| **中クリック** | 新しいタブで開く |

## 技術スタック

- **Electron** 31.x
- **TypeScript** 5.x
- **Node.js** (module: commonjs, moduleResolution: node16)
- **BrowserView** アーキテクチャ（複数タブ対応）

## アーキテクチャ

- **Main Process** (main.ts) - BrowserView管理、IPC処理、広告ブロックスクリプト注入
- **Preload Scripts** 
  - `preload.js` - UI用（contextIsolation: true）
  - `webview-preload.js` - WebView用（contextIsolation: false）
- **Renderer Process** (index.html) - タブUI、ツールバー
- **Ad Blocking** - JavaScriptインジェクション、MutationObserver、100msデバウンス

## ライセンス

MIT
