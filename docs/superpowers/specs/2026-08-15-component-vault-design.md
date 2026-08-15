# Component Vault 設計書

作成日: 2026-08-15

## 1. 目的

Component Vault は、HTML UIパーツをローカルで収集、編集、プレビュー、再利用するWindowsデスクトップアプリケーションである。複数の資産ライブラリを継続的に育てられ、HTMLファイルからの取り込みと、HTML・CSS・JavaScriptの直接入力の両方を扱う。

元となる PropertyHTML の主要機能を維持しつつ、永続的なライブラリ管理、リッチなダークUI、複数表示モード、安全なプレビュー、ウィンドウ状態の復元を追加する。

## 2. 採用技術

- Electron
- React
- TypeScript
- Vite
- Monaco Editor
- SQLite
- Electron Builder
- Vitest、React Testing Library、Playwright

ElectronのRenderer ProcessではNode.js APIを無効にする。OS機能とSQLiteへのアクセスは、Preload Scriptで公開する型付き・許可リスト方式のIPCだけを使用する。

## 3. 機能範囲

### 3.1 ライブラリ管理

- 複数ライブラリの作成、名称変更、説明編集、並べ替え、削除
- ライブラリごとのパーツ一覧
- 名前、カテゴリ、タグによる検索と絞り込み
- パーツの複製、移動、並べ替え、削除、削除取り消し
- すべてのデータをローカルへ自動保存

### 3.2 パーツの追加

パーツは次の2方式で追加できる。

1. HTMLファイルをドラッグ＆ドロップ、またはファイル選択で取り込む
2. HTML・CSS・JavaScriptを個別のタブへ直接入力して保存する

複数HTMLファイルの一括取り込みに対応する。完全なHTML文書とHTML断片の両方を受け付け、`title`、`h1`、ファイル名の順で初期パーツ名を推定する。

コード入力画面には次を設ける。

- HTML、CSS、JavaScriptの **Tabbed Code Editor**
- 入力停止後に更新される **Live Preview**
- 名称、カテゴリ、タグ、説明
- 外部通信の有効化と許可ドメイン設定
- 保存、複製、削除、コードコピー

### 3.3 表示モード

左サイドバーの **View Switcher** から、次の3モードを即時切り替えできる。

- A: **Workbench** — 左サイドバーと右ワークスペースの2カラム。右側はCode Editor、その直下にLive Previewを縦積みする。既定表示とする。
- B: **Gallery** — パーツのプレビューカードを1〜4列で表示する。列数はユーザーが選択できる。
- C: **Adaptive Studio** — パーツ一覧、Code Editor、Live Previewを同時表示し、各ペインの幅をドラッグで変更できる。

表示モード、Gallery列数、エディターとプレビューの高さ、各ペインの分割比率は保存し、次回起動時に復元する。

### 3.4 コピーと書き出し

- HTML、CSS、JavaScriptを個別にコピー
- CSSファイルを保存
- CSS参照を含むHTML断片をコピー
- 選択パーツまたはライブラリ全体を単一HTMLファイルとして書き出し
- 書き出したHTML内で、一覧表示、プレビュー、コードコピー、CSS保存、項目の追加・編集・再保存を利用可能にする
- 書き出したComponent Vault形式のHTMLをアプリへ再取り込みできるよう、バージョン付きの埋め込みデータを保持する

書き出しHTMLはパーツデータを個別にgzip圧縮してBase64で埋め込み、ネットワーク接続なしで利用できる自己完結形式とする。

### 3.5 ウィンドウ状態

- ウィンドウ位置、幅、高さ、最大化状態を保存する
- 移動・リサイズ中はデバウンスし、操作終了後に保存する
- 次回起動時に最後の状態を復元する
- モニターの切断や解像度変更により保存位置が画面外になった場合、現在利用可能なディスプレイ内へ補正する
- 最小サイズを設定し、操作不能なレイアウトにならないようにする

## 4. UI設計

### 4.1 App Shell

永続的な左サイドバーと、表示モードに応じて変化するメイン領域で構成する。

左サイドバーには次を配置する。

- アプリ名と現在の保存状態
- 新規パーツ作成
- A、B、CのView Switcher
- パーツ検索
- ライブラリ一覧
- タグ絞り込み
- 設定、インポート、エクスポート

