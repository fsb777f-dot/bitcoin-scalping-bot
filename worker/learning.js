// Each candidate is an entry filter. Skipped trades contribute zero, including
// skipped winners. Every outcome comes from the same main virtual execution.
export const labels = {
  all: "Все сигналы",
  spread: "Пропускать, если спред занимает от 25% расстояния до стопа",
  votes: "Требовать ещё одно подтверждение сверх минимума"
};
export function accepts(rule, row) {
  if (rule === "spread") return row.spread < 0.25 * row.risk;
  if (rule === "votes") return row.votes > row.required;
  return true;
}
export function score(rows, rule) {
  let pnl = 0, peak = 0, drawdown = 0, taken = 0, wins = 0, losses = 0;
  for (const row of rows) {
    if (row.net == null || !accepts(rule, row)) continue;
    taken++;
    wins += Number(row.net > 0);
    losses += Number(row.net < 0);
    pnl += row.net;
    peak = Math.max(peak, pnl);
    drawdown = Math.max(drawdown, peak - pnl);
  }
  return { pnl, drawdown, taken, wins, losses };
}
const day = 86400000;
const localDay = time => Math.floor((time + 5 * 3600000) / day);
export function improves(rows, rule, current) {
  const candidate = score(rows, rule), baseline = score(rows, current);
  const changed = rows.filter(r => accepts(rule, r) !== accepts(current, r));
  return rows.length >= 40 && candidate.taken >= 20 && changed.length >= 10
    && new Set(changed.map(r => localDay(r.opened))).size >= 3
    && candidate.pnl > 0 && candidate.pnl > baseline.pnl && candidate.drawdown <= baseline.drawdown;
}
export class BitcoinLearning {
  constructor(ctx) {
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sample (
      key TEXT PRIMARY KEY, opened INTEGER, closed INTEGER, side TEXT, entry REAL,
      risk REAL, spread REAL, votes INTEGER, required INTEGER, strategies TEXT,
      size REAL, cost REAL, stop REAL, max_gain REAL DEFAULT 0, net REAL,
      active TEXT, candidate TEXT, reason TEXT)`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS sample_closed ON sample(closed)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS stops (key TEXT,time INTEGER,stop REAL,PRIMARY KEY(key,time))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS model (id INTEGER PRIMARY KEY, data TEXT)");
  }
  rows(q,...args) { return this.sql.exec(q,...args).toArray(); }
  state() {
    const row = this.rows("SELECT data FROM model WHERE id=1")[0];
    return row ? JSON.parse(row.data) : { active:"all", trial:null, reviewed:null, decision:"Сбор истории", last:0 };
  }
  review(s, now) {
    if (s.reviewed === localDay(now)) return;
    s.reviewed = localDay(now);
    if (s.trial) {
      if (now - s.trial.start < 7 * day) return;
      // Freeze the entry cohort, then wait for its last open trade to settle.
      s.trial.end ??= now;
      const group = this.rows("SELECT * FROM sample WHERE opened>=? AND opened<? ORDER BY closed,key",s.trial.start,s.trial.end);
      if (group.some(r => r.closed == null)) return;
      const ok = group.every(r => r.net != null) && improves(group,s.trial.rule,s.active);
      s.previous = { rule:s.trial.rule, prior:s.active, base:score(group,s.active), test:score(group,s.trial.rule), count:group.length, time:now };
      if (ok) s.active = s.trial.rule;
      s.decision = ok ? "Фильтр принят для виртуальных входов" : "Проверка завершена. Действующее правило сохранено";
      s.trial = null;
    }
    const rows = this.rows("SELECT * FROM sample WHERE net IS NOT NULL AND opened>=? ORDER BY closed,key",now-28*day);
    if (!rows.length || now - Math.min(...rows.map(r => r.opened)) < 7*day) return;
    const rules = Object.keys(labels).filter(k => k !== s.active && improves(rows,k,s.active));
    rules.sort((a,b) => score(rows,b).pnl-score(rows,a).pnl);
    if (rules.length) s.trial = {rule:rules[0],start:now};
  }
  record(batch) {
    const s = this.state(), now = batch.time;

    for (const e of batch.events) {
      if (e.type === "entry") continue;
      const old = this.rows("SELECT stop,size FROM sample WHERE key=? AND closed IS NULL",e.key)[0];
      if (!old) continue;
      if (e.type === "missing") {
        this.sql.exec("UPDATE sample SET closed=?,reason='MISSING' WHERE key=?",now,e.key);
        continue;
      }
      if (now < s.last && e.type !== "close") continue;
      if (old.stop !== e.stop) this.sql.exec("INSERT OR REPLACE INTO stops VALUES(?,?,?)",e.key,now,e.stop);
      this.sql.exec("UPDATE sample SET stop=?,max_gain=max(max_gain,?*size) WHERE key=?",e.stop,e.move,e.key);
      if (e.type === "close") this.sql.exec("UPDATE sample SET closed=?,net=?*size-cost,reason=? WHERE key=?",e.closedAt || now,e.pnl,e.reason,e.key);
    }
    if (now >= s.last) this.review(s,now);
    for (const e of batch.events.filter(e=>e.type==="entry")) {
      if (now < s.last) continue;
      this.sql.exec(`INSERT OR IGNORE INTO sample
        (key,opened,side,entry,risk,spread,votes,required,strategies,size,cost,stop,active,candidate)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,e.key,now,e.side,e.entry,e.risk,e.spread,e.names.length,e.required,
        JSON.stringify(e.names),e.size,e.cost,e.stop,s.active,s.trial?.end ? null : s.trial?.rule ?? null);
    }
    s.last = Math.max(now,s.last);
    this.sql.exec("INSERT OR REPLACE INTO model VALUES(1,?)",JSON.stringify(s));
  }
  status() {
    const state = this.state();
    const rows = this.rows("SELECT * FROM sample WHERE net IS NOT NULL ORDER BY closed DESC,key DESC LIMIT 1000").reverse();
    const accepted = rows.filter(r=>accepts(r.active,r));
    return {state,labels,base:score(rows,"all"),learned:score(accepted,"all"),
      protectedLosses:rows.filter(r=>r.net<0 && r.max_gain>=1).length,
      open:this.rows("SELECT count(*) AS n FROM sample WHERE closed IS NULL")[0].n,
      recent:rows.slice(-12).reverse().map(r=>({...r,accepted:accepts(r.active,r),
        stops:this.rows("SELECT time,stop FROM stops WHERE key=? ORDER BY time DESC LIMIT 6",r.key)}))};
  }
  async fetch(req) {
    if (req.method === "POST") {
      const batch = await req.json();
      this.storage.transactionSync(()=>this.record(batch));
      return new Response(null,{status:204});
    }
    if (new URL(req.url).pathname === "/pending")
      return Response.json(this.rows("SELECT key FROM sample WHERE closed IS NULL").map(r=>r.key));
    return Response.json(this.status(),{headers:{"cache-control":"no-store"}});
  }
}
