'use strict';
const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(n,d=0)=>n==null?'—':new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:d}).format(n);
const stamp=v=>v?new Date(v).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
const active=t=>!['closed','rejected'].includes(t.status);
let state=null,mode=null,instrument=null,page='overview',demo=false,registering=false,csrf='',cfg={},confirmFn=null,emailPurpose='reset',resetToken='',refreshing=false,lastRefresh=null;
const titles={overview:['YOUR DAY, AT A GLANCE','Trading overview','Your predefined strategy, positions, and risk.'],markets:['ONE STRATEGY. CLEAR CONDITIONS.','Market setups','Choose your markets and risk limits. Entry rules are fixed.'],trades:['EVERY TRADE, ACCOUNTED FOR','Trade journal','Entry prices, exit levels, and confirmed execution status.'],activity:['A TRANSPARENT TRADING DAY','Activity log','Account-wide history of monitoring and execution events.'],connection:['YOUR ACCOUNT, SECURELY CONNECTED','FYERS connection','Authorize through FYERS. Your password never enters QuantPilot.']};
function scopedSetups(){return (state?.setups||[]).filter(s=>s.mode===mode&&s.instrument===instrument);}
function scopedTrades(){return (state?.trades||[]).filter(t=>t.mode===mode&&t.instrument===instrument);}
function badge(s){return '<span class="badge '+esc(s)+'">'+esc(s.replaceAll('_',' '))+'</span>';}
function toast(text,error=false){$('#toast').textContent=text;$('#toast').hidden=false;$('#toast').className='toast'+(error?' error':'');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,error?10000:5000);}
async function api(path,method='GET',body){
 if(demo)throw new Error('The sample workspace cannot contact the trading API.');
 const response=await fetch(path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});
 let data;try{data=await response.json();}catch{throw new Error('Unexpected server response. Please try again.');}
 if(!response.ok){if(response.status===401&&state)showAuth();throw new Error(data.error||'Request failed');}
 return data;
}
function showAuth(){state=null;demo=false;mode=null;instrument=null;csrf='';$('#auth').hidden=false;$('#workspace').hidden=true;$('#picker').hidden=true;sessionStorage.removeItem('qp-workspace');}
function picker(step='mode'){
 $('#auth').hidden=true;$('#workspace').hidden=true;$('#picker').hidden=false;
 const second=step==='instrument';$('#step-one').className=second?'done':'current';$('#step-two').className=second?'current':'';
 $('#picker-title').textContent=second?'What would you like to trade?':'How would you like to trade?';
 $('#picker-label').textContent=second?(mode==='paper'?'PAPER TRADING':'LIVE TRADING'):'YOUR WORKSPACE, YOUR CHOICE';
 $('#picker-back').hidden=!second;
 const cards=second?[['equity','▥','STOCKS','Equity','Your predefined stock breakout setup, with long and short entries.'],['option','⌥','CALLS & PUTS','Options','Automatic nearest-expiry ATM selection for your fixed options strategy.']]:[['paper','◫','PRACTISE WITH YOUR RULES','Paper Trading','Use real broker market data with simulated orders.'],['live','↗','TRADE THROUGH FYERS','Live Trading','Use your connected account with explicit risk limits and broker orders.']];
 $('#picker-options').innerHTML=cards.map(([key,icon,tag,title,copy])=>'<button class="choice-card" data-action="'+(second?'instrument':'mode')+'" data-value="'+key+'"><span class="choice-icon">'+icon+'</span><span class="choice-tag">'+tag+'</span><strong>'+title+'</strong><span class="choice-copy">'+copy+'</span><span class="choice-bottom">Continue <b>→</b></span></button>').join('');
 $('#picker-note').textContent=demo?'Sample workspace · No broker connection or real orders.':'Switching workspaces does not pause existing monitoring.';
 $('#picker-title').focus();
}
function workspace(){
 $('#picker').hidden=true;$('#auth').hidden=true;$('#workspace').hidden=false;$('.sidebar').classList.remove('open');
 if(!demo)sessionStorage.setItem('qp-workspace',JSON.stringify({mode,instrument}));
 render();window.scrollTo(0,0);
}
function rules(){
 return '<div class="strategy-strip"><div><span class="eyebrow">BUILT-IN INTRADAY STRATEGY</span><h3>'+ (instrument==='option'?'Underlying breakout. Option momentum.':'Previous-day breakout. Confirmed momentum.')+'</h3><p>'+ (instrument==='option'?'Above previous high → buy ATM CE. Below previous low → buy ATM PE.<br>Both entries require a green option candle, open & close above SMA(20), RSI crossover, positive MACD, and volume confirmation.':'Long above the previous high; short below the previous low. Directional candle touching SMA(20), at least 60% of its body beyond it, RSI crossover, MACD, and volume confirmation.')+'</p><div class="rule-chips"><span>5-minute candles</span>'+ (instrument==='option'?'<span>Nearest expiry · ATM</span><span>SL 10 premium points</span><span>Target 20 premium points</span>':'<span>Prior 2-candle stop</span><span>Target 2R</span>')+'</div></div></div>';
}
function readiness(){
 const items=[[state.user.verified,'Account verified'],[!!state.broker?.connected,'FYERS connected'],[state.engine.online,'Trading worker online']];
 if(mode==='live')items.push([state.liveEnabled,'Live execution enabled']);
 return ((!demo&&cfg.hostingProfile==='free-paper')?'<p role="note">Paper testing: keep the scanner laptop awake and online. After a restart, resume monitoring explicitly. Paper exits during downtime are not simulated.</p>':'')+'<div class="readiness">'+items.map(([ok,label])=>'<span class="'+(ok?'ready':'')+'">'+(ok?'✓':'○')+' '+label+'</span>').join('')+'</div>';
}
function render(){
 if(!state||!mode||!instrument)return;
 const info=titles[page];$('#page-eyebrow').textContent=info[0];$('#page-title').textContent=info[1];$('#page-description').textContent=info[2];$('#breadcrumb').textContent=info[1];
 $('#workspace-context').innerHTML=(mode==='paper'?'Paper Trading':'Live Trading')+' · '+(instrument==='option'?'Options':'Equity')+'<small>Switch workspace ↗</small>';
 $('#user-name').textContent=state.user.name;$('#user-email').textContent=state.user.email;$('#user-initial').textContent=state.user.name[0];
 $('#engine-label').textContent=demo?'Sample engine':state.engine.online?'Worker online':'Worker offline';
 $('#engine-dot').className='status-dot'+(!state.engine.online?' off':'');
 $('#engine-copy').textContent=demo?'All displayed activity is illustrative.':state.engine.online?'Positions stay monitored on the server.':'New starts are blocked. Check Render worker health.';
 $('#demo-banner').hidden=!demo;document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
 let banner='';
 if(!state.user.verified)banner+='<div class="banner">Verify your email before connecting your broker.<button class="text-button" data-action="resend">Resend verification</button></div>';
 if(mode==='live'&&!state.liveEnabled)banner+='<div class="banner"><strong>Live execution is locked.</strong> You can prepare risk settings. Real orders require completed broker acceptance testing and operator enablement.</div>';
 if(state.halts.some(h=>h.mode===mode))banner+='<div class="banner"><strong>Daily loss limit reached.</strong> New entries are locked for today. Existing exits remain monitored.</div>';
 $('#page-body').innerHTML=banner+(page==='overview'?overview():page==='markets'?markets():page==='trades'?trades():page==='activity'?activity():connection());
}
function overview(){
 const trades=scopedTrades(),open=trades.filter(active),closed=trades.filter(t=>t.status==='closed'),pnl=closed.reduce((s,t)=>s+(t.pnl??0),0);
 const stats=[['Recorded realised P&L',mode==='live'?'See FYERS':money(pnl),mode==='live'?'Broker statement is authoritative':'All loaded paper trades · excludes charges'],['Active positions',String(open.length),'Includes orders awaiting confirmation'],['Markets monitored',String(scopedSetups().filter(s=>s.status==='running').length),'New entries require every condition'],['Risk : reward','1 : 2',instrument==='option'?'10-point SL · 20-point target':'Previous 2-candle stop · 2R target']];
 return readiness()+'<div class="stats">'+stats.map(([label,value,sub])=>'<div class="stat"><span class="stat-label">'+label+'</span><div class="stat-value">'+value+'</div><small>'+sub+'</small></div>').join('')+'</div>'+rules()+'<div class="panel"><div class="panel-heading"><div><h3>Open positions</h3><p>Actual entry determines your exit levels. Exit requests remain pending until confirmed.</p></div><button class="text-button" data-nav="trades">View journal →</button></div>'+tradeTable(open)+'</div><div class="panel-heading"><div><h3>Your markets</h3><p>Configure risk once, then start or pause monitoring.</p></div><button class="text-button" data-nav="markets">All setups →</button></div>'+marketGrid();
}
const checks={breakout:'Underlying breakout',candle:'Green candle',ma:'Open & close > SMA20',rsi:'RSI14 crosses RSI20',macd:'MACD > signal',volume:'Volume > prior 5 avg'};
function marketGrid(){
 const all=instrument==='option'?['NIFTY','BANKNIFTY','FINNIFTY','CRUDEOIL']:scopedSetups().map(s=>s.market);
 if(!all.length)return '<div class="panel empty-state"><h3>Choose an equity to monitor</h3><p>Your stock strategy is already built in. Add a symbol and set its risk budget.</p><button class="primary" data-nav="markets">Select equity →</button></div>';
 return '<div class="market-grid">'+all.map(market=>{
  const s=scopedSetups().find(s=>s.market===market),snap=s?.snapshot||{},labels={...checks};
  if(instrument==='equity'){labels.breakout='Stock breakout';labels.candle='Directional candle';labels.ma='Body beyond SMA20';labels.rsi='Directional RSI cross';labels.macd='Directional MACD';}
  const disabled=s?.status==='running'||scopedTrades().some(t=>t.setup_id===s?.id&&active(t));
  const startDisabled=!s||!state.broker?.connected||!state.engine.online||!state.user.verified||(mode==='live'&&!state.liveEnabled)||state.halts.some(h=>h.mode===mode);
  return '<article class="market-card"><div class="market-head"><div><h3>'+esc(market.replace('NSE:','').replace('-EQ',''))+'</h3><small>'+ (market==='CRUDEOIL'?'MCX · Associated futures breakout':instrument==='option'?'NSE · Spot index breakout':'NSE · Equity breakout')+'</small></div>'+badge(s?.status||'paused')+'</div><div class="market-signal"><p>'+esc(snap.message||(s?'Ready to monitor when started.':'Set a risk budget to prepare this market.'))+'</p>'+(snap.contract?'<span class="contract-line">'+esc(snap.contract)+' · '+esc(snap.optionType||'')+(snap.expiry?' · '+esc(snap.expiry):'')+'</span>':'')+(snap.candleTime?'<small class="muted">Signal candle '+stamp(snap.candleTime*1000)+'</small>':'')+'</div><div class="checks">'+Object.entries(labels).map(([key,label])=>{const value=snap.checks?.[key];return '<span class="check '+(value===true?'pass':value===false?'fail':'')+'"><i>'+(value===true?'✓':value===false?'−':'·')+'</i>'+label+'</span>';}).join('')+'</div><div class="market-footer"><small>'+(s?'Risk '+money(s.config.riskPerTrade)+' / trade<br>Daily loss cap '+money(s.config.dailyLoss):'No risk settings saved')+'</small><div class="button-group"><button class="secondary" data-action="risk" data-value="'+esc(market)+'" '+(disabled?'disabled':'')+'>Configure risk</button>'+(s?.status==='running'?'<button class="primary" data-action="pause" data-id="'+s.id+'">Pause entries</button>':'<button class="primary" data-action="start" data-id="'+esc(s?.id||'')+'" '+(startDisabled?'disabled':'')+'>Start monitoring</button>')+'</div></div></article>';
 }).join('')+'</div>';
}
function markets(){
 return readiness()+rules()+(instrument==='equity'?'<form id="equity-form" class="equity-form"><input name="symbol" aria-label="NSE equity symbol" placeholder="NSE:RELIANCE-EQ" pattern="NSE:[A-Z0-9&_-]{2,40}-EQ" required><button class="primary" type="submit">Configure equity →</button></form>':'')+marketGrid();
}
function tradeTable(rows){
 if(!rows.length)return '<div class="empty-state"><h3>No trades here yet</h3><p>Trades appear when all entry conditions pass. Starting monitoring does not guarantee an entry.</p></div>';
 return '<div class="table-scroll"><table><thead><tr><th>Contract / symbol</th><th>Status</th><th>Qty</th><th>Entry</th><th>Stop</th><th>Target</th><th>P&L</th><th>Action</th></tr></thead><tbody>'+rows.map(t=>'<tr><td><strong>'+esc(t.symbol)+'</strong><small>'+stamp(t.created_at)+' · '+(t.side===1?'BUY':'SELL')+'</small></td><td>'+badge(t.status)+(t.exit_requested?'<small>Exit requested</small>':'')+'</td><td>'+t.filled_qty+' / '+t.quantity+(t.multiplier>1?'<small>× '+t.multiplier+' units</small>':'')+'</td><td>'+money(t.entry,2)+'</td><td>'+money(t.stop,2)+'</td><td>'+money(t.target,2)+'</td><td class="'+(t.pnl>=0?'positive':'negative')+'">'+money(t.pnl,2)+'</td><td>'+(active(t)?'<button class="text-button" data-action="close" data-id="'+t.id+'" '+(t.exit_requested?'disabled':'')+'>Request exit</button>':'<span class="muted">'+esc(t.reason||'—')+'</span>')+'</td></tr>').join('')+'</tbody></table></div>';
}
function trades(){return '<div class="panel"><div class="panel-heading"><div><h3>Execution journal</h3><p>Latest 200 account trades, filtered to this workspace. CSV exports up to 10,000 account-wide trades.</p></div><button class="secondary" data-action="export">↓ Export CSV</button></div>'+tradeTable(scopedTrades())+'</div>';}
function activity(){return '<div class="panel"><div class="panel-heading"><div><h3>Account activity</h3><p>Includes both trading modes and all instruments.</p></div></div>'+ (state.events.length?state.events.map(e=>'<div class="activity-row"><span>'+esc(e.action)+(e.detail?.market?' · '+esc(e.detail.market):'')+'</span><time>'+stamp(e.created_at)+'</time></div>').join(''):'<div class="empty-state"><p>Account and trading events will appear here.</p></div>')+'</div>';}
function connection(){
 const connected=state.broker?.connected;
 return '<div class="connection-layout"><div class="panel"><div class="broker-logo">FYERS<span class="brand-dot">.</span></div>'+badge(connected?'connected':'disconnected')+'<h2 class="connection-title">'+(connected?'Your account is connected.':'Connect your trading account.')+'</h2><p class="connection-copy">'+(connected?'Account '+esc(state.broker.account_mask)+'<br>Authorization expires '+stamp(state.broker.expires_at)+'. Renew when FYERS requires it.':'Paper trading uses your authorized FYERS market data. Live trading uses the same connection only when live execution has been enabled.')+'</p><div class="button-group"><button class="primary" data-action="connect" '+(!state.user.verified?'disabled':'')+'>'+(connected?'Renew authorization ↗':'Connect FYERS ↗')+'</button>'+(state.broker?'<button class="secondary" data-action="disconnect">Disconnect</button>':'')+'</div><p class="fineprint">Tokens are encrypted on the server. No broker password or API secret is requested in this screen. Active positions must be reconciled before changing broker accounts.</p></div><div class="panel"><h3>How the connection works</h3><div class="numbered-step"><b>1</b><div><strong>Authorize on FYERS</strong>Review and approve the platform’s broker permissions.</div></div><div class="numbered-step"><b>2</b><div><strong>Set your risk limits</strong>Choose your market and budgets. The strategy is already defined.</div></div><div class="numbered-step"><b>3</b><div><strong>Start monitoring explicitly</strong>Connecting alone never places an order.</div></div>'+readiness()+'</div></div>';
}
function openRisk(market){
 const s=scopedSetups().find(s=>s.market===market),form=$('#risk-form');form.reset();form.elements.market.value=market;
 if(s)for(const [key,value] of Object.entries(s.config))if(form.elements[key])form.elements[key].value=value;
 $('#risk-title').textContent=market+' · '+(mode==='paper'?'Paper':'Live')+' risk';
 $('#risk-summary').textContent=instrument==='option'?'Fixed rules: 5-minute green candle · nearest-expiry ATM · SL 10 premium points · target 20 premium points.':'Fixed rules: 5-minute breakout · SMA20 · RSI14/20 · MACD · volume · previous 2-candle stop · 2R target.';
 $('#risk-error').textContent='';$('#risk-dialog').showModal();
}
function confirm(title,copy,fn){$('#confirm-title').textContent=title;$('#confirm-copy').textContent=copy;confirmFn=fn;$('#confirm-dialog').showModal();}
async function refresh(){
 if(demo){render();return;}if(refreshing)return;
 refreshing=true;
 try{state=await api('/api/dashboard');csrf=state.csrf;lastRefresh=new Date();$('#connection-warning').hidden=true;
 if(!mode||!instrument)picker(mode?'instrument':'mode');else if(!document.querySelector('dialog[open]'))workspaceWithoutScroll();
 }catch(e){if(state){$('#connection-warning').textContent='Connection interrupted. Last update '+stamp(lastRefresh)+'. Displayed data may be stale. '+e.message;$('#connection-warning').hidden=false;}else if(!String(e.message).includes('sign in')){$('#auth-error').textContent=e.message;}}
 finally{refreshing=false;}
}
function workspaceWithoutScroll(){$('#auth').hidden=true;$('#picker').hidden=true;$('#workspace').hidden=false;render();}
function addDemoEvent(action,detail={}){state.events.unshift({action,detail,created_at:new Date().toISOString()});}
function demoState(){
 const now=new Date().toISOString(),setups=[];
 for(const m of ['paper','live'])for(const [i,market] of ['NIFTY','BANKNIFTY','FINNIFTY','CRUDEOIL'].entries()){
  setups.push({id:m+'-'+market,mode:m,instrument:'option',market,status:m==='paper'&&i<2?'running':'paused',config:{riskPerTrade:1000,dailyLoss:3000,capital:50000,maxTrades:3},snapshot:{message:i===0?'Waiting for RSI crossover on the ATM call.':i===1?'Underlying has broken the previous low; checking ATM put.':'Waiting for underlying previous-day breakout.',checks:{breakout:i<2,candle:i<2,ma:i<2,rsi:false,macd:i===0,volume:i<2},optionType:i===0?'CE':i===1?'PE':undefined}});
 }
 return {user:{name:'Demo Trader',email:'sample@quantpilot.demo',verified:true},broker:{connected:true,account_mask:'••••DEMO',expires_at:new Date(Date.now()+3600000).toISOString()},engine:{online:true},liveEnabled:false,halts:[],setups,trades:[{id:'sample-trade',setup_id:'paper-NIFTY',mode:'paper',instrument:'option',symbol:'NIFTY ATM CE · SAMPLE',side:1,quantity:1,filled_qty:1,entry:150,stop:140,target:170,status:'closed',exit:170,pnl:20,reason:'Illustrative target exit; quantity is a sample, not current lot metadata',created_at:now}],events:[{action:'Sample workspace opened — illustrative data only',created_at:now,detail:{}}]};
}
document.addEventListener('click',async event=>{
 const b=event.target.closest('button');if(!b)return;
 if(b.dataset.close){$('#'+b.dataset.close).close();return;}
 const nav=b.dataset.page||b.dataset.nav;if(nav){page=nav;$('.sidebar').classList.remove('open');render();return;}
 const action=b.dataset.action;if(!action)return;
 try{
 if(action==='demo'){demo=true;state=demoState();mode=null;instrument=null;picker();return;}
 if(action==='toggle-auth'){registering=!registering;$('#name-field').hidden=!registering;$('#auth-form').elements.name.required=registering;$('#invite-field').hidden=!registering||!cfg.inviteRequired;$('#auth-title').textContent=registering?'Your trading workspace.':'Welcome back.';$('#auth-submit').textContent=registering?'Create account →':'Sign in →';$('#auth-toggle').textContent=registering?'Already registered? Sign in':'Create an account';$('#auth-form').elements.password.autocomplete=registering?'new-password':'current-password';return;}
 if(action==='mode'){mode=b.dataset.value;picker('instrument');return;}
 if(action==='instrument'){instrument=b.dataset.value;page='overview';workspace();return;}
 if(action==='switch'){mode=null;instrument=null;picker();return;}
 if(action==='mobile'){$('.sidebar').classList.toggle('open');return;}
 if(action==='logout'){if(!demo)await api('/api/auth/logout','POST',{});showAuth();return;}
 if(action==='refresh'){await refresh();toast('Workspace refreshed');return;}
 if(action==='risk'){openRisk(b.dataset.value);return;}
 if(action==='forgot'){emailPurpose='reset';resetToken='';$('#email-form').reset();$('#email-input-label').hidden=false;$('#new-password-label').hidden=true;$('#email-title').textContent='Reset your password';$('#email-error').textContent='';$('#email-dialog').showModal();return;}
 if(action==='resend'){if(demo){toast('Demo account is verified');return;}const r=await api('/api/auth/resend','POST',{email:state.user.email});toast(r.message);return;}
 if(action==='export'){if(demo){toast('Sample journal is illustrative; CSV is available for actual account trades.');return;}location.href='/api/trades.csv';return;}
 if(action==='connect'){if(demo){toast('Sample only. FYERS authorization is disabled in the demo.');return;}b.disabled=true;const r=await api('/api/broker/connect','POST',{});location.assign(r.url);return;}
 if(action==='disconnect'){confirm('Disconnect FYERS?','Monitoring will pause. Disconnecting is blocked while positions or uncertain orders remain.',async()=>{if(demo){state.broker=null;addDemoEvent('Sample broker disconnected');}else await api('/api/broker/disconnect','POST',{});await refresh();});return;}
 if(action==='start'||action==='pause'){
 const s=state.setups.find(s=>s.id===b.dataset.id);
 const run=async()=>{if(demo){s.status=action==='start'?'running':'paused';addDemoEvent('Sample monitoring '+(action==='start'?'started':'paused'),{market:s.market});}else{const r=await api('/api/setups/'+s.id+'/'+action,'POST',{});toast(r.message);}await refresh();};
 if(action==='start')confirm('Start '+s.market+' monitoring?',(mode==='live'?'This can place real orders in your FYERS account. ':'Paper orders are simulated using broker quotes. ')+'Entries require all fixed strategy conditions. Your saved risk limits apply.',run);else await run();return;
 }
 if(action==='close'){confirm('Request position exit?','The worker will process the request. A live exit is complete only when FYERS confirms the position is flat.',async()=>{if(demo){const t=state.trades.find(t=>t.id===b.dataset.id);t.exit_requested=true;addDemoEvent('Sample exit requested');}else{const r=await api('/api/trades/'+b.dataset.id+'/close','POST',{});toast(r.message);}await refresh();});return;}
 if(action==='emergency'){confirm('Stop trading and request exits?','This stops new entries in ALL your workspaces and queues exits for active positions. If the worker or broker is unavailable, manage positions directly in FYERS.',async()=>{if(demo){state.setups.forEach(s=>s.status='paused');addDemoEvent('Sample emergency stop');}else{const r=await api('/api/emergency-stop','POST',{});toast(r.message);}await refresh();});}
 }catch(e){toast(e.message,true);}finally{b.disabled=false;}
});
$('#confirm-button').addEventListener('click',async()=>{const b=$('#confirm-button');b.disabled=true;try{await confirmFn?.();$('#confirm-dialog').close();}catch(e){toast(e.message,true);}finally{b.disabled=false;}});
$('#auth-form').addEventListener('submit',async e=>{
 e.preventDefault();const b=$('#auth-submit');b.disabled=true;$('#auth-error').textContent='';
 try{const form=new FormData(e.target),body={email:form.get('email'),password:form.get('password')};if(registering){body.name=form.get('name');body.invite=form.get('invite')||'';}const r=await api('/api/auth/'+(registering?'register':'login'),'POST',body);csrf=r.csrf;e.target.elements.password.value='';await refresh();}
 catch(e){$('#auth-error').textContent=e.message;}finally{b.disabled=false;}
});
$('#risk-form').addEventListener('submit',async e=>{
 e.preventDefault();const b=e.submitter;b.disabled=true;$('#risk-error').textContent='';
 try{const form=new FormData(e.target),market=form.get('market'),risk={};for(const key of ['riskPerTrade','dailyLoss','capital','maxTrades'])risk[key]=Number(form.get(key));if(risk.riskPerTrade>risk.dailyLoss)throw new Error('Risk per trade cannot exceed the daily loss limit.');
 if(demo){let s=scopedSetups().find(s=>s.market===market);if(!s){s={id:'sample-'+Date.now(),mode,instrument,market,snapshot:{},status:'paused'};state.setups.push(s);}s.config=risk;addDemoEvent('Sample risk settings saved',{market});}
 else await api('/api/setups','PUT',{mode,instrument,market,risk});
 $('#risk-dialog').close();toast('Risk settings saved. Monitoring remains paused.');await refresh();
 }catch(e){$('#risk-error').textContent=e.message;}finally{b.disabled=false;}
});
document.addEventListener('submit',e=>{if(e.target.id==='equity-form'){e.preventDefault();openRisk(new FormData(e.target).get('symbol').trim().toUpperCase());}});
$('#email-form').addEventListener('submit',async e=>{
 e.preventDefault();const b=e.submitter;b.disabled=true;$('#email-error').textContent='';
 try{const data=new FormData(e.target),r=resetToken?await api('/api/auth/reset','POST',{token:resetToken,password:data.get('password')}):await api('/api/auth/request-reset','POST',{email:data.get('email')});resetToken='';$('#email-dialog').close();toast(r.message);}
 catch(e){$('#email-error').textContent=e.message;}finally{b.disabled=false;}
});
async function init(){
 try{cfg=await api('/api/config');}catch(e){$('#auth-error').textContent='Server unavailable. You can still explore the sample workspace.';}
 const hash=new URLSearchParams(location.hash.slice(1));history.replaceState(null,'',location.pathname);
 if(hash.has('verify')){try{toast((await api('/api/auth/verify','POST',{token:hash.get('verify')})).message);}catch(e){toast(e.message,true);}}
 if(hash.has('reset')){resetToken=hash.get('reset');$('#email-input-label').hidden=true;$('#new-password-label').hidden=false;$('#email-title').textContent='Set a new password';$('#email-dialog').showModal();}
 try{const saved=JSON.parse(sessionStorage.getItem('qp-workspace')||'null');if(saved&&['paper','live'].includes(saved.mode)&&['option','equity'].includes(saved.instrument)){mode=saved.mode;instrument=saved.instrument;}}catch{}
 await refresh();
}
setInterval(()=>{$('#clock').textContent=new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'})+' IST';},1000);
setInterval(()=>{if(state&&!demo&&!document.hidden&&!document.querySelector('dialog[open]'))void refresh();},10000);
void init();

