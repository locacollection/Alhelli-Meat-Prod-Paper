const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const core=require("../barcode-learning-core.js");
const ocr=require("../barcode-learning-labels.js");
const root=path.resolve(__dirname,"..");
const salmon={item_code:"6668",product_name:"Salmon Fillet Fish (With Skin)",
  weight_step_grams:2,unit_price_fils:8750,rounding_fils:5};
const cheese={item_code:"7406",product_name:"Cheese Bramli W/PEPR",
  weight_step_grams:5,unit_price_fils:2100,rounding_fils:5};
function check(profile,barcode,weight,unit,total,options={}){
  return core.labelAgreement({barcode,weight_grams:weight,
    unit_price_fils:unit,total_price_fils:total},profile,options);
}
let opts={expected_product_code:"6668",verified_price_prefix:"966668"};
const correct=check(salmon,"9666682000205",2,8750,20,opts);
assert.equal(correct.ok,true,JSON.stringify(correct));
assert.equal(correct.state,"ready");
assert.match(correct.message,/All values match/);
const wrong=check(salmon,"9666682000205",20,8750,20,opts);
assert.equal(wrong.ok,false);
assert.equal(wrong.state,"mismatch");
assert.match(wrong.message,/0\.020 kg.*0\.175 BD.*0\.020 BD/);
assert.equal(check(salmon,"9666682000205",2,8750,175,opts).ok,false,
  "Reject total price that disagrees with printed EAN");
assert.equal(check(salmon,"9666682000205",null,8750,20,opts).state,"missing");
assert.equal(check(salmon,"9666682000205",2,null,20,opts).state,"missing");
assert.equal(check(salmon,"9666682000205",2,8750,null,opts).state,"missing");
assert.equal(check(salmon,"",2,8750,20,opts).state,"missing");
assert.equal(check(salmon,"9666682000204",2,8750,20,opts).state,"mismatch");
assert.equal(check(salmon,"9666682000205",2,8750,20,
  {...opts,printed_product_code:"6376"}).ok,false);
assert.equal(check(salmon,"9666682000205",2,8750,20,
  {...opts,expected_product_code:"7144"}).ok,false);
assert.equal(check(salmon,"9666682000205",2,8000,20,opts).ok,false,
  "Saved item rate must agree");
assert.equal(check(salmon,"9666682000205",3,8750,20,opts).ok,false,
  "Fish 2g step must agree");
assert.equal(check(cheese,"5874046009656",460,2100,965).ok,true,
  "Cheese weight, unit price, and rounded total agree with valid EAN");
assert.equal(check(cheese,"5874046009656",460,2100,965,{verified_price_prefix:"587404"}).ok,true,
  "Known cheese price verifier and total must agree");
assert.equal(check(cheese,"5874046009656",450,2100,965).ok,false);
assert.equal(check(cheese,"5874046009656",460,2100,970).ok,false);
// Reported live case: OCR 3.450 BD total is wrong, 0.900 kg at the saved
// 3.500 BD/kg rate means 3.150 BD, which the 6777 barcode actually encodes.
const beef={item_code:"6777",product_name:"Pakistani Beef With Bone",
  unit_price_fils:3500,weight_step_grams:5,rounding_fils:5,
  review_status:"validated",barcode_prefix:"966777",pattern_mode:"price5_verified"};
const currentBarcode="9667777031500";
assert.equal(core.validBarcode(currentBarcode),true);
assert.equal(core.roundedPrice(900,3500,5),3150);
assert.equal(ocr.derivePriceFromBarcode(currentBarcode,core,"966777"),3150);
const originalOCR=ocr.review({
  weight_grams:900,total_price_fils:3450,unit_price_fils:null,
  read_from_photo:{weight:true,unit:false,total:true}
},beef,currentBarcode,core,"966777");
const disagreement=ocr.weightPriceConflict(originalOCR,beef,currentBarcode,core,"966777");
assert.ok(disagreement,"3.450 OCR must be flagged as inconsistent");
assert.equal(disagreement.ocr_weight_grams,900);
assert.equal(disagreement.total_price_fils,3450);
assert.equal(disagreement.barcode_total_fils,3150);
const scanned={
  barcode:currentBarcode,weight:"0.900",total:"3.450",
  weightConflict:disagreement,manualCorrections:{}
};
assert.equal(ocr.manualConflictStatus(scanned,core).unresolved,true,
  "Uncorrected inconsistent OCR must remain blocked");
assert.equal(check(beef,currentBarcode,900,3500,3450,
  {verified_price_prefix:"966777"}).ok,false,
  "Wrong 3.450 reading must never be saved");

scanned.total="3.150";
scanned.manualCorrections.total=true;
const corrected=ocr.manualConflictStatus(scanned,core);
assert.equal(corrected.unresolved,false,
  "Changing the OCR total alone must resolve the stale OCR conflict");
assert.equal(corrected.corrected,true);
assert.match(corrected.explanation,/3\.450 BD/);
assert.match(corrected.explanation,/3\.150 BD/);
assert.equal(check(beef,currentBarcode,900,3500,3150,
  {verified_price_prefix:"966777"}).ok,true,
  "Corrected printed total must validate with original weight and barcode");

scanned.total="3.450";
scanned.manualCorrections={total:true};
assert.equal(ocr.manualConflictStatus(scanned,core).unresolved,true,
  "Re-entering the same invalid OCR amount must remain blocked");
scanned.total="3.150";scanned.manualCorrections={};
assert.equal(ocr.manualConflictStatus(scanned,core).unresolved,true,
  "A correction must be an explicit user edit, not an unexplained auto-change");
assert.equal(check(beef,currentBarcode,900,3500,3155,
  {verified_price_prefix:"966777"}).ok,false,
  "Even 0.005 BD price differences must be rejected");
console.log("OCR correction test passed: manually correcting 3.450 to 3.150 resolves stale mismatch while preserving EAN, rate and weight validation.");

const js=fs.readFileSync(path.join(root,"barcode-learning.js"),"utf8");
const css=fs.readFileSync(path.join(root,"barcode-learning.css"),"utf8");
for(const required of [
  "function scannedAgreement(p)","function syncConfirmation(p)","core.labelAgreement(",
  "p.saveControl.disabled=!enabled","p.saveControl.classList.toggle(\"is-ready\",enabled)",
  "p.readyNode.textContent","input.addEventListener(\"input\",e=>{",
  "syncConfirmation(p);","const agreement=scannedAgreement(p);",
  "if(!agreement.ok)return showError(p,agreement.message);",
  "p.saveControl=save;","syncConfirmation(p);",
  "ocrParser.manualConflictStatus(p,core)",
  "p.manualCorrections={...p.manualCorrections,[key]:true};",
  "p.conflictDescription.textContent=conflict.explanation"
]){
  assert.ok(js.includes(required),"Missing live confirmation condition: "+required);
}
assert.ok(css.includes(".learn-confirm-button.is-ready:not(:disabled)"));
assert.ok(css.includes(".learn-confirm-button.is-not-ready"));
assert.ok(css.includes(".learn-confirm-status.is-mismatch"));
console.log("Confirm readiness tests passed: salmon 0.002 kg, rejected OCR weight swap, cheese 0.460 kg, missing values, invalid EAN, rate and price mismatches, and live button/save gating.");
