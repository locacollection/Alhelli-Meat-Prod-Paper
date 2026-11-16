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
for(const id of ["predictorVerifyPanel","predictorVerifyForm","predictorActualBarcode",
  "predictorActualWeight","predictorActualTotal","predictorCameraDialog","predictorScanActual"])
  assert.ok(html.includes('id="'+id+'"'),"Missing printed-label verification field "+id);
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
  {id:"b",owner_id:owner,item_code:"6793",product_name:"Carrot China",
    weight_step_grams:5,unit_price_fils:725,rounding_fils:5,
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
// Use a simulated camera. No real barcode or Supabase records are modified.
const liveScans=[];
const fakeTracks=[{stopped:false,stop(){this.stopped=true}}];
const stream={getTracks:()=>fakeTracks};
nodes.predictorCameraVideo.readyState=3;
nodes.predictorCameraVideo.play=async()=>{};
nodes.predictorCameraVideo.pause=()=>{};
nodes.predictorCameraDialog.showModal=function(){this.open=true};
nodes.predictorCameraDialog.close=function(){this.open=false};
const context={
  window:{
    isSecureContext:true,
    BarcodeLearningCore:core,
    supabase:{createClient:()=>fakeClient},
    BarcodeDetector:class {
      static async getSupportedFormats(){return ["ean_13"]}
      async detect(){return [{rawValue:liveScans[0]}]}
    }
  },
  document,
  navigator:{
    mediaDevices:{getUserMedia:async()=>stream},
    clipboard:{writeText:async()=>{}}
  }
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

  // Manually matching data is a conditional match, not independent physical proof.
  const realSalmonBarcode=nodes.predictorResultBarcode.textContent;
  nodes.predictorOpenVerify.emit("click");
  assert.equal(nodes.predictorVerifyPanel.hidden,false);
  nodes.predictorActualBarcode.value=realSalmonBarcode;
  nodes.predictorActualWeight.value="0.150";
  nodes.predictorActualTotal.value="0.675";
  nodes.predictorVerifyForm.emit("submit");
  assert.match(nodes.predictorVerificationTitle.textContent,/Manually entered details match/);
  assert.match(nodes.predictorVerificationDetails.textContent,/not an independent scan/i);

  // A different real barcode or a mismatched printed price must fail.
  nodes.predictorActualBarcode.value=core.suggestBarcode(152,entries[0]).barcode;
  nodes.predictorActualBarcode.emit("input");
  nodes.predictorVerifyForm.emit("submit");
  assert.match(nodes.predictorVerificationTitle.textContent,/Does not match/);
  assert.match(nodes.predictorVerificationDetails.textContent,/barcode differs/i);
  nodes.predictorActualBarcode.value=realSalmonBarcode;
  nodes.predictorActualTotal.value="0.680";
  nodes.predictorVerifyForm.emit("submit");
  assert.match(nodes.predictorVerificationDetails.textContent,/total differs/i);
  nodes.predictorActualTotal.value="0.675";
  nodes.predictorActualWeight.value="0.148";
  nodes.predictorVerifyForm.emit("submit");
  assert.match(nodes.predictorVerificationDetails.textContent,/weight differs/i);

  // Native camera detection supplies real sticker EAN and marks the source.
  nodes.predictorActualWeight.value="0.150";
  liveScans[0]=realSalmonBarcode;
  nodes.predictorScanActual.emit("click");
  await flush();
  assert.equal(nodes.predictorActualBarcode.value,realSalmonBarcode);
  assert.equal(fakeTracks[0].stopped,true,"Camera tracks must stop after scanning");
  nodes.predictorVerifyForm.emit("submit");
  assert.match(nodes.predictorVerificationTitle.textContent,/Matches scanned barcode/);
  nodes.predictorActualBarcode.emit("input");
  nodes.predictorVerifyForm.emit("submit");
  assert.match(nodes.predictorVerificationTitle.textContent,/Manually entered details match/,
    "Editing a scanned barcode must downgrade proof to manual entry");

  nodes.predictorProfile.value="b";
  nodes.predictorProfile.emit("change");
  nodes.predictorWeight.value="0.150";
  nodes.predictorForm.emit("submit");
  assert.equal(nodes.predictorResult.hidden,false);
  assert.equal(nodes.predictorBarcodeBlock.hidden,false,
    "Validated price patterns should show calculable candidate barcodes even when the weight is ambiguous");
  assert.equal(nodes.predictorResultBarcode.textContent,"9167930001109");
  assert.equal(nodes.predictorResultPrice.textContent,"0.110 BD");
  assert.equal(nodes.predictorVerifyPanel.hidden,true,
    "Changing profiles must discard stale verification from the previous product");
  assert.match(nodes.predictorResultState.textContent,/ambiguous/i);
  assert.match(nodes.predictorResultExplanation.textContent,/does NOT verify/i);
  const decodedCarrot=core.decodeLearned(nodes.predictorResultBarcode.textContent,entries[1]);
  assert.equal(decodedCarrot.ok,false);
  assert.equal(decodedCarrot.ambiguous,true,
    "The candidate barcode must remain invalid for uniquely decoding a weight");
  assert.equal(core.suggestBarcode(150,entries[1]).ok,false,
    "The original strict decoder still must reject ambiguous weights");

  const carrotCode=nodes.predictorResultBarcode.textContent;
  const verifiedCarrot=core.verifyPredictedAgainstLabel({
    profile:entries[1],predicted_barcode:carrotCode,requested_weight_grams:150,
    printed_barcode:carrotCode,printed_weight_grams:150,printed_total_fils:110
  });
  assert.equal(verifiedCarrot.ok,true);
  assert.equal(verifiedCarrot.ambiguous_weight,true,
    "A physical match must not imply unique weight decoding");
  assert.equal(core.verifyPredictedAgainstLabel({
    profile:entries[1],predicted_barcode:carrotCode,requested_weight_grams:150,
    printed_barcode:carrotCode,printed_weight_grams:155,printed_total_fils:110
  }).ok,false);
  assert.equal(core.verifyPredictedAgainstLabel({
    profile:entries[1],predicted_barcode:carrotCode,requested_weight_grams:150,
    printed_barcode:"9167930001100",printed_weight_grams:150,printed_total_fils:110
  }).ok,false,"Invalid EAN-13 check digit should fail");

  nodes.predictorOpenVerify.emit("click");
  nodes.predictorActualBarcode.value=carrotCode;
  nodes.predictorActualWeight.value="0.150";
  nodes.predictorActualTotal.value="0.110";
  nodes.predictorVerifyForm.emit("submit");
  assert.match(nodes.predictorVerificationDetails.textContent,/not an independent scan/i);

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
  console.log("Barcode Predictor passed: saved-profile prediction, EAN check digits, real-label camera and manual comparisons, mismatch rejection, ambiguous-weight warning, scanner cleanup and read-only database access.");
})().catch(err=>{console.error(err);process.exitCode=1});