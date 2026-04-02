import type { Command } from 'commander';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import type { CostMode, DashboardData } from '../core/types.js';
import { loadData } from '../core/data-pipeline.js';
import { filterEntries, buildDashboardData } from '../core/aggregator.js';
import { parseCostMode } from '../utils/format.js';

function generateHtml(data: DashboardData): string {
  // Double-encode: JSON.stringify produces the JSON string, then stringify THAT
  // to produce a valid JS string literal. This is XSS-safe because all special
  // characters (<, >, ', \) are properly escaped by the outer stringify.
  const rawJson = JSON.stringify(data);
  const safeJson = JSON.stringify(rawJson);

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const projectOptions = data.projects
    .map((p) => `<option value="${esc(p.project)}">${esc(p.project)}</option>`)
    .join('\n');
  const dateStart = data.date_range.start ? data.date_range.start.slice(0, 10) : '';
  const dateEnd = data.date_range.end ? data.date_range.end.slice(0, 10) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CCTrack Dashboard</title>
<!-- Apache ECharts: Apache License 2.0 - https://echarts.apache.org -->
<script src="https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js"><\/script>
<script>var DATA = JSON.parse(${safeJson});<\/script>
<style>
:root{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#94a3b8;--accent:#6366f1;--green:#22c55e;--red:#ef4444;--yellow:#eab308;--cyan:#06b6d4;--blue:#3b82f6;--hm0:#283548;--hm1:#2d3a4a;--hm2:#365314;--hm3:#4d7c0f;--hm4:#ca8a04;--hm5:#dc2626}
.light{--bg:#f8fafc;--card:#fff;--border:#e2e8f0;--text:#1e293b;--muted:#64748b;--hm0:#f1f5f9;--hm1:#d9f99d;--hm2:#84cc16;--hm3:#ca8a04;--hm4:#ea580c;--hm5:#dc2626}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);padding:24px;min-height:100vh;max-width:100vw;overflow-x:hidden}
.header{margin-bottom:20px;padding-right:50px}
.header h1{font-size:1.4rem;font-weight:700}.header .sub{color:var(--muted);font-size:.8rem;margin-top:2px}
.toggle{position:fixed;top:24px;right:24px;z-index:200;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:6px 10px;cursor:pointer;color:var(--text);font-size:1rem;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.filters{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 20px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:20px}
.filter-group{display:flex;align-items:center;gap:6px}
.filters label{color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;font-weight:600;white-space:nowrap}
.filters input,.filters select{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text);font-size:.85rem;max-width:100%}
.filters select{min-width:140px}
.filter-actions{display:flex;gap:8px}
.btn{padding:6px 16px;border-radius:6px;border:none;cursor:pointer;font-size:.85rem;font-weight:600}
.btn-apply{background:var(--accent);color:#fff}.btn-reset{background:var(--card);color:var(--text);border:1px solid var(--border)}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.stat{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 20px;min-width:0;overflow:hidden}
.stat-label{color:var(--muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;font-weight:600}
.stat-value{font-size:1.6rem;font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums}
.stat-value.green{color:var(--green)}
.grid{display:grid;gap:16px;margin-bottom:16px}
.grid-1{grid-template-columns:1fr}.grid-2{grid-template-columns:1fr 1fr}
.grid-2-1{grid-template-columns:2fr 1fr}
.panel{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;position:relative;min-width:0}
.panel-title{font-size:.85rem;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.panel-title::before{content:'';width:8px;height:8px;border-radius:50%;display:inline-block}
.pt-blue::before{background:var(--blue)}.pt-yellow::before{background:var(--yellow)}.pt-green::before{background:var(--green)}.pt-accent::before{background:var(--accent)}.pt-cyan::before{background:var(--cyan)}.pt-red::before{background:var(--red)}
.chart-container{height:320px;width:100%}
.chart-sm{height:260px}
.chart-tall{min-height:300px}
.heatmap-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.heatmap{display:grid;grid-template-columns:36px repeat(24,1fr);gap:2px;font-size:.65rem;padding:6px 0;min-width:500px;max-width:800px}
.hm-label{color:var(--muted);display:flex;align-items:center;justify-content:flex-end;padding-right:8px;font-weight:600}
.hm-cell{aspect-ratio:1;border-radius:3px;min-width:14px;min-height:14px;max-width:28px;max-height:28px;position:relative;cursor:default}
.hm-cell:hover .hm-tip{display:block}
.hm-tip{display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:.7rem;white-space:nowrap;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,.3)}
.tbl-wrap{max-height:400px;overflow:auto;overflow-x:auto;border:1px solid var(--border);border-radius:8px;position:relative}
table{width:100%;border-collapse:collapse}
th{position:sticky;top:0;background:var(--card);text-align:left;padding:8px 10px;font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);border-bottom:1px solid var(--border);cursor:pointer;user-select:none;font-weight:600}
th:hover{color:var(--text)}
td{padding:6px 10px;border-bottom:1px solid var(--border);font-size:.8rem;font-variant-numeric:tabular-nums}
#sessTable td:nth-child(4),#sessTable td:nth-child(5),#sessTable td:nth-child(6),#sessTable td:nth-child(7){white-space:nowrap}
.text-right{text-align:right}.text-mono{font-family:ui-monospace,monospace;font-size:.75rem}
.roi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
.roi-card{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:14px;text-align:center;min-width:0}
.roi-label{color:var(--muted);font-size:.65rem;text-transform:uppercase;letter-spacing:.04em;font-weight:600}
.roi-value{font-size:1.3rem;font-weight:700;margin-top:4px}.roi-sub{color:var(--muted);font-size:.7rem;margin-top:2px}
.footer{text-align:center;color:var(--muted);font-size:.7rem;margin-top:24px;padding-top:16px;border-top:1px solid var(--border)}
.sess-id{cursor:default;display:inline-flex;align-items:center;gap:4px}.sess-id:hover{color:var(--accent)}
.copy-btn{background:none;border:none;color:var(--muted);cursor:pointer;font-size:.85rem;padding:0;vertical-align:middle;line-height:1}.copy-btn:hover{color:var(--accent)}
.model-cell{cursor:default;display:inline-flex;align-items:center;gap:4px}
.model-badge{background:var(--accent);color:#fff;border-radius:10px;padding:1px 6px;font-size:.6rem;font-weight:700}
.cc-tooltip{display:none;position:fixed;z-index:9999;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:.75rem;white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:none}
.cc-tooltip.show{display:block}
#sessTable tbody tr{transition:background .15s}#sessTable tbody tr:hover{background:var(--bg)}
th.sorted-asc::after{content:' \\25B2';font-size:.55rem}th.sorted-desc::after{content:' \\25BC';font-size:.55rem}
.pricing-note{position:relative;cursor:help;border-bottom:1px dotted var(--muted)}
.pricing-tip{display:none;position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:.7rem;white-space:nowrap;z-index:200;box-shadow:0 8px 24px rgba(0,0,0,.4);text-align:left}
.pricing-note:hover .pricing-tip,.pricing-note:focus .pricing-tip{display:block}
@media(max-width:1024px){.grid-2-1{grid-template-columns:1fr 1fr}}
@media(max-width:768px){.stats{grid-template-columns:repeat(2,1fr)}.roi-grid{grid-template-columns:repeat(2,1fr)}.grid-2,.grid-2-1{grid-template-columns:1fr}.filters{flex-direction:column;align-items:stretch}.filter-group{flex-direction:column;align-items:stretch}.filter-group label{margin-bottom:2px}.filters select,.filters input{min-width:0;width:100%}.filter-actions{justify-content:stretch}.filter-actions .btn{flex:1}.header h1{font-size:1.2rem}.toggle{top:16px;right:16px}.stat-value{font-size:1.3rem}.chart-container{height:280px}.chart-sm{height:240px}body{padding:16px}}
@media(max-width:480px){.stats{grid-template-columns:1fr}.roi-grid{grid-template-columns:repeat(2,1fr)}.stat{padding:12px 16px}.stat-value{font-size:1.1rem}.roi-value{font-size:1rem}.chart-container{height:240px}.chart-sm{height:200px}.toggle{top:10px;right:10px}body{padding:10px}.grid{gap:10px}.panel{padding:10px}.panel-title{font-size:.8rem;margin-bottom:8px}.filters label{font-size:.7rem}.filters input,.filters select{font-size:.8rem;padding:5px 8px}.footer{font-size:.65rem}}
@media print{body{background:#fff;color:#000}.panel,.stat,.roi-card{border-color:#ddd;break-inside:avoid}.filters,.toggle{display:none!important}.chart-print-img{width:100%;height:auto}}
</style>
</head>
<body>
<div class="header">
  <div><h1>CCTrack Dashboard</h1><div class="sub">${esc(dateStart)} — ${esc(dateEnd)} &middot; Generated ${new Date().toLocaleString()}</div></div>
  <button class="toggle" id="themeToggle" title="Toggle theme">☀</button>
</div>

<div class="filters">
  <div class="filter-group"><label>From</label><input type="date" id="dateStart" value="${esc(dateStart)}"></div>
  <div class="filter-group"><label>To</label><input type="date" id="dateEnd" value="${esc(dateEnd)}"></div>
  <div class="filter-group"><label>Project</label><select id="projectFilter"><option value="">All Projects</option>${projectOptions}</select></div>
  <div class="filter-actions"><button class="btn btn-apply" id="btnApply">Apply</button><button class="btn btn-reset" id="btnReset">Reset</button></div>
</div>

<div class="stats">
  <div class="stat"><div class="stat-label">Total Cost</div><div class="stat-value" id="statCost" style="color:var(--accent)"></div></div>
  <div class="stat"><div class="stat-label">Total Tokens</div><div class="stat-value" id="statTokens"></div></div>
  <div class="stat"><div class="stat-label">Total Requests</div><div class="stat-value" id="statReqs"></div></div>
  <div class="stat"><div class="stat-label">Active Sessions</div><div class="stat-value" id="statSessions"></div></div>
</div>

<div class="grid grid-1"><div class="panel"><div class="panel-title pt-blue">Cost Over Time</div><div class="chart-container" id="chartCost" role="img" aria-label="Bar chart showing daily cost over time with cumulative line"></div></div></div>
<div class="grid grid-2">
  <div class="panel"><div class="panel-title pt-cyan">Input / Output Tokens</div><div class="chart-container" id="chartIO" role="img" aria-label="Stacked bar chart of input and output tokens per day"></div></div>
  <div class="panel"><div class="panel-title pt-yellow">Cache Tokens</div><div class="chart-container" id="chartCache" role="img" aria-label="Stacked bar chart of cache write and read tokens per day"></div></div>
</div>
<div class="grid grid-2-1">
  <div class="panel" id="projectPanel"><div class="panel-title pt-accent">Project Breakdown</div><div class="chart-container chart-tall" id="chartProject" style="height:${Math.max(280, data.projects.length * 44)}px"></div></div>
  <div class="panel"><div class="panel-title pt-green">Model Distribution</div><div class="chart-container" id="chartModel" style="min-height:320px"></div></div>
</div>
<div class="grid grid-1"><div class="panel"><div class="panel-title pt-green">Cache Reuse Efficiency</div><div class="chart-container chart-sm" id="chartCacheEff"></div></div></div>

<div class="grid grid-1"><div class="panel">
  <div class="panel-title pt-blue">Usage Heatmap</div>
  <div style="color:var(--muted);font-size:.75rem;margin-bottom:10px" id="heatmapDesc">When do you use Claude the most? Each cell shows total tokens processed at that day-of-week + hour, aggregated across all dates in the range.</div>
  <div class="heatmap-wrap"><div id="heatmap" class="heatmap"></div></div>
  <div style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:.7rem;color:var(--muted)">
    <span>Less</span>
    <span style="width:14px;height:14px;border-radius:2px;background:var(--hm0)"></span>
    <span style="width:14px;height:14px;border-radius:2px;background:var(--hm1)"></span>
    <span style="width:14px;height:14px;border-radius:2px;background:var(--hm2)"></span>
    <span style="width:14px;height:14px;border-radius:2px;background:var(--hm3)"></span>
    <span style="width:14px;height:14px;border-radius:2px;background:var(--hm4)"></span>
    <span style="width:14px;height:14px;border-radius:2px;background:var(--hm5)"></span>
    <span>More</span>
  </div>
</div></div>

<div class="grid grid-1"><div class="panel">
  <div class="panel-title pt-accent">Sessions <span id="sessCount" style="color:var(--muted);font-weight:400;font-size:.75rem"></span></div>
  <div class="tbl-wrap">
    <table id="sessTable">
      <thead><tr><th data-col="session">Session</th><th data-col="project">Project</th><th data-col="model">Model</th><th data-col="duration" class="text-right">Duration</th><th data-col="requests" class="text-right">Requests</th><th data-col="tokens" class="text-right">Tokens</th><th data-col="cost" class="text-right">Cost</th></tr></thead>
      <tbody id="sessBody"></tbody>
    </table>
  </div>
</div></div>

<div class="grid grid-1"><div class="panel">
  <div class="panel-title pt-red">ROI Analysis</div>
  <div class="roi-grid" id="roiCards"></div>
  <div class="chart-container chart-sm" id="chartROI"></div>
</div></div>

<div class="footer"><span class="pricing-note" tabindex="0">Costs calculated using pricing v<span id="pricingVer"></span><span class="pricing-tip" id="pricingTip"></span></span><br>Generated by cctrack &middot; <a href="https://github.com/azharuddinkhan3005/cctrack" style="color:var(--accent)">github</a></div>
<div class="cc-tooltip" id="ccTooltip"></div>

<script>
(function(){
  // ── Helpers ──
  function fmt(n){if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'K';return n.toLocaleString();}
  function fmtCost(n){return n<0.01&&n>0?'$'+n.toFixed(4):'$'+n.toFixed(2);}
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function cumul(arr){var r=[],s=0;arr.forEach(function(v){s+=v;r.push(s);});return r;}
  function isDark(){return!document.documentElement.classList.contains('light');}
  function duration(start,end){var ms=new Date(end)-new Date(start);var s=Math.floor(ms/1000);if(s<60)return s+'s';var m=Math.floor(s/60);if(m<60)return m+'m '+s%60+'s';var h=Math.floor(m/60);return h+'h '+m%60+'m';}
  window.ccCopy=function(btn){var id=btn.parentElement.dataset.id;navigator.clipboard.writeText(id);btn.textContent='\u2713';setTimeout(function(){btn.textContent='\u2398';},1200);};
  // Shared fixed-position tooltip for elements inside scrollable containers
  var ccTip=document.getElementById('ccTooltip');
  document.addEventListener('mouseover',function(e){
    var el=e.target.closest('[data-tip],[data-tip-html]');
    if(!el){ccTip.classList.remove('show');return;}
    var html=el.dataset.tipHtml||esc(el.dataset.tip||'');
    if(!html){ccTip.classList.remove('show');return;}
    ccTip.innerHTML=html;
    ccTip.classList.add('show');
    var r=el.getBoundingClientRect();
    ccTip.style.left=r.left+'px';
    ccTip.style.top=(r.top-ccTip.offsetHeight-8)+'px';
    if(parseInt(ccTip.style.top)<0)ccTip.style.top=(r.bottom+8)+'px';
  });
  document.addEventListener('mouseout',function(e){
    var el=e.target.closest('[data-tip],[data-tip-html]');
    if(el&&!el.contains(e.relatedTarget))ccTip.classList.remove('show');
  });

  var allData=DATA;
  var charts={};
  var COLORS=['#6366f1','#06b6d4','#22c55e','#eab308','#f97316','#ef4444','#ec4899','#8b5cf6','#14b8a6','#84cc16'];

  // ── Theme ──
  function textColor(){return isDark()?'#94a3b8':'#64748b';}
  function gridColor(){return isDark()?'rgba(148,163,184,0.08)':'rgba(148,163,184,0.15)';}
  function tooltipBg(){return isDark()?'rgba(15,23,42,0.95)':'rgba(255,255,255,0.95)';}
  function tooltipBorder(){return isDark()?'#334155':'#e2e8f0';}
  function tooltipText(){return isDark()?'#e2e8f0':'#1e293b';}

  function baseTooltip(){
    return{trigger:'axis',confine:true,appendToBody:true,backgroundColor:tooltipBg(),borderColor:tooltipBorder(),textStyle:{color:tooltipText(),fontSize:12}};
  }
  function itemTooltip(){
    return{trigger:'item',confine:true,appendToBody:true,backgroundColor:tooltipBg(),borderColor:tooltipBorder(),textStyle:{color:tooltipText(),fontSize:12}};
  }

  // ── Chart Init ──
  function initChart(id,option){
    var dom=document.getElementById(id);
    if(!dom)return null;
    var c=echarts.init(dom,isDark()?'dark':null);
    // Enable ARIA for screen readers
    option.aria={enabled:true,decal:{show:false}};
    c.setOption(option);
    charts[id]=c;
    return c;
  }

  // ── Stats ──
  function updateStats(totals,sessionCount){
    document.getElementById('statCost').textContent=fmtCost(totals.cost.total_cost);
    document.getElementById('statTokens').textContent=fmt(totals.tokens.total_tokens);
    document.getElementById('statReqs').textContent=totals.request_count.toLocaleString();
    document.getElementById('statSessions').textContent=sessionCount.toLocaleString();
  }

  // ── Chart Option Builders ──
  function costOption(daily){
    var labels=daily.map(function(d){return d.date;});
    var costs=daily.map(function(d){return d.cost?d.cost.total_cost:d.cost_val||0;});
    var cum=cumul(costs);
    return{
      tooltip:Object.assign(baseTooltip(),{formatter:function(p){
        var h='<b>'+p[0].axisValueLabel+'</b><br>';
        p.forEach(function(i){h+='<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+i.color+';margin-right:6px"></span>'+i.seriesName+': <b>'+fmtCost(i.value)+'</b><br>';});
        return h;
      }}),
      grid:{left:'3%',right:'3%',top:35,bottom:15,containLabel:true},
      xAxis:{type:'category',data:labels,axisLabel:{color:textColor(),rotate:labels.length>7?45:0,hideOverlap:true},axisLine:{lineStyle:{color:gridColor()}}},
      yAxis:[
        {type:'value',name:'Daily ($)',nameTextStyle:{color:textColor(),padding:[0,0,0,40]},axisLabel:{formatter:function(v){return fmtCost(v);},color:textColor()},splitLine:{lineStyle:{color:gridColor()}}},
        {type:'value',name:'Cumulative ($)',nameTextStyle:{color:textColor(),padding:[0,40,0,0]},axisLabel:{formatter:function(v){return fmtCost(v);},color:textColor()},splitLine:{show:false}}
      ],
      series:[
        {name:'Daily Cost',type:'bar',data:costs,barMaxWidth:50,itemStyle:{color:'#6366f1',borderRadius:[4,4,0,0]},emphasis:{itemStyle:{color:'#818cf8'}}},
        {name:'Cumulative',type:'line',yAxisIndex:1,data:cum,smooth:true,symbol:costs.length<=2?'circle':'none',symbolSize:8,lineStyle:{color:'#06b6d4',type:'dashed',width:2},itemStyle:{color:'#06b6d4'}}
      ]
    };
  }

  function ioOption(daily){
    var labels=daily.map(function(d){return d.date;});
    return{
      tooltip:Object.assign(baseTooltip(),{formatter:function(p){
        var h='<b>'+p[0].axisValueLabel+'</b><br>';
        p.forEach(function(i){h+='<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+i.color+';margin-right:6px"></span>'+i.seriesName+': <b>'+fmt(i.value)+'</b><br>';});
        return h;
      }}),
      grid:{left:'3%',right:'3%',top:35,bottom:15,containLabel:true},
      xAxis:{type:'category',data:labels,axisLabel:{color:textColor(),rotate:labels.length>7?45:0,hideOverlap:true},axisLine:{lineStyle:{color:gridColor()}}},
      yAxis:{type:'value',name:'Tokens',nameTextStyle:{color:textColor(),padding:[0,0,0,30]},axisLabel:{formatter:function(v){return fmt(v);},color:textColor()},splitLine:{lineStyle:{color:gridColor()}}},
      series:[
        {name:'Input',type:'bar',stack:'io',data:daily.map(function(d){return d.tokens?d.tokens.input_tokens:d.input||0;}),barMaxWidth:50,itemStyle:{color:'#3b82f6'}},
        {name:'Output',type:'bar',stack:'io',data:daily.map(function(d){return d.tokens?d.tokens.output_tokens:d.output||0;}),barMaxWidth:50,itemStyle:{color:'#06b6d4'}}
      ]
    };
  }

  function cacheOption(daily){
    var labels=daily.map(function(d){return d.date;});
    return{
      tooltip:Object.assign(baseTooltip(),{formatter:function(p){
        var h='<b>'+p[0].axisValueLabel+'</b><br>';
        p.forEach(function(i){h+='<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+i.color+';margin-right:6px"></span>'+i.seriesName+': <b>'+fmt(i.value)+'</b><br>';});
        return h;
      }}),
      grid:{left:'3%',right:'3%',top:35,bottom:15,containLabel:true},
      xAxis:{type:'category',data:labels,axisLabel:{color:textColor(),rotate:labels.length>7?45:0,hideOverlap:true},axisLine:{lineStyle:{color:gridColor()}}},
      yAxis:{type:'value',name:'Cache Tokens',nameTextStyle:{color:textColor(),padding:[0,0,0,30]},axisLabel:{formatter:function(v){return fmt(v);},color:textColor()},splitLine:{lineStyle:{color:gridColor()}}},
      series:[
        {name:'Cache Write',type:'bar',stack:'cache',data:daily.map(function(d){return d.tokens?d.tokens.cache_write_tokens:d.cw||0;}),barMaxWidth:50,itemStyle:{color:'#eab308'}},
        {name:'Cache Read',type:'bar',stack:'cache',data:daily.map(function(d){return d.tokens?d.tokens.cache_read_tokens:d.cr||0;}),barMaxWidth:50,itemStyle:{color:'#22c55e'}}
      ]
    };
  }

  function projectOption(projects){
    var sorted=projects.slice().sort(function(a,b){return a.cost.total_cost-b.cost.total_cost;});
    var maxLabelLen=Math.max.apply(null,sorted.map(function(p){return p.project.length;}));
    return{
      tooltip:Object.assign(itemTooltip(),{formatter:function(p){return'<b>'+esc(p.name)+'</b><br>Cost: <b>'+fmtCost(p.value)+'</b>';}}),
      grid:{left:'3%',right:'8%',top:20,bottom:20,containLabel:true},
      xAxis:{type:'value',axisLabel:{formatter:function(v){return fmtCost(v);},color:textColor()},splitLine:{lineStyle:{color:gridColor()}}},
      yAxis:{type:'category',data:sorted.map(function(p){return p.project;}),axisLabel:{color:textColor(),width:150,overflow:'truncate'},axisLine:{lineStyle:{color:gridColor()}}},
      series:[{type:'bar',data:sorted.map(function(p,i){return{value:p.cost.total_cost,itemStyle:{color:COLORS[i%COLORS.length],borderRadius:[0,4,4,0]}};}),barMaxWidth:28,
        label:{show:true,position:'right',formatter:function(p){return fmtCost(p.value);},color:textColor(),fontSize:11},
        emphasis:{itemStyle:{shadowBlur:4}}}]
    };
  }

  function modelOption(models){
    var entries=Object.entries(models).sort(function(a,b){return b[1].cost.total_cost-a[1].cost.total_cost;});
    return{
      tooltip:Object.assign(itemTooltip(),{formatter:function(p){return'<b>'+esc(p.name)+'</b><br>'+fmtCost(p.value)+' ('+p.percent.toFixed(1)+'%)';}}),
      legend:{orient:'horizontal',bottom:0,textStyle:{color:textColor(),fontSize:11},itemWidth:12,itemHeight:12},
      series:[{type:'pie',radius:['40%','70%'],center:['50%','45%'],
        label:{show:true,formatter:function(p){return p.percent.toFixed(1)+'%';},color:textColor(),fontSize:11},
        labelLine:{show:true,lineStyle:{color:textColor()}},
        emphasis:{label:{show:true,fontSize:14,fontWeight:'bold'}},
        data:entries.map(function(e,i){return{name:e[0],value:e[1].cost.total_cost,itemStyle:{color:COLORS[i%COLORS.length]}};})}]
    };
  }

  function cacheEffOption(daily){
    var labels=daily.map(function(d){return d.date;});
    var data=daily.map(function(d){
      var cr=d.tokens?d.tokens.cache_read_tokens:(d.cr||0);
      var cw=d.tokens?d.tokens.cache_write_tokens:(d.cw||0);
      var denom=cr+cw;return denom>0?(cr/denom)*100:0;
    });
    return{
      tooltip:Object.assign(baseTooltip(),{formatter:function(p){return'<b>'+p[0].axisValueLabel+'</b><br>Cache Reuse: <b>'+p[0].value.toFixed(1)+'%</b>';}}),
      grid:{left:'3%',right:'3%',top:20,bottom:15,containLabel:true},
      xAxis:{type:'category',data:labels,axisLabel:{color:textColor(),rotate:labels.length>7?45:0,hideOverlap:true},axisLine:{lineStyle:{color:gridColor()}}},
      yAxis:{type:'value',min:0,max:100,axisLabel:{formatter:function(v){return v+'%';},color:textColor()},splitLine:{lineStyle:{color:gridColor()}}},
      series:[{type:'line',data:data,smooth:true,symbol:data.length<=2?'circle':'none',symbolSize:8,areaStyle:{color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'rgba(34,197,94,0.3)'},{offset:1,color:'rgba(34,197,94,0.02)'}]}},lineStyle:{color:'#22c55e',width:2},itemStyle:{color:'#22c55e'}}]
    };
  }

  function roiOption(totalCost,days){
    var monthly=days>0?(totalCost/days)*30:0;
    return{
      tooltip:Object.assign(baseTooltip(),{trigger:'axis'}),
      grid:{left:'3%',right:'3%',top:25,bottom:15,containLabel:true},
      xAxis:{type:'category',data:['Projected\\nMonthly','Pro\\n$20/mo','Max 5x\\n$100/mo','Max 20x\\n$200/mo'],axisLabel:{color:textColor(),interval:0,rotate:0},axisLine:{lineStyle:{color:gridColor()}}},
      yAxis:{type:'value',axisLabel:{formatter:function(v){return fmtCost(v);},color:textColor()},splitLine:{lineStyle:{color:gridColor()}}},
      series:[{type:'bar',barMaxWidth:60,data:[
        {value:monthly,itemStyle:{color:'#6366f1'}},
        {value:20,itemStyle:{color:'#22c55e'}},
        {value:100,itemStyle:{color:'#eab308'}},
        {value:200,itemStyle:{color:'#ef4444'}}
      ],label:{show:true,position:'top',formatter:function(p){return fmtCost(p.value);},color:textColor(),fontSize:11}}]
    };
  }

  // ── Heatmap ──
  function renderHeatmap(hm){
    var el=document.getElementById('heatmap');el.innerHTML='';
    var days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var maxVal=Math.max(1,Math.max.apply(null,hm.map(function(r){return Math.max.apply(null,r);})));
    var levels=['var(--hm0)','var(--hm1)','var(--hm2)','var(--hm3)','var(--hm4)','var(--hm5)'];
    function cellBg(v){if(v===0)return levels[0];var p=v/maxVal;if(p<0.15)return levels[1];if(p<0.35)return levels[2];if(p<0.55)return levels[3];if(p<0.75)return levels[4];return levels[5];}
    // Header
    var corner=document.createElement('div');el.appendChild(corner);
    for(var h=0;h<24;h++){var hd=document.createElement('div');hd.className='hm-label';hd.style.justifyContent='center';hd.textContent=h;el.appendChild(hd);}
    for(var d=0;d<7;d++){
      var lbl=document.createElement('div');lbl.className='hm-label';lbl.textContent=days[d];el.appendChild(lbl);
      for(var h2=0;h2<24;h2++){
        var cell=document.createElement('div');cell.className='hm-cell';cell.style.background=cellBg(hm[d][h2]);
        var tip=document.createElement('div');tip.className='hm-tip';tip.textContent=days[d]+' '+h2+':00 — '+fmt(hm[d][h2])+' tokens';
        cell.appendChild(tip);el.appendChild(cell);
      }
    }
  }

  // ── Session Table ──
  var sortCol='cost',sortDir=-1;
  function renderSessions(sessions){
    var tbody=document.getElementById('sessBody');tbody.innerHTML='';
    var showing=Math.min(sessions.length,100);
    document.getElementById('sessCount').textContent='(showing '+showing+' of '+sessions.length+')';
    var sorted=sessions.slice().sort(function(a,b){
      var va,vb;
      switch(sortCol){
        case'session':va=a.sessionId;vb=b.sessionId;break;
        case'project':va=a.project;vb=b.project;break;
        case'model':va=a.primaryModel;vb=b.primaryModel;break;
        case'duration':va=new Date(a.endTime)-new Date(a.startTime);vb=new Date(b.endTime)-new Date(b.startTime);break;
        case'requests':va=a.request_count;vb=b.request_count;break;
        case'tokens':va=a.tokens.total_tokens;vb=b.tokens.total_tokens;break;
        case'cost':va=a.cost.total_cost;vb=b.cost.total_cost;break;
        default:va=0;vb=0;
      }
      if(typeof va==='string')return sortDir*va.localeCompare(vb);return sortDir*(va-vb);
    }).slice(0,100);
    if(sorted.length===0){
      tbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--muted);font-size:.85rem">No sessions match the current filters</td></tr>';
      return;
    }
    sorted.forEach(function(s){
      var tr=document.createElement('tr');
      // Session ID: 8-char prefix + copy button (tooltip via JS)
      var sessCell='<td class="text-mono"><span class="sess-id" data-id="'+esc(s.sessionId)+'" data-tip="'+esc(s.sessionId)+'">'
        +esc(s.sessionId.slice(0,8))
        +'<button class="copy-btn" onclick="ccCopy(this)">&#x2398;</button>'
        +'</span></td>';
      // Model: rich tooltip with per-model breakdown
      var modelEntries=Object.entries(s.models||{}).sort(function(a,b){return b[1].cost.total_cost-a[1].cost.total_cost;});
      var modelCell;
      if(modelEntries.length<=1){
        modelCell='<td class="text-mono">'+esc(s.primaryModel)+'</td>';
      } else {
        var totalModelCost=modelEntries.reduce(function(sum,m){return sum+m[1].cost.total_cost;},0);
        var tipHtml='<div style="font-weight:600;margin-bottom:6px;font-size:.7rem;color:var(--muted)">MODEL BREAKDOWN</div>'
          +modelEntries.map(function(m){
            var pct=totalModelCost>0?((m[1].cost.total_cost/totalModelCost)*100).toFixed(0):'0';
            return '<div style="display:flex;justify-content:space-between;gap:16px;padding:2px 0">'
              +'<span>'+esc(m[0])+'</span>'
              +'<span>'+fmt(m[1].tokens.total_tokens)+' tok</span>'
              +'<span style="font-weight:600">'+fmtCost(m[1].cost.total_cost)+' ('+pct+'%)</span></div>';
          }).join('');
        modelCell='<td class="text-mono"><span class="model-cell" data-tip-html="'+tipHtml.replace(/"/g,'&quot;')+'">'
          +esc(s.primaryModel)+'<span class="model-badge">+'+(modelEntries.length-1)+'</span>'
          +'</span></td>';
      }
      tr.innerHTML=sessCell
        +'<td>'+esc(s.project)+'</td>'
        +modelCell
        +'<td class="text-right text-mono">'+duration(s.startTime,s.endTime)+'</td>'
        +'<td class="text-right text-mono">'+s.request_count+'</td>'
        +'<td class="text-right text-mono">'+fmt(s.tokens.total_tokens)+'</td>'
        +'<td class="text-right text-mono" style="font-weight:600">'+fmtCost(s.cost.total_cost)+'</td>';
      tbody.appendChild(tr);
    });
  }

  // ── ROI ──
  function renderROI(totals,days){
    var tc=totals.cost.total_cost;var avgD=days>0?tc/days:0;var projM=avgD*30;
    var cpr=totals.request_count>0?tc/totals.request_count:0;
    var cp1k=totals.tokens.total_tokens>0?(tc/totals.tokens.total_tokens)*1000:0;
    var cacheSave=totals.cost.cache_read_cost*9;
    var cards=[
      {label:'Avg Daily Cost',value:fmtCost(avgD),sub:'Projected monthly: '+fmtCost(projM),cls:'green'},
      {label:'Cost Per Request',value:fmtCost(cpr),sub:totals.request_count.toLocaleString()+' total requests',cls:''},
      {label:'Cache Savings',value:'~'+fmtCost(cacheSave),sub:((totals.tokens.cache_read_tokens/(totals.tokens.cache_read_tokens+totals.tokens.input_tokens||1))*100).toFixed(1)+'% cache hit',cls:'green'},
      {label:'Cost Per 1K Tokens',value:fmtCost(cp1k),sub:fmt(totals.tokens.total_tokens)+' total tokens',cls:''}
    ];
    var el=document.getElementById('roiCards');el.innerHTML='';
    cards.forEach(function(c){
      var card=document.createElement('div');card.className='roi-card';
      var lbl=document.createElement('div');lbl.className='roi-label';lbl.textContent=c.label;
      var val=document.createElement('div');val.className='roi-value'+(c.cls?' '+c.cls:'');val.textContent=c.value;
      var sub=document.createElement('div');sub.className='roi-sub';sub.textContent=c.sub;
      card.appendChild(lbl);card.appendChild(val);card.appendChild(sub);el.appendChild(card);
    });
    if(charts['chartROI'])charts['chartROI'].setOption(roiOption(tc,days),{notMerge:true});
  }

  // ── Initialize Everything ──
  updateStats(allData.totals,allData.sessions.length);
  initChart('chartCost',costOption(allData.daily));
  initChart('chartIO',ioOption(allData.daily));
  initChart('chartCache',cacheOption(allData.daily));
  initChart('chartProject',projectOption(allData.projects));
  initChart('chartModel',modelOption(allData.models));
  initChart('chartCacheEff',cacheEffOption(allData.daily));
  initChart('chartROI',roiOption(allData.totals.cost.total_cost,allData.daily.length));
  renderHeatmap(allData.heatmap);
  // Show timezone in heatmap description
  try{var tz=Intl.DateTimeFormat().resolvedOptions().timeZone;document.getElementById('heatmapDesc').textContent+=' Hours shown in UTC (your timezone: '+tz+').'}catch(e){}
  renderSessions(allData.sessions);
  renderROI(allData.totals,allData.daily.length);

  // Pricing version indicator
  var pvEl=document.getElementById('pricingVer');
  if(pvEl&&allData.pricing_version)pvEl.textContent=allData.pricing_version;
  var tipEl=document.getElementById('pricingTip');
  if(tipEl){
    var modelNames=Object.keys(allData.models);
    tipEl.innerHTML='<div style="font-weight:600;margin-bottom:6px">Models used in this report</div>'
      +modelNames.sort().map(function(m){
        var md=allData.models[m];
        return '<div style="display:flex;justify-content:space-between;gap:16px;padding:1px 0"><span>'+esc(m)+'</span><span style="font-weight:600">'+fmtCost(md.cost.total_cost)+'</span></div>';
      }).join('');
  }

  // Sort headers with visual indicators
  document.querySelectorAll('#sessTable th').forEach(function(th){
    th.addEventListener('click',function(){
      var col=th.dataset.col;if(!col)return;
      sortDir=sortCol===col?sortDir*-1:-1;sortCol=col;
      document.querySelectorAll('#sessTable th').forEach(function(t){t.classList.remove('sorted-asc','sorted-desc');});
      th.classList.add(sortDir===1?'sorted-asc':'sorted-desc');
      renderSessions(currentSessions);
    });
  });

  // ── Filtering ──
  var currentSessions=allData.sessions;
  function applyFilters(){
    var s=document.getElementById('dateStart').value;
    var e=document.getElementById('dateEnd').value;
    var p=document.getElementById('projectFilter').value;

    // Filter daily by date
    var fDaily=allData.daily.filter(function(d){
      if(s&&d.date<s)return false;if(e&&d.date>e)return false;return true;
    });

    // Filter sessions
    var fSessions=allData.sessions.filter(function(ss){
      if(p&&ss.project!==p)return false;
      var d=ss.startTime.slice(0,10);if(s&&d<s)return false;if(e&&d>e)return false;return true;
    });
    currentSessions=fSessions;

    // Build chart daily data: use per-project breakdown if project filter active
    var chartDaily;
    if(p){
      chartDaily=fDaily.filter(function(d){return d.projects&&d.projects[p];}).map(function(d){var pp=d.projects[p];return{date:d.date,cost:pp.cost,tokens:pp.tokens,request_count:pp.request_count};});
    } else {
      chartDaily=fDaily;
    }

    // Compute totals
    var totals={tokens:{input_tokens:0,output_tokens:0,cache_write_tokens:0,cache_read_tokens:0,total_tokens:0},cost:{input_cost:0,output_cost:0,cache_write_cost:0,cache_read_cost:0,total_cost:0},request_count:0};
    chartDaily.forEach(function(d){
      var t=d.tokens,c=d.cost;
      totals.tokens.input_tokens+=t.input_tokens;totals.tokens.output_tokens+=t.output_tokens;
      totals.tokens.cache_write_tokens+=t.cache_write_tokens;totals.tokens.cache_read_tokens+=t.cache_read_tokens;
      totals.tokens.total_tokens+=t.total_tokens;
      totals.cost.input_cost+=c.input_cost||0;totals.cost.output_cost+=c.output_cost||0;
      totals.cost.cache_write_cost+=c.cache_write_cost||0;totals.cost.cache_read_cost+=c.cache_read_cost||0;
      totals.cost.total_cost+=c.total_cost;totals.request_count+=(d.request_count||0);
    });

    updateStats(totals,fSessions.length);

    // Update all charts via setOption (no destroy!)
    charts['chartCost'].setOption(costOption(chartDaily),{notMerge:true});
    charts['chartIO'].setOption(ioOption(chartDaily),{notMerge:true});
    charts['chartCache'].setOption(cacheOption(chartDaily),{notMerge:true});
    charts['chartCacheEff'].setOption(cacheEffOption(chartDaily),{notMerge:true});

    // Model: always aggregate from filtered sessions so date+project filters both apply
    var fm={};fSessions.forEach(function(ss){if(ss.models)Object.entries(ss.models).forEach(function(en){if(!fm[en[0]])fm[en[0]]={cost:{total_cost:0}};fm[en[0]].cost.total_cost+=en[1].cost.total_cost;});});
    charts['chartModel'].setOption(modelOption(fm),{notMerge:true});

    // Project: hide when single project selected, show otherwise
    var projPanel=document.getElementById('projectPanel');
    if(p){
      projPanel.style.display='none';
    } else {
      projPanel.style.display='';
      var fp=allData.projects.filter(function(pp){if(s||e){var hasDays=fDaily.some(function(d){return d.projects&&d.projects[pp.project];});return hasDays;}return true;});
      charts['chartProject'].setOption(projectOption(fp),{notMerge:true});
    }

    // Heatmap: rebuild from filtered sessions so date+project filters both apply
    var hasFilter=s||e||p;
    if(hasFilter){
      var hm=[];for(var di=0;di<7;di++){hm[di]=[];for(var hi=0;hi<24;hi++)hm[di][hi]=0;}
      fSessions.forEach(function(ss){
        var dt=new Date(ss.startTime);var day=dt.getDay();var hr=dt.getHours();
        hm[day][hr]+=(ss.tokens?ss.tokens.total_tokens:0);
      });
      renderHeatmap(hm);
    } else {
      renderHeatmap(allData.heatmap);
    }

    renderSessions(fSessions);
    renderROI(totals,chartDaily.length);
  }

  document.getElementById('btnApply').addEventListener('click',applyFilters);
  document.getElementById('dateStart').addEventListener('change',applyFilters);
  document.getElementById('dateEnd').addEventListener('change',applyFilters);
  document.getElementById('projectFilter').addEventListener('change',applyFilters);
  document.getElementById('btnReset').addEventListener('click',function(){
    document.getElementById('dateStart').value='${esc(dateStart)}';
    document.getElementById('dateEnd').value='${esc(dateEnd)}';
    document.getElementById('projectFilter').value='';
    applyFilters();
  });

  // ── Theme Toggle ──
  document.getElementById('themeToggle').addEventListener('click',function(){
    document.documentElement.classList.toggle('light');
    this.textContent=isDark()?'☀':'🌙';
    // Rebuild all charts from scratch with correct theme (getOption carries stale colors)
    Object.keys(charts).forEach(function(id){
      charts[id].dispose();
      charts[id]=echarts.init(document.getElementById(id),isDark()?'dark':null);
    });
    // Re-trigger current filter state to rebuild all chart options with fresh colors
    applyFilters();
  });

  // ── Resize ──
  // Debounced resize — wait for CSS reflow before telling ECharts to recalculate
  var resizeTimer;
  window.addEventListener('resize',function(){
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(function(){Object.values(charts).forEach(function(c){c.resize();});},150);
  });
  // Also observe container size changes (covers DevTools responsive mode)
  if(window.ResizeObserver){
    new ResizeObserver(function(){
      clearTimeout(resizeTimer);
      resizeTimer=setTimeout(function(){Object.values(charts).forEach(function(c){c.resize();});},150);
    }).observe(document.body);
  }

  // Convert charts to static images before printing so they don't go blank
  window.addEventListener('beforeprint',function(){
    Object.keys(charts).forEach(function(id){
      var c=charts[id];if(!c)return;
      var url=c.getDataURL({type:'png',pixelRatio:2,backgroundColor:isDark()?'#1e293b':'#ffffff'});
      var dom=document.getElementById(id);if(!dom)return;
      var img=document.createElement('img');img.src=url;img.className='chart-print-img';img.style.width='100%';
      dom.style.display='none';dom.parentNode.insertBefore(img,dom);
    });
  });
  window.addEventListener('afterprint',function(){
    document.querySelectorAll('.chart-print-img').forEach(function(img){
      var dom=img.nextElementSibling;if(dom)dom.style.display='';
      img.remove();
    });
  });
})();
<\/script>
</body>
</html>`;
}

function openInBrowser(filePath: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  import('node:child_process').then(({ execFile }) => {
    execFile(cmd, [filePath], () => {});
  });
}

export async function dashboardAction(opts: {
  save?: string;
  json?: boolean;
  since?: string;
  until?: string;
  project?: string;
  mode?: string;
  timezone?: string;
}): Promise<void> {
  const { entries: unique } = await loadData({ since: opts.since, until: opts.until });
  const filtered = filterEntries(unique, {
    since: opts.since,
    until: opts.until,
    project: opts.project,
    timezone: opts.timezone,
  });

  if (filtered.length === 0) {
    console.log(chalk.yellow('No data found.'));
    return;
  }

  const mode = parseCostMode(opts.mode);
  const data = buildDashboardData(filtered, mode, opts.timezone);

  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const html = generateHtml(data);

  if (opts.save) {
    const { resolve, normalize } = await import('node:path');
    const { realpathSync } = await import('node:fs');
    const savePath = resolve(opts.save);
    const home = homedir();
    const cwd = process.cwd();
    // Prevent writes to root or system directories
    if (cwd === '/' || savePath === '/') {
      console.log(chalk.red('Refusing to write to root directory.'));
      return;
    }
    // Resolve symlinks to catch symlink escapes
    let realSavePath = savePath;
    try {
      const parentDir = dirname(savePath);
      if (existsSync(parentDir)) realSavePath = resolve(realpathSync(parentDir), savePath.split('/').pop()!);
    } catch {}
    if (!realSavePath.startsWith(home) && !realSavePath.startsWith(cwd) && !realSavePath.startsWith('/tmp') && !realSavePath.startsWith('/private/tmp')) {
      console.log(chalk.red(`Refusing to write outside home directory, cwd, or /tmp: ${realSavePath}`));
      return;
    }
    mkdirSync(dirname(savePath), { recursive: true });
    writeFileSync(savePath, html, 'utf-8');
    console.log(chalk.green(`Dashboard saved to: ${savePath}`));
    return;
  }

  const defaultDir = join(homedir(), '.cctrack');
  const defaultPath = join(defaultDir, 'dashboard.html');
  mkdirSync(defaultDir, { recursive: true });
  writeFileSync(defaultPath, html, 'utf-8');
  console.log(chalk.green(`Dashboard saved to: ${defaultPath}`));
  openInBrowser(defaultPath);
}

export function registerDashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .description('Generate and open interactive HTML dashboard')
    .option('--save <path>', 'Save to custom path (does not auto-open)')
    .option('--json', 'Output dashboard data as JSON instead of HTML')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)')
    .option('--project <name>', 'Filter by project name')
    .option('--mode <mode>', 'Cost mode: calculate, display, compare', 'calculate')
    .option('--timezone <tz>', 'Timezone for date grouping')
    .action(dashboardAction);
}
