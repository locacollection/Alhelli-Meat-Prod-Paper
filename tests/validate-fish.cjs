const fs=require("node:fs");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const core=require("../fish-core.js");
const fishPage=fs.readFileSync("fish-production.html","utf8");
const main=fs.readFileSync("index.html","utf8");
const workflow=fs.readFileSync(".github/workflows/deploy-pages.yml","utf8");
for(const file of ["fish-production.html","fish-production.css","fish-core.js","fish-production.js","fish-store.js"]){
  assert.ok(workflow.includes(file),"Missing deploy file "+file);
}
assert.ok(main.includes('href="./fish-production.html"'));
assert.ok(fishPage.includes('src="fish-core.js?v=fish-1"'));
assert.ok(fishPage.includes('src="barcode-learning-core.js?v=learning-1"'));
assert.ok(fishPage.includes('src="fish-barcode-samples.js?v=fish-samples-1"'));
assert.ok(fishPage.includes('src="fish-production.js?v=fish-samples-3"'));
assert.ok(fishPage.includes('src="fish-store.js?v=fish-samples-3"'));
assert.ok(!fishPage.includes("Print production paper"));
const required=["fishPhotos","fishCameraPhoto","fishLiveStart","fishAddManual",
"fishEditForm","fishCode","fishWeight","fishBarcode","fishUnitPrice","fishTotalPrice",
"fishIssue","fishFillet","fishBone","fishWaste","fishPaperError",
"fishPreview","fishSave","fishSavedNo"];
for(const id of required.filter(x=>x!=="fishSavedNo"))
  assert.ok(fishPage.includes('id="'+id+'"'),"Missing interface element "+id);
const row=(product_code,weight_grams,extra={})=>({
  product_code,weight_grams,confirmed:true,
  unit_price_fils:null,total_price_fils:null,barcode:"",...extra
});
const sample=[
  row("6376",3436),
  row("6668",2442,{total_price_fils:12000}),
  row("7144",968,{total_price_fils:1200})
];
let totals=core.calculate(sample);
assert.equal(totals.ok,true);
assert.equal(totals.issue,3436);
assert.equal(totals.fillet,2442);
assert.equal(totals.bone,968);
assert.equal(totals.wastage,26);
assert.equal(core.fmtKg(totals.wastage),"0.026");
assert.equal(totals.value_fils,13200);
assert.equal(totals.unpriced_outputs,0);
const snap=core.snapshot(sample,{production_date:"2026-11-15",
  plant:"Seef Arad / Fish",staff_name:"Team",paper_reference:"SALMON-01"});
assert.equal(snap.production_date,"2026-11-15");
assert.equal(snap.issue_weight_grams,3436);
assert.equal(snap.fillet_weight_grams,2442);
assert.equal(snap.bone_weight_grams,968);
assert.equal(snap.wastage_weight_grams,26);
assert.equal(snap.output_value_fils,13200);
assert.equal(snap.label_count,3);
assert.equal(snap.label_details[0].product_code,"6376");
assert.equal(snap.label_details[1].product_code,"6668");
assert.equal(snap.label_details[2].product_code,"7144");
assert.ok(snap.label_details.every(x=>x.weight_grams%2===0));
assert.equal(core.parseDecimal("3.436"),3436);
assert.equal(core.parseDecimal("2.442"),2442);
assert.equal(core.parseDecimal("0.968"),968);
assert.equal(core.parseDecimal("0.026"),26);
assert.equal(core.validateEntry(row("6668",2441)).ok,false);
assert.equal(core.validateEntry(row("6668",2442)).ok,true);
assert.equal(core.validEAN("9667800031057"),true);
assert.equal(core.validateEntry(row("6668",2442,{barcode:"9667800031057"})).ok,false,
  "Reject misplaced beef barcodes in fish production.");
assert.equal(core.validateEntry(row("6668",2442,{barcode:"9667800031058"})).ok,false);
assert.equal(core.calculate([row("6668",2442),row("6376",3436),row("7144",968)]).ok,false,
  "Outputs before original must never be guessed into another batch");
assert.equal(core.calculate([row("6376",3436),row("6668",2442)]).ok,false,
  "Bone label is required before finalizing a fish batch");
assert.equal(core.calculate([row("6376",3436),row("7144",968)]).ok,false,
  "Fillet label is required before finalizing a fish batch");
assert.equal(core.calculate([row("6376",1000),row("6668",900),row("7144",200)]).ok,false,
  "Negative wastage must block the paper");
