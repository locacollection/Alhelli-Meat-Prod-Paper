const assert=require("node:assert/strict");
const photo=require("../barcode-learning-scan.js");
const labels=require("../barcode-learning-labels.js");
const core=require("../barcode-learning-core.js");
let crops=0;
global.document={
  createElement(tag){
    if(tag!=="canvas")throw new Error("Unexpected element "+tag);
    const canvas={width:0,height:0};
    const context={
      imageSmoothingEnabled:false,
      drawImage(){crops++},
      getImageData(x,y,width,height){
        const data=new Uint8ClampedArray(width*height*4);
        for(let i=0;i<data.length;i+=4){
          data[i]=data[i+1]=data[i+2]=210;data[i+3]=255;
        }
        return {data,width,height};
      },
      putImageData(image){assert.ok(image.data.length>0)}
    };
    canvas.getContext=()=>context;
    return canvas;
  }
};
function workerFor(readings){
  let calls=0;
  return {
    get calls(){return calls},
    async setParameters(opts){
      assert.ok(["7","13","3"].includes(opts.tessedit_pageseg_mode));
    },
    async recognize(){return {data:{text:readings[calls++]||""}}}
  };
}
(async()=>{
  const canvas={width:630,height:390};
  const anchor={x:80,y:210,w:170,h:18};
  const profile={item_code:"7144",weight_step_grams:2,unit_price_fils:1000,
    rounding_fils:5,barcode_prefix:"967144"};
  const samples=[
    ["9671442003501",352,350],
    ["9671440005507",548,550],
    ["9671444000409",38,40],
    ["9671445000507",52,50],
    ["9671449002002",200,200]
  ];
  for(const [barcode,grams,total] of samples){
    const observed=labels.review({
      weight_grams:grams,unit_price_fils:total,total_price_fils:total,
      read_from_photo:{weight:true,unit:true,total:true}
    },profile,barcode,core,"967144");
    assert.equal(observed.unit_price_fils,1000,
      "Never use scanned total as the selected profile unit rate");
    assert.equal(observed.read_from_photo.unit,false);
    assert.equal(core.roundedPrice(grams,1000,5),total);
    assert.equal(core.labelAgreement({barcode,weight_grams:grams,
      unit_price_fils:observed.unit_price_fils,total_price_fils:total},
      profile,{verified_price_prefix:"967144"}).ok,true);
  }
  assert.equal(labels.detectPrinted({data:{
    text:"WEIGHT 0.038 UNIT PRICE 0.200 TOTAL PRICE 0.040"
  }}).unit_price_fils,null,"Do not OCR unit price at all");
  assert.deepEqual(labels.numericCandidates("0548",{allowCompactWeight:true}),[548]);
  assert.deepEqual(labels.numericCandidates("038",{allowCompactWeight:true}),[38]);
  assert.deepEqual(labels.numericCandidates("038"),[],
    "Compact format is unsafe outside focused price-validated weight crops");
  const windows=labels.numericWindows("weight",{x:64,y:195,w:145,h:16},453,265);
  assert.equal(windows.length,2);
  assert.ok(windows[0].y>=140&&windows[0].y+windows[0].h>=180);
  assert.ok(windows[0].x>=105&&windows[0].x+windows[0].w<250);
  for(const [barcode,grams,total,readings] of [
    ["9671440005507",548,550,["0548","0.548"]],
    ["9671444000409",38,40,["038","0.038"]]
  ]){
    const worker=workerFor(readings);
    const got=await photo.readNumberBoxes(worker,canvas,anchor,labels,()=>{},{
      weight_grams:null,total_price_fils:total
    },core,{unit_price_fils:1000,weight_step_grams:2,
      rounding_fils:5,expected_total_fils:total});
    assert.equal(got.values.weight,grams,"Read exact printed grams for "+barcode);
    assert.equal(got.values.unit,undefined,"Never OCR unit price");
    assert.equal(worker.calls,2,"Stop after two matching readings");
  }
  const wrongThenCorrect=workerFor(["0.020","0.020","0.200","0.200"]);
  const corrected=await photo.readNumberBoxes(wrongThenCorrect,canvas,anchor,labels,()=>{},{
    weight_grams:null,total_price_fils:200
  },core,{unit_price_fils:1000,weight_step_grams:2,rounding_fils:5,
    expected_total_fils:200});
  assert.equal(corrected.values.weight,200,
    "Continue to wider crop when the initial OCR weight fails profile price validation");
  assert.equal(corrected.strongWeightEvidence,true);
  const confirmed=labels.supplementPrinted({
    weight_grams:20,unit_price_fils:null,total_price_fils:200,
    read_from_photo:{weight:true,unit:false,total:true}
  },corrected.values,{core,rate:1000,rounding_fils:5,
    strongWeightEvidence:corrected.strongWeightEvidence});
  assert.equal(confirmed.weight_grams,200);
  assert.ok(confirmed.ocr_conflicts.some(x=>x.includes("Confirm weight on photo")));
  // Targeted weight overrides the full-label reading when the two isolated
  // OCR modes agree, even if both values round to the same 5-fil total.
  const precise=labels.supplementPrinted({
    weight_grams:550,unit_price_fils:null,total_price_fils:550,
    read_from_photo:{weight:true,unit:false,total:true}
  },{weight:548},{core,rate:1000,rounding_fils:5,strongWeightEvidence:true});
  assert.equal(precise.weight_grams,548);
  // Tapping a weight is an optional fallback, not permission to infer one
  // based solely on price.
  const originalCreate=global.document.createElement;
  global.document.createElement=tag=>tag==="img"?{
    naturalWidth:450,naturalHeight:250,decode:async()=>{},src:""
  }:originalCreate(tag);
  let terminated=false;
  global.window={Tesseract:{createWorker:async()=>({
    setParameters:async()=>{},
    recognize:async()=>({data:{text:"0.200"}}),
    terminate:async()=>{terminated=true}
  })}};
  const tapped=await photo.readWeightAtPoint("blob:mock-label",.37,.65,
    labels,core,{step:2,unit_price_fils:1000,total_price_fils:200,
      rounding_fils:5});
  assert.equal(tapped.ok,true,JSON.stringify(tapped));
  assert.equal(tapped.weight_grams,200);
  assert.equal(terminated,true);
  assert.equal((await photo.readWeightAtPoint("blob:mock-label",.37,.65,
    labels,core,{step:2,unit_price_fils:1000,total_price_fils:5,
      rounding_fils:5})).ok,false);
  global.document.createElement=originalCreate;
  assert.ok(crops>0);
  console.log("OCR passed: fixed profile rate, five salmon labels, two formerly missing weights, and tap fallback.");
})().catch(err=>{console.error(err);process.exitCode=1});
