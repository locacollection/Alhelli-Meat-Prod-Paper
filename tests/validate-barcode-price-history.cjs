const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"barcode-learning.html"),"utf8");
const src=fs.readFileSync(path.join(root,"barcode-learning-price.js"),"utf8");
const main=fs.readFileSync(path.join(root,"barcode-learning.js"),"utf8");
const predictor=fs.readFileSync(path.join(root,"barcode-predictor.js"),"utf8");
const checker=fs.readFileSync(path.join(root,"weight-price-checker.js"),"utf8");
const sql=fs.readFileSync(path.join(root,"supabase/price-history.sql"),"utf8");
const core=require("../barcode-learning-core.js");

const referenced=[...src.matchAll(/\$\("([^"]+)"\)/g)].map(x=>x[1]);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
for(const id of referenced)assert.ok(ids.includes(id),"Missing price manager field "+id);
assert.ok(html.includes('barcode-learning-price.js?v=price-version-1'));
assert.ok(main.includes(".filter(p=>!p.archived_at)"),"Old price versions must not appear in Barcode Learning");
assert.ok(predictor.includes(".filter(p=>!p.archived_at)"),"Old prices must not appear in Predictor");
assert.ok(checker.includes(".filter(p=>!p.archived_at)"),"Old prices must not appear in Weight & Price Checker");
assert.ok(sql.includes("SECURITY INVOKER")&&sql.includes("FOR UPDATE"));
assert.ok(sql.includes("archived_at = now()")&&sql.includes("sample_count"));
assert.ok(sql.includes("p_expected_unit_price_fils"));
assert.ok(sql.includes("Owners add own barcode learning examples"),"Archived rows should not accept new label examples");

class Node{
  constructor(tag="div"){
    this.tagName=tag.toUpperCase();this.value="";this.textContent="";
    this.hidden=false;this.disabled=false;this.open=false;this.children=[];
    this.events={};const set=new Set();
    this.classList={toggle(k,v){if(v)set.add(k);else set.delete(k)},add(k){set.add(k)},remove(k){set.delete(k)}};
  }
  replaceChildren(...children){this.children=children}
  append(...children){this.children.push(...children)}
  addEventListener(k,fn){this.events[k]=fn}
  fire(k){assert.equal(typeof this.events[k],"function","Listener "+k);this.events[k]({preventDefault(){}})}
  showModal(){this.open=true}
  close(){this.open=false}
  setAttribute(k,v){if(k==="open")this.open=true}
  removeAttribute(k){if(k==="open")this.open=false}
}
const dom=Object.fromEntries(ids.map(id=>[id,new Node()]));
const doc={getElementById:id=>{assert.ok(dom[id],"Unknown ID: "+id);return dom[id]},createElement:tag=>new Node(tag)};
const owner="test-owner";
const original={id:"old-profile",owner_id:owner,item_code:"6793",product_name:"Carrot China",
  unit_price_fils:725,weight_step_grams:5,rounding_fils:5,price_series_id:"series-1",
  price_version:1,archived_at:null,pattern_mode:"price5_verified",
  barcode_prefix:"916793",review_status:"validated",sample_count:6};
const oldExamples=[
  {barcode:"9167938000159",weight_grams:20,total_price_fils:15},
  {barcode:"9167932000209",weight_grams:25,total_price_fils:20},
  {barcode:"9167936000854",weight_grams:115,total_price_fils:85}
];
let active=original,newVersion=null,rpcCount=0,pendingCleared=0,stoppedCamera=0,refreshCount=0,allowConfirm=false;
const allProfiles=[original],calls=[];
const client={
  async rpc(name,args){
    assert.equal(name,"start_barcode_learning_price_version");
    assert.equal(args.p_profile_id,original.id);
    assert.equal(args.p_expected_unit_price_fils,725);
    assert.equal(args.p_new_unit_price_fils,900);
    rpcCount++;
    original.archived_at="2026-11-16T12:00:00Z";
    newVersion={...original,id:"new-profile",unit_price_fils:900,price_version:2,archived_at:null,
      pattern_mode:"unknown",barcode_prefix:"",review_status:"collecting",sample_count:0};
    allProfiles.push(newVersion);
    return {data:newVersion.id,error:null};
  },
  from(table){
    const where={};
    return {
      select(){return this},
      eq(k,v){where[k]=v;return this},
      order(){return this},
      limit(){
        calls.push({table,where:{...where}});
        if(table==="barcode_learning_profiles"){
          return Promise.resolve({data:allProfiles.filter(p=>
            p.owner_id===where.owner_id&&p.price_series_id===where.price_series_id),error:null});
        }
        if(table==="barcode_learning_examples"){
          return Promise.resolve({data:where.profile_id===original.id?oldExamples:[],error:null});
        }
        throw Error("Unexpected DB table "+table);
      }
    };
  }
};
const api={
  getClient:()=>client,
  getUser:()=>({id:owner}),
  getActive:()=>active,
  stopCamera(){stoppedCamera++},
  clearPendingLabels(){pendingCleared++},
  async refreshProfiles(id){
    assert.equal(id,"new-profile");refreshCount++;
    active=allProfiles.find(p=>p.id===id);
  }
};
let exported;
const context={window:{
  BarcodeLearningChecks:api,BarcodeLearningCore:core,
  location:{search:""},confirm:()=>allowConfirm
},document:doc};
vm.runInNewContext(src,context,{filename:"barcode-learning-price.js"});
exported=context.window.BarcodeLearningPriceUI;
assert.ok(exported);
async function flush(){for(let i=0;i<40;i++)await Promise.resolve()}
(async()=>{
  exported.refresh();
  assert.equal(dom.learnChangePriceOpen.disabled,false);
  assert.match(dom.learnCurrentPrice.textContent,/0\.725 BD\/kg/);
  dom.learnChangePriceOpen.fire("click");
  assert.equal(dom.learnChangePriceDialog.open,true);

  // Same price and out-of-range prices must not create a version.
  dom.learnNewPrice.value="0.725";
  dom.learnChangePriceForm.fire("submit");await flush();
  assert.equal(rpcCount,0);
  assert.match(dom.learnChangePriceFeedback.textContent,/different/);
  dom.learnNewPrice.value="0";
  dom.learnChangePriceForm.fire("submit");await flush();
  assert.equal(rpcCount,0);

  // Cancel confirmation: no database mutation.
  dom.learnNewPrice.value="0.900";
  dom.learnChangePriceForm.fire("submit");await flush();
  assert.equal(rpcCount,0);

  // Confirm a price change. Old labels and old pattern survive unchanged.
  allowConfirm=true;
  dom.learnChangePriceForm.fire("submit");await flush();
  assert.equal(rpcCount,1);
  assert.equal(pendingCleared,1);
  assert.equal(stoppedCamera,1);
  assert.equal(refreshCount,1);
  assert.equal(active.id,"new-profile");
  assert.equal(active.unit_price_fils,900);
  assert.equal(active.review_status,"collecting");
  assert.equal(active.sample_count,0);
  assert.equal(original.unit_price_fils,725);
  assert.equal(original.pattern_mode,"price5_verified");
  assert.deepEqual(oldExamples.map(x=>x.barcode),[
    "9167938000159","9167932000209","9167936000854"]);
  assert.match(dom.learnProfileInfo.textContent,/4 varied REAL labels/);

  dom.learnPriceHistoryOpen.fire("click");await flush();
  assert.equal(dom.learnPriceHistoryList.children.length,2);
  assert.match(dom.learnPriceHistoryList.children[0].children[0].children[0].textContent,/0\.725|0\.900/);
  const previous=dom.learnPriceHistoryList.children.find(c=>
    c.children[0].children[0].textContent.includes("0.725"));
  assert.ok(previous,"Previous price should be listed");
  previous.children[1].fire("click");await flush();
  assert.equal(dom.learnPriceHistorySamples.hidden,false);
  assert.equal(dom.learnPriceHistorySamplesList.children.length,oldExamples.length);
  assert.ok(!src.includes(".delete("),"History viewer must not delete samples");
  assert.ok(!src.includes(".insert("),"Versioning is done atomically via RPC");
  console.log("Price history passed: new version, old labels retained, no validation inheritance, confirmation, old-price viewer and active profile refresh.");
})().catch(err=>{console.error(err);process.exitCode=1});
