const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const core=require("../barcode-learning-core.js");
const root=path.resolve(__dirname,"..");
const src=fs.readFileSync(path.join(root,"weight-price-checker.js"),"utf8");
const html=fs.readFileSync(path.join(root,"weight-price-checker.html"),"utf8");
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const refs=[...src.matchAll(/\$\("([^"]+)"\)/g)].map(m=>m[1]);
for(const id of refs)assert.ok(ids.includes(id),"Missing HTML ID "+id);
class Element{
  constructor(){this.value="";this.hidden=false;this.disabled=false;this.textContent="";
    this.children=[];this.callbacks={};
    this.classList={toggle(){},remove(){},add(){}};
  }
  addEventListener(name,fn){this.callbacks[name]=fn}
  emit(name){assert.ok(this.callbacks[name],"Missing "+name);this.callbacks[name]({preventDefault(){}})}
  replaceChildren(...items){this.children=items}
  append(...items){this.children.push(...items)}
  pause(){}
}
const nodes=Object.fromEntries(ids.map(id=>[id,new Element()]));
const owner="owner";
const prior={item_code:"6793",product_name:"Carrot China",unit_price_fils:725,
  rounding_fils:5,price_version:1,archived_at:"2026-11-16T12:00:00Z"};
const current={id:"new",owner_id:owner,item_code:"6793",product_name:"Carrot China",
  unit_price_fils:900,rounding_fils:5,price_version:2,archived_at:null,
  barcode_prefix:"",pattern_mode:"unknown",review_status:"collecting",sample_count:0};
let existing=[{profile_id:"prior",weight_grams:20,total_price_fils:15}];
const accessed=[];
const db={
  auth:{getSession:async()=>({data:{session:{user:{id:owner,email:"test@example.com"}}},error:null}),
    onAuthStateChange(){},signInWithPassword:async()=>({data:{user:{id:owner}},error:null}),
    signOut:async()=>({error:null})},
  from(table){
    const filter={};
    return {
      select(){return this},
      eq(key,value){filter[key]=value;return this},
      order(){return this},
      limit(n){
        accessed.push({table,filter:{...filter}});
        if(table==="barcode_learning_profiles")return Promise.resolve({data:[current],error:null});
        if(table==="barcode_learning_examples")
          return Promise.resolve({data:filter.barcode==="9167938000159"?existing:[],error:null});
        throw Error("Unexpected "+table);
      },
      maybeSingle(){
        accessed.push({table,filter:{...filter}});
        if(table==="custom_barcode_items")return Promise.resolve({data:null,error:null});
        if(table==="barcode_learning_profiles")return Promise.resolve({data:prior,error:null});
        throw Error("Unexpected "+table);
      }
    };
  }
};
const doc={
  getElementById:id=>{assert.ok(nodes[id],"Missing element "+id);return nodes[id]},
  createElement:()=>new Element(),
  addEventListener(){}
};
const win={addEventListener(){},BarcodeLearningCore:core,supabase:{createClient:()=>db}};
vm.runInNewContext(src,{window:win,document:doc,navigator:{}},{filename:"weight-price-checker.js"});
async function flush(){for(let i=0;i<60;i++)await Promise.resolve()}
(async()=>{
 await flush();
 nodes.checkerBarcode.value="9167938000159";
 nodes.checkerLookupForm.emit("submit");
 await flush();
 assert.equal(nodes.checkerResult.hidden,false);
 assert.equal(nodes.checkerResultSource.textContent,"Historical confirmed label");
 assert.equal(nodes.checkerUnitPrice.textContent,"0.725 BD");
 assert.equal(nodes.checkerQuantity.textContent,"0.020 kg");
 assert.equal(nodes.checkerTotal.textContent,"0.015 BD");
 assert.match(nodes.checkerResultNote.textContent,/original|historical price/i);
 assert.equal(current.unit_price_fils,900,"Active price must not change");

 // An ambiguous archived duplicate must not be silently assigned the wrong price.
 existing=[{profile_id:"prior",weight_grams:20,total_price_fils:15},
           {profile_id:"other",weight_grams:20,total_price_fils:15}];
 nodes.checkerLookupForm.emit("submit");
 await flush();
 assert.equal(nodes.checkerResult.hidden,true);
 assert.match(nodes.checkerLookupMessage.textContent,/more than one saved training example/);
 assert.ok(accessed.some(x=>x.table==="barcode_learning_examples"));
 console.log("Weight & Price Checker passed: historical barcodes show their original saved price and ambiguous historical matches are blocked.");
})().catch(err=>{console.error(err);process.exitCode=1});