`Ctrl+K` の **Command Palette** から、新規作成、検索、表示切り替え、保存、書き出しへ移動できる。

### 4.2 ビジュアル方針

- Windows向けのモダンなダークテーマ
- 背景は濃紺寄りの黒、サーフェスは階層ごとに明度差を付ける
- アクセントは紫から青のグラデーション
- 角丸は8〜14pxを中心に統一
- 境界線と控えめな発光で階層を示し、過度なガラス効果は使わない
- フォントはSegoe UIを基本とし、コードはCascadia CodeまたはConsolasを使用
- WCAG AA相当のコントラストと明確なキーボードフォーカスを維持
- モーション低減設定に対応

### 4.3 フィードバック

- 自動保存状態を `Saving`、`Saved`、`Save failed` で表示
- 取り消し可能な削除は **Undo Toast** を表示
- ライブラリ全体の削除は **Confirmation Dialog** を表示
- プレビューの例外は折り畳み可能な **Error Console** に表示
- 外部通信の遮断時は、失敗したドメインと許可操作を表示

## 5. アーキテクチャ

### 5.1 Renderer Process

- `AppShell`: ルーティング、テーマ、キーボードショートカット
- `LibrarySidebar`: ライブラリ、検索、タグ、View Switcher
- `ComponentEditor`: メタデータとMonaco Editor
- `PreviewHost`: サンドボックス文書の構築と実行状態の表示
- `GalleryView`: 1〜4列のカード表示
- `AdaptiveStudioView`: リサイズ可能な3ペイン表示
- `CommandPalette`: コマンド検索と実行

各ユニットは状態と操作を明示的なPropsまたはFeature Store経由で受け取り、SQLiteやElectron APIへ直接アクセスしない。

### 5.2 Preload Bridge

次の用途だけを型付きAPIとして公開する。

- ライブラリとパーツの読み書き
- 設定の読み書き
- HTMLファイル選択と保存先選択
- インポートとエクスポート
- ウィンドウ操作に必要な限定API

任意チャンネル名のIPC送信、任意ファイルパスの読み書き、Node.jsオブジェクトの公開は禁止する。

### 5.3 Main Process

- `WindowStateService`: ウィンドウ状態の保存、検証、復元
- `LibraryService`: ライブラリとパーツのCRUD、検索、並べ替え
- `ImportService`: 文字コード判定、HTML解析、形式変換
- `ExportService`: 自己完結HTMLの生成と保存
- `SettingsService`: 表示モードとUI設定の永続化
- `DatabaseService`: SQLite接続、マイグレーション、バックアップ

サービス間は明確なデータ型で連携し、BrowserWindowやSQLite接続をRendererへ渡さない。

## 6. データモデル

### Library

- `id`
- `name`
- `description`
- `sortOrder`
- `createdAt`
- `updatedAt`

### Component

- `id`
- `libraryId`
- `name`
- `description`
- `category`
- `html`
- `css`
- `javascript`
- `sourceType`: `file` または `editor`
- `originalFileName`
- `sortOrder`
- `createdAt`
- `updatedAt`

### Tag と ComponentTag

タグ名を正規化して多対多で関連付ける。

### PreviewPolicy

- `componentId`
- `externalNetworkEnabled`
- `allowedOrigins`

### AppSettings

- `viewMode`: `workbench`、`gallery`、`studio`
- `galleryColumns`: 1〜4
- `editorPreviewRatio`
- `studioPaneRatios`
- `lastLibraryId`
- `lastComponentId`

### WindowState

- `x`
- `y`
- `width`
- `height`
- `isMaximized`
- `displayId`

## 7. データフロー

### ファイル取り込み

1. ユーザーがHTMLファイルを選択する。
2. Main Processがファイルを読み込み、BOM、`meta charset`、内容判定によりUTF-8またはShift_JISとして復号する。
3. ImportServiceが完全なHTML文書と断片を共通のComponent形式へ変換する。
4. ユーザーが取り込み候補と推定名称を確認する。
5. LibraryServiceがSQLiteへ保存する。
6. Rendererが一覧とプレビューを更新する。

### コードから作成

