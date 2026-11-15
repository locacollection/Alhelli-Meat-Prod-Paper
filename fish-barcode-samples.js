/* Photo-confirmed salmon labels, 15 Nov 2026.
   The examples encode total price, NOT exact weight. A rate may change.
   No barcode here grants checkout authorization or auto-confirms production. */
(function(root,factory){
  const obj=factory();
  if(typeof module==="object"&&module.exports)module.exports=obj;
  if(root)root.SalmonBarcodeSamples=obj;
})(typeof window!=="undefined"?window:null,function(){
"use strict";
const PRODUCTS=Object.freeze({
  "6376":Object.freeze({item_code:"6376",product_name:"Atlantic Salmon Fish",
    barcode_prefix:"966376",weight_step_grams:2,unit_price_fils:5490,rounding_fils:5}),
  "6668":Object.freeze({item_code:"6668",product_name:"Salmon Fillet Fish (With Skin)",
    barcode_prefix:"966668",weight_step_grams:2,unit_price_fils:8750,rounding_fils:5}),
  "7144":Object.freeze({item_code:"7144",product_name:"Salmon Fish Bone",
    barcode_prefix:"967144",weight_step_grams:2,unit_price_fils:1000,rounding_fils:5})
});
const EXAMPLES=Object.freeze([
  // Whole fish: 4 different printed weights, price 5.490 BD/kg.
  Object.freeze({item_code:"6376",barcode:"9663761000101",weight_grams:2,total_price_fils:10}),
  Object.freeze({item_code:"6376",barcode:"9663761000354",weight_grams:6,total_price_fils:35}),
  Object.freeze({item_code:"6376",barcode:"9663763000550",weight_grams:10,total_price_fils:55}),
  Object.freeze({item_code:"6376",barcode:"9663760001109",weight_grams:20,total_price_fils:110}),
  // Fillet: 4 different printed weights, price 8.750 BD/kg.
  Object.freeze({item_code:"6668",barcode:"9666682000205",weight_grams:2,total_price_fils:20}),
  Object.freeze({item_code:"6668",barcode:"9666683000556",weight_grams:6,total_price_fils:55}),
  Object.freeze({item_code:"6668",barcode:"9666689000901",weight_grams:10,total_price_fils:90}),
  Object.freeze({item_code:"6668",barcode:"9666684001750",weight_grams:20,total_price_fils:175}),
  // Salmon bones: 3 distinct labels, price 1.000 BD/kg.
  // Even one of these exact EANs can represent multiple 2 g weights.
  Object.freeze({item_code:"7144",barcode:"9671449000053",weight_grams:4,total_price_fils:5}),
  Object.freeze({item_code:"7144",barcode:"9671441000105",weight_grams:8,total_price_fils:10}),
  Object.freeze({item_code:"7144",barcode:"9671442000203",weight_grams:22,total_price_fils:20})
]);
function examplesFor(code){return EXAMPLES.filter(e=>e.item_code===String(code))}
function checkExamples(core){
  if(!core)throw new Error("Barcode Learning engine unavailable");
  for(const [code,product] of Object.entries(PRODUCTS)){
    for(const row of examplesFor(code)){
      const valid=core.sampleCheck(row,product);
      if(!valid.ok)throw new Error("Invalid salmon sample "+row.barcode+": "+valid.reason);
      if(row.barcode.slice(0,6)!==product.barcode_prefix)throw new Error("Wrong salmon prefix");
      if(Number(row.barcode[6])!==core.priceVerifier(row.total_price_fils))
        throw new Error("Price verifier mismatch in "+row.barcode);
      if(Number(row.barcode.slice(7,12))!==row.total_price_fils)
        throw new Error("Encoded total mismatch in "+row.barcode);
    }
  }
  return true;
}
function analyzedProfiles(core){
  checkExamples(core);
  return Object.fromEntries(Object.keys(PRODUCTS).map(code=>{
    const samples=examplesFor(code);
    const outcome=core.analyze(samples,PRODUCTS[code]);
    return [code,{...PRODUCTS[code],...outcome,
      item_code:code,product_name:PRODUCTS[code].product_name,
      sample_count:samples.length}];
  }));
}
function match(raw,core){
  if(!core||!core.validBarcode(raw))return null;
  const barcode=core.cleanBarcode(raw);
  const product=Object.values(PRODUCTS).find(p=>barcode.slice(0,6)===p.barcode_prefix);
  if(!product)return null;
  const total=Number(barcode.slice(7,12));
  if(Number(barcode[6])!==core.priceVerifier(total))return null;
  // This is a confirmed price-verifier/price-suffix *format*, not a
  // signed-off merchant catalog. The fish weights are price-derived hints.
  const checked=core.analyze(examplesFor(product.item_code),product);
  let weight=null,possible=[];
  if(checked.status==="validated"&&checked.mode==="price5_verified"){
    const profile={...product,pattern_mode:checked.mode,review_status:checked.status};
    const decoded=core.decodeLearned(barcode,profile);
    if(decoded.ok)weight=decoded.weight_grams;
    else if(decoded.ambiguous)possible=decoded.possible_grams||[];
  }
  // Bone labels only have 3 examples. Enumerate possible printed weights,
  // but NEVER choose an exact gram value based on an identical barcode.
  if(weight===null){
    const candidates=[];
    for(let grams=product.weight_step_grams;grams<=100000;grams+=product.weight_step_grams){
      if(core.roundedPrice(grams,product.unit_price_fils,product.rounding_fils)===total){
        candidates.push(grams);
        if(candidates.length>20)break;
      }
    }
    possible=candidates;
  }
  return {
    product_code:product.item_code,product_name:product.product_name,
    barcode,unit_price_fils:product.unit_price_fils,price_fils:total,
    weight_grams:weight,possible_grams:possible.slice(0,10),
    based_on_samples:true,training_count:examplesFor(product.item_code).length,
    source:weight===null?
      "Price verified from barcode. Weight requires printed sticker.":
      "Weight inferred from price and 2 g steps; confirm printed sticker."
  };
}
return {PRODUCTS,EXAMPLES,examplesFor,checkExamples,analyzedProfiles,match};
});