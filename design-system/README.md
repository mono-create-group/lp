# mono.create デザインシステム

大手コーポレート/SaaS 30社の実測（`automation/データ/デザイン学習_大手HP100.md`）から抽出した原則を、そのまま雛形にしたもの。**今後の全HP制作はここから始める。** 初稿から「大手級」の土台になることが目的。

## 使い方（3行）

1. `<head>` に Google Fonts（Noto Sans JP / Zen Kaku Gothic New）と `<link rel="stylesheet" href="../design-system/tokens.css">` を置く。
2. `sections.html` から必要なセクション（Hero / 台帳 / Showcase / 価格 / FAQ / CTA）をコピーし、中身だけ差し替える。
3. アニメを効かせるなら `../mono-create/assets/site.css` と `../mono-create/assets/site.js` も読み込み、ヒーローに `data-hero`、各ブロックに `data-reveal` を付ける（`site.js` が段階登場・スクロールreveal・数字カウントアップ・モバイルナビを担う。vanilla・prefers-reduced-motion対応済み）。

ブランド差を出したい時は、そのページの `<style>` 内で `:root{--acc:#XXXXXX;--acc-d:#XXXXXX;}` とアクセント1色だけ局所上書きする（他のトークンは共通のまま）。

## ファイル

| ファイル | 役割 |
|---|---|
| `tokens.css` | 配色・書体・流体タイポ・8pxスペーシング・角丸/影・共通ユーティリティ（`.eyebrow` `.head` `.btn` `.section` 等）。**単一ソース。** |
| `sections.html` | Hero/台帳/Showcase/価格/FAQ/CTA のコピペ雛形。ブラウザで開けばプレビューになる。 |
| `README.md` | この文書。 |
| （併用）`../mono-create/assets/site.css` | ヘッダー/メガナビ/フッター/page-hero/next-nav とアニメ用class。 |
| （併用）`../mono-create/assets/site.js` | 段階ヒーロー・reveal・カウントアップ・モバイルナビ（vanilla）。 |

## 禁止パターン一覧（＝AIが作りがちなダサさ。やったら差し戻し）

- **暗色グラデ背景を全面に敷く**（navy→teal等）。大手は0/30。→ 背景は `--paper`（白/オフ白）。暗色は CTA/フッターの**単色アンカー**だけ。
- **ヒーロー見出しを中央寄せ**にする。正統コーポレートは左寄せ。→ 左寄せ・大見出し。
- **カード3枚を機械的に横並び**で埋める。→ 罫線区切りの台帳 or 交互リズム。3列は「3つの実在する具体物」がある時だけ。
- **過剰な角丸（16px超）＋強いドロップシャドウ**を面全体に。→ 角丸は8px以下（ボタンは `--radius-xs`=2px）、影は使わず**薄い罫線**で区切る。
- **絵文字アイコン**（🔧📞😊等）。→ インラインSVG・番号・テキストのみ。
- **多色/虹色/派手グラデ**。→ アクセントは1色。
- **装飾書体・複数書体の混在**。→ sans 1系統、サイズ/weightだけで階層。
- **`overflow-wrap:anywhere` / `word-break:auto-phrase`**（日本語改行が破綻）。→ `word-break:keep-all` ＋ `<wbr>`。

## 公開前チェック（品質ゲート・全通過が公開の条件）

- [ ] `python3 automation/scripts/jp_lint.py <file>` が**違反0**
- [ ] 絵文字ゼロ／個人事業主表記（勝手に「株式会社」を付けない）
- [ ] 真の390px実レンダで横スクロールなし（`scrollWidth == clientWidth`）
- [ ] 写真は実写フリー素材(CC0)。AI生成写真は使わない
- [ ] アニメは `prefers-reduced-motion` を尊重（transform/opacityのみ・layoutプロパティを触らない）

出典の原則・頻度データ・コード断片は `automation/データ/デザイン学習_大手HP100.md` を参照。
