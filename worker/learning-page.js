export const learningPage = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Самообучение BTC</title>
<style>*{box-sizing:border-box}body{background:#101722;color:#ebeff4;font:16px/1.45 system-ui;margin:0 auto;max-width:640px;padding:18px}h1{font-size:26px}h2{font-size:18px}section,details{background:#1b2636;padding:14px;border-radius:12px;margin:12px 0}p{margin:7px 0}small{color:#b4c1ce}td,th{text-align:right;padding:5px}th:first-child,td:first-child{text-align:left}table{width:100%;font-size:14px}button{font:inherit;padding:7px 12px}</style>
<h1>Самообучение BTC</h1><button onclick="refresh()">Обновить</button> <small id="time"></small><main id="report" aria-live="polite"></main>
<script>
const money=n=>Number(n).toFixed(2)+' $';
function el(parent,tag,value){const e=document.createElement(tag);e.textContent=value;parent.append(e);return e}
const date=t=>new Date(t).toLocaleString('ru-RU',{timeZone:'Asia/Qostanay'});
async function refresh(){const out=document.getElementById('report');try{
const res=await fetch('/api/learning',{cache:'no-store'});if(!res.ok)throw Error('HTTP '+res.status);
const d=await res.json(),s=d.state;out.replaceChildren();
document.getElementById('time').textContent=s.last?'Сканирование '+date(s.last):'Ожидание сканирования';
let box=el(out,'section','');el(box,'h2','Виртуальный бот');el(box,'p','Действующее правило: '+d.labels[s.active]);
el(box,'p',s.decision);el(box,'p',s.trial?'Проверяется с '+date(s.trial.start)+': '+d.labels[s.trial.rule]:'Кандидат на проверку пока не выбран.');
el(box,'small','Ежедневный отбор по истории до 28 дней. Первая оценка после недели. Новый фильтр проходит ещё минимум неделю на следующих сигналах.');
if(s.previous){const v=s.previous;el(box,'p','Последняя проверка: '+d.labels[v.rule]+'. Сигналов '+v.count+'. Результат до / после: '+money(v.base.pnl)+' / '+money(v.test.pnl)+'. Просадка: '+money(v.base.drawdown)+' / '+money(v.test.drawdown));}
box=el(out,'section','');el(box,'h2','Последние закрытые сделки · до 1000');
const tab=el(box,'table','');for(const row of [['Версия','Сделки','Итог','Просадка'],['Основная',d.base.taken,money(d.base.pnl),money(d.base.drawdown)],['Обучаемая',d.learned.taken,money(d.learned.pnl),money(d.learned.drawdown)]]){const tr=el(tab,'tr','');row.forEach(v=>el(tr,'td',v))}
el(box,'p','Открытых исходных сделок: '+d.open+'. Закрылись в минус после наблюдаемой прибыли от $1: '+d.protectedLosses+'.');
el(box,'small','Просадка по закрытиям. Спред включён в цены, дополнительные расходы берутся из применённого пресета. При отсутствии пресета используется объём BTC из настроек или 0,0005 BTC.');
for(const r of d.recent){let x=el(out,'details','');el(x,'summary',r.side+' · '+money(r.net)+' · '+(r.accepted?'вход':'пропуск'));el(x,'p',date(r.opened)+' → '+date(r.closed));el(x,'p','Подтверждения: '+JSON.parse(r.strategies).join(', '));el(x,'p','Спред '+r.spread.toFixed(2)+' · объём '+r.size+' BTC · максимум прибыли по наблюдениям '+money(r.max_gain));el(x,'p','Вход '+r.entry+' · исходный стоп '+(r.entry+(r.side==='BUY'?-1:1)*r.risk).toFixed(2)+' · последний стоп '+r.stop+' · '+r.reason);for(const v of r.stops)el(x,'p',date(v.time)+' · стоп '+v.stop);}
}catch(e){out.textContent='Не удалось загрузить отчёт: '+e.message}}
refresh();</script></html>`;