assert.equal(core.calculate([row("6376",3436),row("6668",2442,{confirmed:false}),row("7144",968)]).ok,false,
  "No paper from unconfirmed fish weights");
assert.equal(core.calculate([...sample,row("6376",1000),row("6668",800),row("7144",180)]).wastage,46,
  "Multiple originals must sum their own independent wastage");
assert.equal(core.calculate([
  row("6376",3436),row("6668",2442),row("7144",968),
  row("6376",1000),row("6668",800),row("7144",220)
]).ok,false,"Later batches cannot have more output than original");
assert.throws(()=>core.snapshot([row("6376",3435),row("6668",2442),row("7144",968)],
  {production_date:"2026-11-15"}),/2 g/);
assert.throws(()=>core.snapshot(sample,{production_date:"bad date"}),/date/);
assert.equal(core.calculate([row("6376",3436),row("6668",2442,{total_price_fils:1000}),row("7144",968)]).unpriced_outputs,1);
const fakeMap=new Map();
function node(id){
  if(fakeMap.has(id))return fakeMap.get(id);
  const obj={id,value:"",textContent:"",disabled:false,hidden:false,checked:false,
    children:[],open:false,src:"",listeners:{},style:{},className:"",
    classList:{toggle(){},add(){},remove(){}},
    addEventListener(n,cb){this.listeners[n]=cb},
    append(...args){this.children.push(...args)},
    replaceChildren(...args){this.children=[...args]},
    removeAttribute(name){if(name==="src")this.src="";if(name==="open")this.open=false},
    setAttribute(){},showModal(){this.open=true},close(){this.open=false},
    focus(){},scrollIntoView(){},pause(){},async play(){}};
  fakeMap.set(id,obj);return obj;
}
const doc={getElementById:node,createElement:tag=>node("elem-"+Math.random()),
  addEventListener(){},head:{append(){}},hidden:false};
const fakeContext={window:{FishProductionCore:core,addEventListener(){},
    supabase:null,isSecureContext:true},
  document:doc,Date,Math,console,Promise,Map,URL:{
    createObjectURL:()=>"blob:label",revokeObjectURL:()=>{}
  },
  setTimeout,clearTimeout,confirm:()=>true};
vm.runInNewContext(fs.readFileSync("fish-production.js","utf8"),fakeContext,
  {filename:"fish-production.js",timeout:3000});
const app=fakeContext.window.FishProductionApp;
assert.ok(app);
assert.equal(node("fishPreview").disabled,true,"Empty paper cannot be previewed");
for(const entry of sample){
  const found=app.addEntry(entry);
  found.confirmed=true;
}
app.render();
assert.equal(node("fishIssue").textContent,"3.436 kg");
assert.equal(node("fishFillet").textContent,"2.442 kg");
assert.equal(node("fishBone").textContent,"0.968 kg");
assert.equal(node("fishWaste").textContent,"0.026 kg");
assert.equal(node("fishPreview").disabled,false);
assert.equal(node("fishSave").disabled,false);
node("fishDate").value="2026-11-15";
const appSnapshot=app.createSnapshot();
assert.equal(appSnapshot.wastage_weight_grams,26);
const hints=app.inferPrintedText("ATLANTIC SALMON FISH WEIGHT 3.436 PRICE 12.345");
assert.equal(hints.product_code,"6376");
assert.equal(hints.weight_grams,3436);
assert.equal(app.inferPrintedText("SALMON FILLET FISH WEIGHT 2.442").product_code,"6668");
assert.equal(app.inferPrintedText("SALMON FISH BONE WEIGHT 0.968").product_code,"7144");
assert.equal(app.inferPrintedText("3.436 12.000 4.500").weight_grams,null,
  "Do not guess fish weight from arbitrary OCR decimals");
vm.runInNewContext(fs.readFileSync("fish-store.js","utf8"),fakeContext,
  {filename:"fish-store.js",timeout:3000});
const store=fakeContext.window.FishStoreChecks;
assert.ok(store);
assert.equal(store.verifySnapshot(appSnapshot).wastage_weight_grams,26);
assert.equal(store.pdfName(appSnapshot),"Salmon-Fish-Production-2026-11-15.pdf");
assert.throws(()=>store.verifySnapshot({...appSnapshot,wastage_weight_grams:28}),/balance/);
console.log("Fish tests passed: 2 g labels, 6376 → 6668 + 7144 + 0.026 kg wastage, UI, snapshots and paper integrity.");
