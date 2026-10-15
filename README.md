# 8人制 ポジションドリル

8人制サッカーの戦術を、ポジション別・レベル別（Lv1〜10、全120問）に学べるWebアプリです。

- 選手用：<https://jr-football-perspective.com/>
- コーチ用（チーム名とメールを入れるだけで、選手用・コーチ用リンクができる）：<https://jr-football-perspective.com/coach.html>
- 作戦ボード（コーチ用）：<https://jr-football-perspective.com/board/>

選手はニックネームで登録します。成績は、成績受け取り口（`api/`、Cloudflare Worker）にチームごとに保存され、コーチ用リンクでだけ読めます。くわしくは privacy.html。以前のGoogleスプレッドシート方式のチームのリンクも、そのまま使えます。

作戦ボードの選手名・保存した配置・練習メニューは、その端末のブラウザの中にだけ保存されます。

## 公開のしくみ

`jr-football-perspective.com` は Cloudflare Worker（`wrangler.jsonc`）1つで出しています。

- `/api/*`：成績の受け取り口（`api/src/index.js`）
- それ以外：このフォルダのファイル（出さないものは `.assetsignore`）

GitHub の main に push すると、Cloudflare が自動で公開します。ローカルで試すとき：`API_BASE=http://localhost:8787 python3 build.py` → `npm run dev` → http://localhost:8787/
