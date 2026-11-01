import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
await import('../public/report-story.js');
await import('../public/monitoring-core.js');
const C=globalThis.MonitoringCore;
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../server/monitoring-validation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const validate=exports.validMonitoring;
const capture={hairState:'dry',styling:'matched',lighting:'matched',position:'matched',distance:'matched'};
const session=(id,date,value,sample=false)=>({id,date,sample,status:'Report ready',answers:{},notes:'',capture,photos:[{id:id+'-p',view:'Crown'}],analysis:{observations:[{photoId:id+'-p',view:'Crown',width:1024,height:1024,hairAreaPercent:value,quality:{brightness:100,sharpness:120,warnings:[]}}]}});
const state={profile:{name:'Test'},sessions:[session('latest','2026-10-20',45),session('sample','2026-09-01',99,true),session('base','2026-10-01',40),session('middle','2026-10-10',42)]};
test('collections never mix and chronology resolves baseline/previous/latest',()=>{const d=C.build(state);assert.equal(d.baseline.id,'base');assert.equal(d.latest.id,'latest');assert.equal(d.previous.id,'middle');assert.equal(d.photoCount,3);assert.equal(C.build(state,{scope:'sample'}).photoCount,1);});
test('regional measures have photo-ID provenance and missing Top stays missing',()=>{const d=C.build(state),f=d.findings.find(f=>f.view==='Crown');assert.equal(f.comparison.delta,5);assert.match(f.change,/not growth or loss/);assert.equal(f.comparison.level,'Moderate');assert.equal(d.findings.find(f=>f.view==='Top').latestValue,null);assert.equal(f.trace.length,2);});
test('poor lighting blocks delta; missing metadata lowers evidence confidence',()=>{const s=structuredClone(state);s.sessions[0].analysis.observations[0].quality.brightness=30;assert.equal(C.build(s).findings[4].comparison.delta,null);s.sessions[0].analysis.observations[0].quality.brightness=100;delete s.sessions[0].capture;assert.equal(C.build(s).findings[4].comparison.level,'Low');});
test('selected earlier assessment never pairs against a future reference',()=>{const d=C.build(state,{latestId:'middle',baseId:'latest'});assert.equal(d.baseline.id,'base');assert.equal(d.latest.id,'middle');assert.equal(d.findings[4].comparison.delta,2);});
test('baseline-only, no-analysis, and empty workspace do not invent values',()=>{const s={profile:{},sessions:[session('a','2026-01-01',0)]};assert.equal(C.build(s).findings[4].comparison.delta,null);delete s.sessions[0].analysis;assert.equal(C.build(s).measured,0);assert.equal(C.build({sessions:[]}).latest,null);assert.equal(C.build({sessions:[]}).adherence.percent,null);});
test('invalid measurements and unmatched observation IDs are excluded',()=>{const s=structuredClone(state);s.sessions[0].analysis.observations[0].hairAreaPercent=NaN;s.sessions[2].analysis.observations[0].photoId='unrelated';assert.equal(C.build(s).measured,1);});
test('repeated source files never imply independent follow-up evidence',()=>{const s=structuredClone(state);s.sessions[0].analysis.observations[0].sourceHash='same';s.sessions[2].analysis.observations[0].sourceHash='same';const f=C.build(s).findings[4];assert.equal(f.comparison.delta,null);assert.equal(f.comparison.level,'Repeated source');assert.match(f.change,/no independent follow-up/);});
test('adherence uses logged applications only, excludes sample logs',()=>{const s=structuredClone(state);s.monitoring={real:{logs:[{planned:2,completed:1}],routines:[],reviews:[]},sample:{logs:[{planned:10,completed:10}]}};const d=C.build(s);assert.equal(d.adherence.percent,50);assert.equal(d.adherence.missed,1);assert.match(d.adherence.definition,/Unlogged days are unknown/);});
test('routine and log validation rejects impossible dates and counts',()=>{assert.equal(C.validDate('2026-02-30'),false);assert.throws(()=>C.validateRoutine({name:'X',type:'Other',startDate:'2027-01-01',frequency:'daily'},'2026-10-31'));assert.throws(()=>C.validateLog({routineId:'r',date:'2026-10-20',planned:1,completed:2},'2026-10-31',[{id:'r',startDate:'2026-10-01'}]));});
test('server accepts legacy state and validates routine references, duplicate logs and spoofed review status',()=>{const r={id:'r',name:'Test',type:'Haircare',startDate:'2026-10-01',frequency:'daily',notes:'',createdAt:'2026-10-31T12:00:00Z'},l={id:'l',routineId:'r',date:'2026-10-02',planned:2,completed:1,experience:'',sideEffects:'',createdAt:r.createdAt};const m={real:{routines:[r],logs:[l],reviews:[]}};assert.equal(validate(undefined),true);assert.equal(validate(m),true);m.real.logs.push({...l,id:'l2'});assert.equal(validate(m),false);m.real.logs=[{...l,routineId:'other'}];assert.equal(validate(m),false);m.real.logs=[];m.real.reviews=[{id:'x',sessionId:'latest',questions:'Review',consultation:null,createdAt:r.createdAt,status:'doctor_reviewed'}];assert.equal(validate(m),false);});


test('positive story is gated to completed built-in sample journey, never uploads or earlier dates',()=>{
 const samples={sessions:[0,1,2,3].map(i=>session('sample-'+i,'2026-10-0'+(i+1),40+i,true))};
 const d=C.build(samples,{scope:'sample'});assert.equal(d.growthStory.kind,'scripted_simulation');assert.equal(d.growthStory.weeks.length,4);assert.match(d.growthStory.title,/simulated/);assert.match(d.growthStory.summary,/authored/);
 assert.equal(C.build(samples,{scope:'sample',latestId:'sample-1'}).growthStory,null);
 assert.equal(C.build(samples,{scope:'sample',baseId:'sample-2'}).growthStory,null);
 assert.equal(C.build({...samples,sessions:samples.sessions.map(s=>({...s,sample:false}))}).growthStory,null);
 delete samples.sessions[1].analysis;assert.equal(C.build(samples,{scope:'sample'}).growthStory,null);
});
test('real assessment explains changes and repeated sources without asserting growth',()=>{
 const d=C.build(state);assert.equal(d.assessment.regions[4].status,'Image change detected');assert.match(d.assessment.summary,/not confirmed new growth/);assert.equal(d.growthStory,null);
 const repeated=structuredClone(state);repeated.sessions[0].analysis.observations[0].sourceHash='same';repeated.sessions[2].analysis.observations[0].sourceHash='same';assert.equal(C.build(repeated).assessment.regions[4].status,'Reused photograph');
 assert.match(C.build({sessions:[]}).assessment.title,/Start with/);
});
test('story HTML escapes record values and disabled simulations stay absent',()=>{
 assert.equal(ProgressStory.simulation({dates:['2026-01-01']}),null);
 const s=ProgressStory.simulation({enabled:true,dates:['<script>'],quality:['<img onerror=x>']});const html=ProgressStory.simulationHTML(s);assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;img'));assert.match(html,/SCRIPTED NARRATIVE/);
});
