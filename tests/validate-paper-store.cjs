const fs=require("node:fs");
const vm=require("node:vm");
const assert=require("node:assert/strict");
const src=fs.readFileSync("paper-store.js","utf8");
const made=new Map();
class FakeElement{
 constructor(tag="div"){
   this.tagName=tag.toUpperCase();this.value="";this.checked=false;this.hidden=false;
   this.disabled=false;this.textContent="";this.className="";this.children=[];this.listeners={};
   this.classList={toggle(){}};
 }
 addEventListener(k,cb){this.listeners[k]=cb}
 append(...children){this.children.push(...children)}
 replaceChildren(...children){this.children=[...children]}
 setAttribute(k,v){this[k]=v}
 removeAttribute(k){delete this[k]}
 showModal(){this.open=true}
 close(){this.open=false}
 click(){this.listeners.click?.({target:this})}
 focus(){}
}
const $=id=>{if(!made.has(id))made.set(id,new FakeElement());return made.get(id)};
const doc={getElementById:$,createElement:t=>new FakeElement(t),head:new FakeElement("head")};
const saved=[];
const example={
 production_date:"2026-11-14",plant:"Seef Arad / Meat",staff_name:"Tester",
 paper_reference:"Test-01",issue_weight_grams:10000,minced_weight_grams:7000,
 boneless_weight_grams:2500,wastage_weight_grams:500,
 finished_value_fils:42750,label_count:3,
 label_details:[
 {barcode:"9667770031903",product_code:"6777",weight_grams:1000,price_fils:3190,source:"bone",sheet_id:"a"},
 {barcode:"9667807018006",product_code:"6780",weight_grams:400,price_fils:1800,source:"bone",sheet_id:"a"},
 {barcode:"9667818036457",product_code:"6781",weight_grams:810,price_fils:3645,source:"normal",sheet_id:"b"}
 ]};
const account={id:"00000000-0000-4000-8000-000000000001",email:"staff@example.com"};
let lastInsert=null;
let lastQuery=null;
const db={
 auth:{
   getSession:async()=>({data:{session:{user:account}},error:null}),
   onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
   signInWithPassword:async()=>({data:{user:account},error:null}),
   signOut:async()=>({error:null})
 },
 from(name){
   assert.equal(name,"meat_production_papers");
   return {
     insert(payload){
       lastInsert=payload;
       return {select(){return {single:async()=>({data:{id:"paper-1",production_date:payload.production_date},error:null})}}}
     },
     select(){
       const query={
         eq(key,val){lastQuery={...lastQuery,[key]:val};return this},
         order(){return this},
         limit(){return Promise.resolve({data:saved,error:null})}
       };
       return query;
     }
   }
 }
};
$("saveBtn").disabled=false;
$("date").value="2026-11-14";
const windowMock={supabase:{createClient:()=>db},MeatProductionApp:{paperSnapshot:()=>structuredClone(example)}};
const sandbox={window:windowMock,document:doc,console,Promise,Date,Number,Error,String};
vm.runInNewContext(src,sandbox,{timeout:3000,filename:"paper-store.js"});
const api=windowMock.MeatPaperStoreChecks;
assert.equal(api.kg(13650),"13.650");
assert.equal(api.bd(42750),"42.750");
assert.equal(api.formatDate("2026-11-14"),"14/11/2026");
assert.equal(api.paperFilename(example),"Meat-Production-2026-11-14.pdf");
assert.equal(api.assertValid(example).issue_weight_grams,10000);
assert.throws(()=>api.assertValid({...example,issue_weight_grams:9500}),/does not match/);
assert.throws(()=>api.assertValid({...example,label_count:4}),/label count/);
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
(async()=>{
 await flush();
 $("saveBtn").click();
 assert.equal($("savePaperDialog").open,true);
 assert.match($("savePaperSummary").textContent,/14\/11\/2026/);
 assert.equal($("saveToDatabase").disabled,false);
 await $("saveToDatabase").listeners.click();
 assert.ok(lastInsert,"Save must write a database record");
 assert.equal(lastInsert.owner_id,account.id);
 assert.equal(lastInsert.production_date,"2026-11-14");
 assert.equal(lastInsert.finished_value_fils,42750);
 assert.equal(lastInsert.minced_weight_grams,7000);
 assert.equal(lastInsert.wastage_weight_grams,500);
 assert.ok(Array.isArray(lastInsert.label_details));
 assert.equal(lastInsert.label_details.length,3);
 assert.equal($("savePaperStatus").textContent.includes("Saved successfully"),true);
 $("printBtn").click();
 assert.equal($("paperPreviewDialog").open,true);
 assert.ok($("paperPreviewContent").children.length>0);
 assert.equal($("previewSave").hidden,false);
 assert.equal(lastQuery.owner_id,account.id);
 console.log("Paper store integration passed: private save, date, totals, preview and session gating.");
})().catch(err=>{console.error(err);process.exitCode=1});
