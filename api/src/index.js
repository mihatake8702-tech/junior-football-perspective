// 8人制 戦術ドリル — 成績の受け取り口（/api/*。アプリのファイルは wrangler.jsonc の assets から出る）
// 以前の Google スプレッドシート版（gas/Code.gs）と同じやりとりをする：
//   POST /api/t/<チームID>          選手の端末から成績が届く（本文 JSON の c = 選手用キー）
//   GET  /api/t/<チームID>?code=…&results=1   コーチ用リンクが成績を読む（code = コーチ用キー）
// 選手はニックネームで登録する。本名・メールなど、選手の個人情報は受け取らない。
import { DurableObject } from "cloudflare:workers";

const MAX_ANSWERS = 20000, MAX_CLEARS = 5000;      // チームごとの上限（古いものから消える）
const SIGNUPS_PER_IP_PER_DAY = 10;
const JST = 9 * 3600 * 1000;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
const page = (title, msg) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.7"><h1 style="font-size:1.3rem">${title}</h1><p>${msg}</p>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
const str = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const rand = n => { const a = "abcdefghjkmnpqrstuvwxyz23456789", b = crypto.getRandomValues(new Uint8Array(n)); return Array.from(b, x => a[x % a.length]).join(""); };
const jstDay = ms => new Date(ms + JST).toISOString().slice(0, 10);

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const registry = env.REGISTRY.get(env.REGISTRY.idFromName("registry"));
    try {
      // コーチがチームを作る：チーム名とメールだけ
      if (path === "/api/teams" && req.method === "POST") {
        const d = await req.json().catch(() => ({}));
        const name = str(d.name, 30), email = str(d.email, 254).toLowerCase();
        if (!name) return json({ ok: false, error: "name" }, 400);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "email" }, 400);
        if (!d.agree) return json({ ok: false, error: "agree" }, 400);
        const ip = req.headers.get("CF-Connecting-IP") || "local";
        if (!(await registry.allow(ip, jstDay(Date.now()), SIGNUPS_PER_IP_PER_DAY))) return json({ ok: false, error: "limit" }, 429);
        const id = rand(12), pk = rand(16), ck = rand(24), unsub = rand(16);
        await env.TEAM.get(env.TEAM.idFromName(id)).init({ id, name, pk, ck });
        await registry.add({ id, name, email, unsub });
        return json({ ok: true, app: "pd8", id, team: name, pk, ck });
      }
      // チームの受け取り口
      const m = path.match(/^\/api\/t\/([a-z0-9]{12})(\/delete)?$/);
      if (m) {
        const team = env.TEAM.get(env.TEAM.idFromName(m[1]));
        if (m[2] && req.method === "POST") {
          const d = await req.json().catch(() => ({}));
          if (!(await team.wipe(str(d.c, 40)))) return json({ ok: false, error: "bad_code" }, 403);
          await registry.remove(m[1]);
          return json({ ok: true });
        }
        if (req.method === "POST") {
          let d = null;
          try { d = JSON.parse(await req.text()); } catch (e) {}
          if (!d || typeof d !== "object") return json({ ok: false, error: "bad_json" }, 400);
          return json(await team.record(d));
        }
        if (req.method === "GET") {
          const code = str(url.searchParams.get("code"), 40);
          return json(await team.read(code, url.searchParams.get("results") === "1"));
        }
      }
      // まとめメールを止める（メールの中のリンク）
      if (path === "/api/mail/off") {
        const ok = await registry.mailOff(str(url.searchParams.get("t"), 12), str(url.searchParams.get("k"), 16));
        return ok ? page("まとめメールを止めました", "このチームの毎晩のまとめメールは、もう届きません。成績はコーチ用リンクでいつでも見られます。")
                  : page("止められませんでした", "リンクが古いか、まちがっています。");
      }
      if (path === "/api") return json({ ok: true, app: "pd8" });
      // ファイルが見つからなかったとき：フォルダの URL（/ や /board/）は index.html を返す
      if (!path.startsWith("/api") && path.endsWith("/") && env.ASSETS) return env.ASSETS.fetch(new Request(new URL(path + "index.html", url), req));
      if (!path.startsWith("/api") && !/\.[a-z0-9]+$/i.test(path) && env.ASSETS) {   // /board → /board/
        const r = await env.ASSETS.fetch(new Request(new URL(path + "/index.html", url), req));
        if (r.ok) return Response.redirect(new URL(path + "/" + url.search, url).href, 301);
      }
      return json({ ok: false, error: "not_found" }, 404);
    } catch (e) {
      return json({ ok: false, error: "server" }, 500);
    }
  },

  // 毎晩20時：その日に解いた選手がいるチームのコーチにまとめをメール
  async scheduled(event, env, ctx) {
    if (!env.RESEND_API_KEY || !env.MAIL_FROM) return;
    const registry = env.REGISTRY.get(env.REGISTRY.idFromName("registry"));
    const now = Date.now(), day = jstDay(now), from = Date.parse(day + "T00:00:00+09:00");
    for (const t of await registry.mailList()) {
      const s = await env.TEAM.get(env.TEAM.idFromName(t.id)).summary(from, from + 86400000);
      if (!s) continue;
      const off = `https://${env.SITE_HOST || "jr-football-perspective.com"}/api/mail/off?t=${t.id}&k=${t.unsub}`;
      const text = `${t.name} の今日のドリル（${day.replace(/-/g, "/")}）\n\n${s}\n\nくわしくは、コーチ用リンクの「せいせき」タブで見られます。\n\nこのメールを止める：\n${off}`;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [t.email], subject: `【MAESTRO DRILL】${t.name} 今日のまとめ`, text })
      }).catch(() => {});
    }
  }
};

