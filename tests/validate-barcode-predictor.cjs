const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const core=require("../barcode-learning-core.js");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"barcode-predictor.html"),"utf8");
const source=fs.readFileSync(path.join(root,"barcode-predictor.js"),"utf8");
const learning=fs.readFileSync(path.join(root,"barcode-learning.html"),"utf8");

assert.match(html,/id="predictorProfile"/);
assert.match(html,/id="predictorWeight"/);
assert.match(html,/id="predictorForm"/);
assert.ok(learning.includes('href="./barcode-predictor.html"'));
assert.ok(!learning.includes('id="learnPredictForm"'),
  "Prediction entry should live only on its own page");
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const used=[...source.matchAll(/\$\("([^"]+)"\)/g)].map(m=>m[1]);
for(const id of used)assert.ok(ids.includes(id),"Missing predictor HTML element "+id);

class MockElement{
  constructor(tag="div"){
    this.tagName=tag.toUpperCase();
    this.value="";
    this.textContent="";
    this.children=[];
    this.hidden=false;
    this.disabled=false;
    this.callbacks={};
    const set=new Set();
    this.classList={
      add(name){set.add(name)},
      remove(name){set.delete(name)},
      toggle(name,enable){if(enable)set.add(name);else set.delete(name)},
      contains(name){return set.has(name)}
    };
  }
  replaceChildren(...children){
    this.children=children;
    if(this.tagName==="SELECT")this.value=children.length?children[0].value:"";
  }
  append(...children){
    this.children.push(...children);
  }
  addEventListener(name,fn){this.callbacks[name]=fn}
  emit(name){
    assert.equal(typeof this.callbacks[name],"function","Missing "+name+" event listener");
    this.callbacks[name]({preventDefault(){}});
  }
}
const nodes=Object.fromEntries(ids.map(id=>[id,new MockElement(id==="predictorProfile"?"select":"div")]));
const document={
  getElementById(id){assert.ok(nodes[id],"Unknown DOM id "+id);return nodes[id]},
  createElement(tag){return new MockElement(tag)}
};
const owner="fixture-user";
const entries=[
  {id:"a",owner_id:owner,item_code:"6376",product_name:"Salmon",
    weight_step_grams:2,unit_price_fils:4500,rounding_fils:5,
    barcode_prefix:"963376",pattern_mode:"weight6",review_status:"validated",sample_count:6},
  {id:"b",owner_id:owner,item_code:"7406",product_name:"Cheese",
    weight_step_grams:1,unit_price_fils:1000,rounding_fils:5,
    barcode_prefix:"916793",pattern_mode:"price5_verified",review_status:"validated",sample_count:5},
  {id:"c",owner_id:owner,item_code:"8100",product_name:"New Item",
    weight_step_grams:5,unit_price_fils:3750,rounding_fils:5,
    barcode_prefix:"",pattern_mode:"unknown",review_status:"collecting",sample_count:1}
];
const operations=[];
const fakeClient={
  auth:{
    getSession:async()=>({data:{session:{user:{id:owner,email:"fixture@example.com"}}},error:null}),
    onAuthStateChange(){},
    signInWithPassword:async()=>({data:{user:{id:owner,email:"fixture@example.com"}},error:null}),
    signOut:async()=>({error:null})
  },
  from(table){
    assert.equal(table,"barcode_learning_profiles","Predictor only reads saved learning profiles");
    const request={table};
    return {
      select(columns){request.columns=columns;return this},
      eq(field,value){request[field]=value;return this},
      order(){return this},
      limit(){operations.push(request);return Promise.resolve({data:entries,error:null})}
    };
  }
};
const context={
  window:{BarcodeLearningCore:core,supabase:{createClient:()=>fakeClient}},
  document,
  navigator:{clipboard:{writeText:async()=>{}}}
};
vm.runInNewContext(source,context,{filename:"barcode-predictor.js"});
async function flush(){for(let i=0;i<20;i++)await Promise.resolve()}

(async()=>{
  await flush();
  assert.equal(nodes.predictorWorkspace.hidden,false,"Signed in staff should see predictor");
  assert.equal(nodes.predictorProfile.children.length,entries.length+1,
    "All saved profile options should be available");
  assert.equal(operations[0].owner_id,owner,"Read only this user's profiles");

  nodes.predictorProfile.value="a";
  nodes.predictorProfile.emit("change");
  nodes.predictorWeight.value="0.150";
  nodes.predictorForm.emit("submit");
  assert.equal(nodes.predictorResult.hidden,false);
  assert.equal(nodes.predictorBarcodeBlock.hidden,false);
  assert.ok(core.validBarcode(nodes.predictorResultBarcode.textContent));
  assert.ok(nodes.predictorResultBarcode.textContent.startsWith("963376"));
  assert.equal(nodes.predictorResultPrice.textContent,"0.675 BD");

  nodes.predictorProfile.value="b";
  nodes.predictorProfile.emit("change");
  nodes.predictorWeight.value="0.150";
  nodes.predictorForm.emit("submit");
  assert.equal(nodes.predictorResult.hidden,false);
  assert.equal(nodes.predictorBarcodeBlock.hidden,true,
    "Ambiguous price barcodes must not be displayed");
  assert.equal(nodes.predictorResultBarcode.textContent,"");
  assert.match(nodes.predictorResultExplanation.textContent,/not unique/i);

  nodes.predictorProfile.value="c";
  nodes.predictorProfile.emit("change");
  nodes.predictorWeight.value="0.150";
  nodes.predictorForm.emit("submit");
  assert.equal(nodes.predictorBarcodeBlock.hidden,true,
    "Untrained profile must not generate barcode");
  assert.match(nodes.predictorResultExplanation.textContent,/train and validate/i);

  nodes.predictorProfile.value="a";
  nodes.predictorProfile.emit("change");
  nodes.predictorWeight.value="0.151";
  nodes.predictorForm.emit("submit");
  assert.equal(nodes.predictorResult.hidden,true);
  assert.match(nodes.predictorMessage.textContent,/2 g increments/);

  assert.deepEqual(operations.map(o=>o.table),["barcode_learning_profiles"]);
  console.log("Barcode Predictor passed: saved profile selection, unique EAN generation, ambiguous/untrained blocking, step validation and read-only Supabase access.");
})().catch(err=>{console.error(err);process.exitCode=1});