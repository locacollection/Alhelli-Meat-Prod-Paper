const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const core=require("../barcode-learning-core.js");
const fish=require("../fish-barcode-samples.js");
assert.equal(fish.checkExamples(core),true);
assert.equal(fish.EXAMPLES.length,11);
for(const [code,count] of [["6376",4],["6668",4],["7144",3]])
  assert.equal(fish.examplesFor(code).length,count,"Wrong salmon example count");
const profiles=fish.analyzedProfiles(core);
assert.equal(profiles["6376"].status,"validated");
assert.equal(profiles["6376"].mode,"price5_verified");
assert.equal(profiles["6668"].status,"validated");
assert.equal(profiles["6668"].mode,"price5_verified");
assert.equal(profiles["7144"].status,"collecting","Three bone labels are not enough for full profile validation.");
for(const sample of fish.EXAMPLES){
  assert.equal(core.validBarcode(sample.barcode),true);
  const match=fish.match(sample.barcode,core);
  assert.ok(match,"Missing tested sample barcode "+sample.barcode);
  assert.equal(match.product_code,sample.item_code);
  assert.equal(match.price_fils,sample.total_price_fils);
  assert.equal(match.unit_price_fils,fish.PRODUCTS[sample.item_code].unit_price_fils);
  if(sample.item_code==="7144"){
    assert.equal(match.weight_grams,null,
      "Bone price barcode does not specify exact gram weight, even for known examples");
    assert.ok(match.possible_grams.length>1);
  }else{
    assert.equal(match.weight_grams,sample.weight_grams,
      "Uniquely inferred 2g weights must match printed labels");
  }
}
assert.equal(fish.match("9671442000203",core).weight_grams,null);
assert.ok(fish.match("9671442000203",core).possible_grams.includes(20));
assert.ok(fish.match("9671442000203",core).possible_grams.includes(22));
assert.equal(fish.match("9667800031057",core),null,"Do not treat beef as salmon");
assert.equal(fish.match("9666684001751",core),null,"Reject bad EAN check digit");
assert.equal(fish.match("9666689001750",core),null,"Reject bad price verifier");
// A future valid price barcode may not decode at the rate learned from these
// dated labels. The user must confirm the printed price and weight.
const files=["fish-production.html","barcode-learning.html"];
for(const filename of files){
 const html=fs.readFileSync(path.join(__dirname,"..",filename),"utf8");
 assert.ok(html.includes("fish-barcode-samples.js"),filename+" must load pictured salmon examples");
}
const workflow=fs.readFileSync(path.join(__dirname,"..",".github/workflows/deploy-pages.yml"),"utf8");
assert.ok(workflow.includes("fish-barcode-samples.js"));
const learning=fs.readFileSync(path.join(__dirname,"..","barcode-learning.js"),"utf8");
assert.ok(learning.includes("importSalmonExamples"));
assert.ok(learning.includes("verified_from_label:true"));
const scan=fs.readFileSync(path.join(__dirname,"..","fish-production.js"),"utf8");
assert.ok(scan.includes("hasWeight&&!"));
assert.ok(scan.includes("Barcode price cannot identify one exact weight"));
console.log("Salmon sample tests passed: all 11 pictured EANs, three prefixes, verifier, 2g weights, guarded 7144 collisions and private import.");
