const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const core=require("../barcode-learning-core.js");
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
const js=fs.readFileSync(path.join(root,"barcode-learning.js"),"utf8");
const css=fs.readFileSync(path.join(root,"barcode-learning.css"),"utf8");
for(const required of [
  "function scannedAgreement(p)","function syncConfirmation(p)","core.labelAgreement(",
  "p.saveControl.disabled=!enabled","p.saveControl.classList.toggle(\"is-ready\",enabled)",
  "p.readyNode.textContent","input.addEventListener(\"input\",e=>{",
  "syncConfirmation(p);","const agreement=scannedAgreement(p);",
  "if(!agreement.ok)return showError(p,agreement.message);",
  "p.saveControl=save;","syncConfirmation(p);"
]){
  assert.ok(js.includes(required),"Missing live confirmation condition: "+required);
}
assert.ok(css.includes(".learn-confirm-button.is-ready:not(:disabled)"));
assert.ok(css.includes(".learn-confirm-button.is-not-ready"));
assert.ok(css.includes(".learn-confirm-status.is-mismatch"));
console.log("Confirm readiness tests passed: salmon 0.002 kg, rejected OCR weight swap, cheese 0.460 kg, missing values, invalid EAN, rate and price mismatches, and live button/save gating.");
