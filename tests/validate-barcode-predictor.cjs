const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const core=require("../barcode-learning-core.js");
const root=path.resolve(__dirname,"..");
const html=fs.readFileSync(path.join(root,"barcode-predictor.html"),"utf8");
const script=fs.readFileSync(path.join(root,"barcode-predictor.js"),"utf8");
const learning=fs.readFileSync(path.join(root,"barcode-learning.html"),"utf8");
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const used=[...script.matchAll(/\$\("([^"]+)"\)/g)].map(m=>m[1]);
for(const id of used)assert.ok(ids.includes(id),"Missing HTML element: "+id);
assert.ok(html.includes('id="predictorAddLearning"'));
assert.ok(!html.includes("predictorScanActual"),"No scanner should be needed to self-confirm");
assert.ok(learning.includes('href="./barcode-predictor.html"'));
assert.ok(!learning.includes('id="learnPredictForm"'));

class MockElement{
  constructor(tag="div"){
    this.tagName=tag.toUpperCase();
    this.value="";this.textContent="";this.disabled=false;
    this.hidden=false;this.children=[];this.listeners={};
    const set=new Set();
    this.classList={
      toggle(name,enabled){if(enabled)set.add(name);else set.delete(name)},
      add(name){set.add(name)},remove(name){set.delete(name)},
      contains(name){return set.has(name)}
    };
  }
  addEventListener(event,fn){this.listeners[event]=fn}
  emit(event){
    assert.ok(this.listeners[event],"Missing event listener for "+event);
    return this.listeners[event]({preventDefault(){}});
  }
  replaceChildren(...items){
    this.children=items;if(this.tagName==="SELECT")this.value=items[0]?.value||"";
  }
  append(...items){this.children.push(...items)}
}
const nodes=Object.fromEntries(ids.map(id=>[id,new MockElement(id==="predictorProfile"?"select":"div")]));
const document={
  getElementById:id=>{assert.ok(nodes[id],"Unknown ID "+id);return nodes[id]},
  createElement:tag=>new MockElement(tag)
};
const owner="test-owner";
const entries=[
  {id:"salmon",owner_id:owner,item_code:"6376",product_name:"Salmon",
    weight_step_grams:2,unit_price_fils:4500,rounding_fils:5,
    barcode_prefix:"963376",pattern_mode:"weight6",review_status:"validated",sample_count:6},
  {id:"carrot",owner_id:owner,item_code:"6793",product_name:"Carrot China",
    weight_step_grams:5,unit_price_fils:725,rounding_fils:5,
    barcode_prefix:"916793",pattern_mode:"price5_verified",review_status:"validated",sample_count:6},
  {id:"untrained",owner_id:owner,item_code:"8100",product_name:"New item",
    weight_step_grams:5,unit_price_fils:3750,rounding_fils:5,
    barcode_prefix:"",pattern_mode:"unknown",review_status:"collecting",sample_count:1}
];
const carrotSamples=[
  {barcode:"9167938000159",weight_grams:20,total_price_fils:15},
  {barcode:"9167932000209",weight_grams:25,total_price_fils:20},
  {barcode:"9167936000854",weight_grams:115,total_price_fils:85},
  {barcode:"9167935001401",weight_grams:195,total_price_fils:140},
  {barcode:"9167934004151",weight_grams:575,total_price_fils:415},
  {barcode:"9167934007251",weight_grams:1000,total_price_fils:725}
];
const stored=carrotSamples.map((row,i)=>({...row,id:"old-"+i,owner_id:owner,profile_id:"carrot"}));
let confirmed=false,confirmCount=0,insertCount=0,profileUpdateCount=0;
let conflict=null;
const operations=[];
function query(table){
  const where={},record={table};
  let mode="read",values=null;
  function run(){
    operations.push({...record,where:{...where},mode});
    if(table==="barcode_learning_profiles"){
      if(mode==="update"){
        profileUpdateCount++;
        Object.assign(entries.find(e=>e.id===where.id),values);
        return {data:null,error:null};
      }
      return {data:entries,error:null};
    }
    assert.equal(table,"barcode_learning_examples");
    if(mode==="insert"){
      insertCount++;
      stored.push({...values,id:"new-"+insertCount});
      return {data:null,error:null};
    }
    let data=stored.filter(x=>x.owner_id===where.owner_id&&x.profile_id===where.profile_id);
    if(where.barcode!==undefined){
      data=data.filter(x=>x.barcode===where.barcode);
      if(conflict)data=[conflict];
    }
    return {data,error:null};
  }
  return {
    select(columns){record.columns=columns;return this},
    eq(field,value){where[field]=value;return this},
    order(){return this},
    limit(){return Promise.resolve(run())},
    insert(row){mode="insert";values=row;return Promise.resolve(run())},
    update(row){mode="update";values=row;return this},
    then(resolve,reject){return Promise.resolve(run()).then(resolve,reject)}
  };
}
const client={
  auth:{
    getSession:async()=>({data:{session:{user:{id:owner,email:"test@example.com"}}},error:null}),
    onAuthStateChange(){},
    signInWithPassword:async()=>({data:{user:{id:owner,email:"test@example.com"}},error:null}),
    signOut:async()=>({error:null})
  },
  from:query
};
const context={
  window:{
    BarcodeLearningCore:core,
    supabase:{createClient:()=>client},
    confirm:()=>{confirmCount++;return confirmed}
  },
  document,navigator:{clipboard:{writeText:async()=>{}}}
};
vm.runInNewContext(script,context,{filename:"barcode-predictor.js"});
async function flush(){for(let i=0;i<60;i++)await Promise.resolve()}
function predict(profileId,weight){
  nodes.predictorProfile.value=profileId;
  nodes.predictorProfile.emit("change");
  nodes.predictorWeight.value=weight;
  nodes.predictorForm.emit("submit");
}
(async()=>{
  await flush();
  assert.equal(nodes.predictorWorkspace.hidden,false);
  assert.equal(nodes.predictorProfile.children.length,entries.length+1);
  assert.equal(operations[0].where.owner_id,owner);

  predict("carrot","0.150");
  const code=nodes.predictorResultBarcode.textContent;
  assert.equal(code,"9167930001109");
  assert.match(nodes.predictorResultState.textContent,/ambiguous/i);
  assert.equal(nodes.predictorResultPrice.textContent,"0.110 BD");
  assert.equal(nodes.predictorBarcodeBlock.hidden,false);

  // User has not checked the sticker, and cancels the confirmation.
  nodes.predictorAddLearning.emit("click");
  await flush();
  assert.equal(insertCount,0,"Cancelling should not save generated predictions");
  assert.equal(confirmCount,1);

  // User personally checks the printed sticker and accepts.
  confirmed=true;
  nodes.predictorAddLearning.emit("click");
  await flush();
  assert.equal(insertCount,1);
  assert.equal(profileUpdateCount,1);
  assert.equal(stored.at(-1).barcode,code);
  assert.equal(stored.at(-1).weight_grams,150);
  assert.equal(stored.at(-1).total_price_fils,110);
  assert.equal(stored.at(-1).verified_from_label,true);
  assert.equal(stored.at(-1).owner_id,owner);
  assert.equal(stored.at(-1).profile_id,"carrot");
  assert.equal(entries[1].sample_count,7);
  assert.equal(entries[1].review_status,"validated");
  assert.match(nodes.predictorLearningFeedback.textContent,/Saved to Barcode Learning/);
  assert.match(nodes.predictorAddLearning.textContent,/Added to Barcode Learning/);

  // Same barcode cannot be inserted twice.
  nodes.predictorAddLearning.emit("click");
  await flush();
  assert.equal(insertCount,1);
  assert.match(nodes.predictorLearningFeedback.textContent,/already saved/i);

  // A conflicting saved example must be rejected, not overwritten.
  predict("carrot","0.160");
  conflict={barcode:nodes.predictorResultBarcode.textContent,weight_grams:1000,total_price_fils:115};
  nodes.predictorAddLearning.emit("click");
  await flush();
  assert.equal(insertCount,1);
  assert.match(nodes.predictorLearningFeedback.textContent,/different weight or total/);
  conflict=null;

  // Unvalidated profiles cannot generate a candidate or be added.
  predict("untrained","0.150");
  assert.equal(nodes.predictorBarcodeBlock.hidden,true);
  nodes.predictorAddLearning.emit("click");
  await flush();
  assert.equal(insertCount,1);
  assert.match(nodes.predictorLearningFeedback.textContent,/Predict a barcode/);

  // Product switch clears previous prediction; failed increments never save.
  predict("salmon","0.151");
  assert.equal(nodes.predictorResult.hidden,true);
  assert.match(nodes.predictorMessage.textContent,/2 g increments/);
  nodes.predictorAddLearning.emit("click");
  await flush();
  assert.equal(insertCount,1);

  // No camera nor Production Paper data was accessed.
  assert.ok(operations.every(x=>["barcode_learning_profiles","barcode_learning_examples"].includes(x.table)));
  assert.ok(!script.includes("getUserMedia"));
  console.log("Barcode predictor tests passed: manual confirmation, saved example, learning refresh, duplicate and conflict protection, unvalidated rejection, no scanner or production writes.");
})().catch(e=>{console.error(e);process.exitCode=1});