1. ユーザーが新規パーツを作成する。
2. HTML、CSS、JavaScriptを入力する。
3. PreviewHostがデバウンス後にサンドボックス文書を再構築する。
4. 自動保存がSQLiteへ更新を送る。
5. 保存結果をRendererへ返し、保存状態を更新する。

### 書き出し

1. ユーザーが対象ライブラリまたはパーツを選択する。
2. ExportServiceがデータをバージョン付きペイロードへ変換する。
3. 各パーツをgzip圧縮し、ビューアーと編集機能を含む単一HTMLへ埋め込む。
4. 保存ダイアログで選択した場所へ原子的に書き込む。

## 8. プレビューの安全性

- iframe sandboxを使用し、Electron、Node.js、親Documentへのアクセスを禁止する
- 外部通信は既定で遮断する
- 有効化時も、パーツに保存されたHTTPS許可オリジンだけをCSPへ追加する
- `file:`、`javascript:`、任意ローカルパス、Electron内部URLへのアクセスを禁止する
- `window.open`、ダウンロード、ナビゲーションはアプリ側で遮断または明示確認する
- 実行エラーとCSP違反を収集し、Error Consoleへ表示する

## 9. エラー処理と復旧

- 複数ファイル取り込みでは、1ファイルの失敗で全体を中断しない
- 復号できないファイルは自動保存せず、ファイル名と理由を表示する
- 大容量ファイルは警告を表示し、明示的に続行した場合だけ取り込む
- プレビューのクラッシュや無限ループはアプリ本体から分離し、再読み込みできる
- 保存や書き出しに失敗しても、編集内容をメモリ上に保持する
- SQLiteはWALモードを使用し、マイグレーション前にバックアップする
- 異常終了後は最後の完了済み自動保存から復元する
- 外部通信の遮断は通常のセキュリティ状態として扱い、許可ドメイン追加を案内する

## 10. テスト方針

### Unit Test

- HTML文書と断片の正規化
- UTF-8、BOM、Shift_JISの判定
- 検索、タグ、並べ替え
- CSPと許可オリジンの生成
- 書き出しペイロードの圧縮と復元
- ウィンドウ位置のディスプレイ内補正

### Component Test

- Tabbed Code Editor
- View Switcher
- Gallery列数の変更
- 自動保存状態
- Undo ToastとConfirmation Dialog
- Error Console

### Electron E2E Test

- HTML取り込みからプレビューまで
- コード入力から保存、再編集まで
- A、B、C表示の切り替えと設定復元
- アプリ再起動後のライブラリ、選択項目、分割比率、ウィンドウ状態の復元
- 単一HTMLの書き出し、ブラウザ表示、コードコピー、再取り込み
- 未許可通信とNode.js APIの遮断

### Visual QA

- A、B、C表示のスクリーンショット
- 最小ウィンドウサイズと一般的なデスクトップ解像度
- 空状態、読み込み中、エラー状態、長い名称、多数のタグ
- キーボード操作、フォーカス表示、モーション低減

### Packaging Smoke Test

- Windowsインストーラーの生成
- クリーン環境相当でのインストール、初回起動、再起動、アンインストール
- ユーザーデータがアプリ更新で保持されること

## 11. 配布物

- Windows用セットアップ実行ファイル
- ポータブルZIP
- README
- Third-Party NoticesとMITライセンス表示
- 開発者向けビルド・テスト手順

## 12. ライセンスと帰属

本アプリは PropertyHTML の機能と公開実装を参考にする。元プロジェクトはMIT Licenseで公開されているため、実装を利用または改変する箇所の有無にかかわらず、次の帰属を配布物へ含める。

- `Copyright (c) 2026 uni928`
- PropertyHTMLのMIT License全文
- 参照元: https://github.com/uni928/PropertyHTML

アプリ内のAbout画面、配布物のThird-Party Notices、該当するソース配布物から確認できるようにする。

## 13. 非対象

- クラウド同期、ユーザーアカウント、共同編集
- 公開マーケットプレイス
- 外部Webサイトの自動スクレイピング
- ブラウザ拡張機能
- Electron以外のOSネイティブ版

これらは初期リリースの品質とローカル完結性を優先するため対象外とする。
