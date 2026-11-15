const assert=require("node:assert/strict");
const fs=require("node:fs");
const core=require("../barcode-learning-core.js");
const savedMeat=[
  {barcode:"9667807018006",weight_grams:400,total_price_fils:1800},
  {barcode:"9667800031057",weight_grams:690,total_price_fils:3105},
  {barcode:"9667803033300",weight_grams:740,total_price_fils:3330},
  {barcode:"9667808036450",weight_grams:810,total_price_fils:3645}
];
const config={item_code:"6780",product_name:"Pakistani Beef Minced",
  weight_step_grams:5,unit_price_fils:4500,rounding_fils:5};
for(const row of savedMeat){
  assert.equal(core.validBarcode(row.barcode),true,row.barcode);
  assert.equal(core.sampleCheck(row,config).ok,true,row.barcode);
  assert.equal(core.roundedPrice(row.weight_grams,4500,5),row.total_price_fils);
}
assert.equal(core.priceVerifier(3105),0);
assert.equal(core.validBarcode("9667800031058"),false);
assert.equal(core.checkDigit("966780003105"),7);
assert.equal(core.parseAmount("4.500"),4500);
assert.equal(core.parseAmount("0.002"),2);
assert.equal(core.parseAmount("4.5"),4500);
assert.equal(core.parseAmount("1.0000"),null);
assert.equal(core.analyze([],config).status,"collecting");
assert.equal(core.analyze(savedMeat.slice(0,3),config).status,"collecting");
const result=core.analyze(savedMeat,config);
assert.equal(result.status,"validated",JSON.stringify(result));
assert.equal(result.mode,"price5_verified");
assert.equal(result.barcode_prefix,"966780");
assert.equal(result.holdout_count,1);
const profile={...config,barcode_prefix:result.barcode_prefix,
  pattern_mode:result.mode,review_status:result.status};
const recovered=core.decodeLearned("9667800031057",profile);
assert.equal(recovered.ok,true);
assert.equal(recovered.weight_grams,690);
assert.equal(recovered.price_fils,3105);
const guessed=core.suggestBarcode(505,profile);
assert.equal(guessed.ok,true,guessed.error);
assert.equal(guessed.total_price_fils,2275);
assert.equal(core.decodeLearned(guessed.barcode,profile).weight_grams,505);
assert.equal(core.decodeLearned("9667777103054",profile).ok,false,"Wrong product prefix");
assert.equal(core.decodeLearned("9667800031058",profile).ok,false,"Bad EAN");
assert.equal(core.suggestBarcode(503,profile).ok,false,"Reject 3g misalignment");
assert.equal(core.decodeLearned("9667800031057",{...profile,review_status:"collecting"}).ok,false);
const mixedPrefix=core.analyze([...savedMeat.slice(0,3),
  {barcode:"9667777103054",weight_grams:3230,total_price_fils:10305}],
  config);
assert.ok(["ambiguous","collecting"].includes(mixedPrefix.status));
// A typo must be stopped, not silently learned.
assert.equal(core.sampleCheck({...savedMeat[1],weight_grams:685},config).ok,false);
assert.equal(core.sampleCheck({...savedMeat[1],total_price_fils:3100},config).ok,false);
assert.equal(core.sampleCheck({...savedMeat[1],weight_grams:null},config).ok,false);
assert.equal(core.sampleCheck({...savedMeat[1],total_price_fils:null},config).ok,false);

assert.equal(core.analyze([...savedMeat,{...savedMeat[1],weight_grams:695}],config).status,"collecting",
  "A mismatched printed price must block learning before considering barcode collisions.");
// For fish 2g weights, a 5-fil price step may encode more than one weight
// at a low rate. The learner must refuse to assert an exact weight.
const lowPrice={item_code:"6376",product_name:"Atlantic Salmon Fish",
  weight_step_grams:2,unit_price_fils:2000,rounding_fils:5};
const prefix="123456";
function checksumBarcode(first12){return first12+core.checkDigit(first12)}
const fishSamples=[104,202,302,402].map(w=>{
  const price=core.roundedPrice(w,2000,5);
  const b=checksumBarcode(prefix+core.priceVerifier(price)+String(price).padStart(5,"0"));
  return {barcode:b,weight_grams:w,total_price_fils:price};
});
assert.equal(core.analyze([...fishSamples,{...fishSamples[0],weight_grams:106}],lowPrice).status,
  "ambiguous","Same barcode at two 2 g weights must be flagged as ambiguous.");
const fish=core.analyze(fishSamples,lowPrice);
assert.equal(fish.status,"validated");
assert.equal(fish.mode,"price5_verified");
const fishProfile={...lowPrice,barcode_prefix:prefix,pattern_mode:fish.mode,review_status:fish.status};
const ambiguous=core.decodeLearned(fishSamples[0].barcode,fishProfile);
assert.equal(ambiguous.ok,false);
assert.equal(ambiguous.ambiguous,true,"Price rounds across multiple 2 g weights");
assert.equal(core.suggestBarcode(104,fishProfile).ok,false);
const weightSamples=[120,250,340,880].map(grams=>{
  const b=checksumBarcode("621341"+String(grams).padStart(6,"0"));
  return {barcode:b,weight_grams:grams,total_price_fils:core.roundedPrice(grams,3000,5)};
});
const weightCfg={item_code:"9911",product_name:"Fish Test",weight_step_grams:2,
  unit_price_fils:3000,rounding_fils:5};
const weightPattern=core.analyze(weightSamples,weightCfg);
assert.ok(["ambiguous","validated"].includes(weightPattern.status),JSON.stringify(weightPattern));
if(weightPattern.status==="validated"){
  assert.ok(weightPattern.mode.startsWith("weight"));
  const px={...weightCfg,barcode_prefix:weightPattern.barcode_prefix,
    pattern_mode:weightPattern.mode,review_status:weightPattern.status};
  assert.equal(core.decodeLearned(weightSamples[0].barcode,px).weight_grams,120);
}
// Important protection: rule matching observed examples does NOT certify a
// barcode for retail checkout or the existing production catalog.
const workflow=fs.readFileSync(".github/workflows/deploy-pages.yml","utf8");
for(const p of ["barcode-learning.html","barcode-learning.css","barcode-learning-core.js","barcode-learning.js"])
  assert.ok(workflow.includes(p),"Learn page must deploy: "+p);
console.log("Barcode learning tests passed: price verifier, 2g & 5g, held-out sample, checksum, collisions, ambiguity and suggestions.");