// ---------- 1チーム = 1つの保存場所 ----------
export class Team extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.schema();
  }
  schema() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS answers (at INTEGER, name TEXT, grade TEXT, mode TEXT, qid TEXT, q TEXT, rate INTEGER, choice TEXT);
      CREATE TABLE IF NOT EXISTS clears (at INTEGER, name TEXT, grade TEXT, level TEXT, score TEXT);`);
  }
  meta() { return Object.fromEntries(this.sql.exec("SELECT k, v FROM meta").toArray().map(r => [r.k, r.v])); }
  init({ id, name, pk, ck }) {
    for (const [k, v] of Object.entries({ id, name, pk, ck, created: String(Date.now()) })) this.sql.exec("INSERT OR REPLACE INTO meta VALUES (?, ?)", k, v);
  }
  record(d) {
    const m = this.meta();
    if (!m.pk || (d.c !== m.pk && d.c !== m.ck)) return { ok: false, error: "bad_code" };
    const now = Date.now(), at = Number(d.at) > now - 30 * 86400000 && Number(d.at) < now + 86400000 ? Number(d.at) : now;
    const name = str(d.name, 16), grade = d.grade ? "U-" + (Number(d.grade) || "") : "";
    if (!name) return { ok: false, error: "bad_name" };
    // rate: 2 = ◎, 1 = ○, 0 = ×（古いアプリは ok だけ送る）
    const rate = d.rate === 0 || d.rate === 1 || d.rate === 2 ? d.rate : d.ok ? 2 : 0;
    if (d.type === "answer") {
      this.sql.exec("INSERT INTO answers VALUES (?, ?, ?, ?, ?, ?, ?, ?)", at, name, grade, str(d.mode, 20), str(d.qid, 10), str(d.q, 200), rate, str(d.choice, 200));
      this.sql.exec("DELETE FROM answers WHERE rowid <= (SELECT max(rowid) FROM answers) - ?", MAX_ANSWERS);
    } else if (d.type === "clear") {
      const level = typeof d.level === "number" ? "Lv" + d.level : str(d.level, 30);
      this.sql.exec("INSERT INTO clears VALUES (?, ?, ?, ?, ?)", at, name, grade, level, (Number(d.score) || 0) + "/" + (Number(d.of) || 0));
      this.sql.exec("DELETE FROM clears WHERE rowid <= (SELECT max(rowid) FROM clears) - ?", MAX_CLEARS);
    } else return { ok: false, error: "bad_type" };
    return { ok: true };
  }
  // codeOk = コーチ用キー（成績を読める）。選手用キーでは読めない
  read(code, results) {
    const m = this.meta();
    if (!m.pk) return { ok: false, error: "no_team" };
    const codeOk = !!code && code === m.ck;
    const base = { ok: true, app: "pd8", team: m.name, codeOk, playerOk: !!code && code === m.pk };
    if (!codeOk || !results) return base;
    // 形は gas/Code.gs の results_() と同じ（新しい順に最大5000問）
    const answers = this.sql.exec("SELECT at, name, grade, mode, qid, rate, choice FROM answers ORDER BY rowid DESC LIMIT 5000").toArray().map(r => [r.at, r.name, r.grade, r.mode, r.qid, r.rate, r.choice]);
    const clears = this.sql.exec("SELECT at, name, grade, level, score FROM clears ORDER BY rowid DESC LIMIT 2000").toArray().map(r => [r.at, r.name, r.grade, r.level, r.score]);
    return { ...base, answers, clears };
  }
  summary(from, to) {
    const ans = this.sql.exec("SELECT name, q, rate FROM answers WHERE at >= ? AND at < ?", from, to).toArray();
    const clr = this.sql.exec("SELECT name, level FROM clears WHERE at >= ? AND at < ?", from, to).toArray();
    if (!ans.length && !clr.length) return "";
    const by = {}, p = n => by[n] = by[n] || { n: 0, ok: 0, miss: [], clears: [] };
    ans.forEach(r => { const x = p(r.name); x.n++; if (r.rate === 2) x.ok++; else x.miss.push(r.q); });
    clr.forEach(r => p(r.name).clears.push(r.level));
    return Object.keys(by).sort().map(n => {
      const x = by[n];
      let t = "■ " + n + "　" + x.n + "問中 ◎" + x.ok + "問";
      if (x.clears.length) t += "　クリア：" + x.clears.join("・");
      if (x.miss.length) t += "\n　◎ではなかった問題：\n" + x.miss.slice(0, 5).map(q => "　・" + q).join("\n");
      return t;
    }).join("\n\n");
  }
  // コーチが「チームのデータをすべて消す」を押したとき
  async wipe(code) {
    const m = this.meta();
    if (!m.ck || code !== m.ck) return false;
    await this.ctx.storage.deleteAll();
    this.schema();   // empty tables again, so later requests answer "no_team" instead of failing
    return true;
  }
}

// ---------- チーム一覧（まとめメールの送り先）と、登録の回数制限 ----------
export class Registry extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT, email TEXT, mail INTEGER, unsub TEXT, created INTEGER);
      CREATE TABLE IF NOT EXISTS hits (ip TEXT, day TEXT, n INTEGER, PRIMARY KEY (ip, day));`);
  }
  allow(ip, day, max) {
    this.sql.exec("DELETE FROM hits WHERE day < ?", day);
    const r = this.sql.exec("SELECT n FROM hits WHERE ip = ? AND day = ?", ip, day).toArray()[0];
    if (r && r.n >= max) return false;
    this.sql.exec("INSERT INTO hits VALUES (?, ?, 1) ON CONFLICT (ip, day) DO UPDATE SET n = n + 1", ip, day);
    return true;
  }
  add({ id, name, email, unsub }) { this.sql.exec("INSERT INTO teams VALUES (?, ?, ?, 1, ?, ?)", id, name, email, unsub, Date.now()); }
  remove(id) { this.sql.exec("DELETE FROM teams WHERE id = ?", id); }
  mailList() { return this.sql.exec("SELECT id, name, email, unsub FROM teams WHERE mail = 1").toArray(); }
  mailOff(id, unsub) {
    const r = this.sql.exec("SELECT unsub FROM teams WHERE id = ?", id).toArray()[0];
    if (!r || !unsub || r.unsub !== unsub) return false;
    this.sql.exec("UPDATE teams SET mail = 0 WHERE id = ?", id);
    return true;
  }
}
