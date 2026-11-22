/* Photo-confirmed salmon labels, 21–22 Nov 2026.
   Barcode values reconstructed from the visible product code + total-price digits,
   then EAN-13 verifier/check digit calculated. Weights/totals are transcribed
   from labels; one bone label is within 5 fils of calculated total. */
(function(root,factory){
  const obj=factory();
  if(typeof module==="object"&&module.exports)module.exports=obj;
  if(root)root.SalmonBarcodeSamples=obj;
})(typeof window!=="undefined"?window:null,function(){
"use strict";
const PRODUCTS=Object.freeze({
  "6376":Object.freeze({item_code:"6376",product_name:"Atlantic Salmon Fish",barcode_prefix:"966376",weight_step_grams:1,unit_price_fils:5390,rounding_fils:5,sample_price_tolerance_fils:5}),
  "6668":Object.freeze({item_code:"6668",product_name:"Salmon Fillet Fish (With Skin)",barcode_prefix:"966668",weight_step_grams:1,unit_price_fils:8450,rounding_fils:5,sample_price_tolerance_fils:5}),
  "7144":Object.freeze({item_code:"7144",product_name:"Salmon Fish Bone",barcode_prefix:"967144",weight_step_grams:1,unit_price_fils:1000,rounding_fils:5,sample_price_tolerance_fils:5})
});
const EXAMPLES=Object.freeze([
  Object.freeze({item_code:"6376",barcode:"9663766400203",weight_grams:7425,total_price_fils:40020}),
  Object.freeze({item_code:"6376",barcode:"9663763212151",weight_grams:3936,total_price_fils:21215}),
  Object.freeze({item_code:"6376",barcode:"9663764205701",weight_grams:3816,total_price_fils:20570}),
  Object.freeze({item_code:"6376",barcode:"9663768199204",weight_grams:3696,total_price_fils:19920}),
  Object.freeze({item_code:"6376",barcode:"9663764214208",weight_grams:3974,total_price_fils:21420}),
  Object.freeze({item_code:"6376",barcode:"9663766183908",weight_grams:3412,total_price_fils:18390}),
  Object.freeze({item_code:"6668",barcode:"9666689397155",weight_grams:4700,total_price_fils:39715}),
  Object.freeze({item_code:"6668",barcode:"9666681228150",weight_grams:2700,total_price_fils:22815}),
  Object.freeze({item_code:"6668",barcode:"9666683214106",weight_grams:2534,total_price_fils:21410}),
  Object.freeze({item_code:"6668",barcode:"9666689205351",weight_grams:2430,total_price_fils:20535}),
  Object.freeze({item_code:"6668",barcode:"9666688224452",weight_grams:2656,total_price_fils:22445}),
  Object.freeze({item_code:"6668",barcode:"9666685188450",weight_grams:2230,total_price_fils:18845}),
  Object.freeze({item_code:"7144",barcode:"9671442024056",weight_grams:2404,total_price_fils:2405}),
  Object.freeze({item_code:"7144",barcode:"9671447011204",weight_grams:1116,total_price_fils:1120}),
  Object.freeze({item_code:"7144",barcode:"9671448011500",weight_grams:1152,total_price_fils:1150}),
  Object.freeze({item_code:"7144",barcode:"9671446011557",weight_grams:1155,total_price_fils:1155}),
  Object.freeze({item_code:"7144",barcode:"9671442011803",weight_grams:1182,total_price_fils:1180}),
  Object.freeze({item_code:"7144",barcode:"9671440010709",weight_grams:1068,total_price_fils:1070})
]);
function examplesFor(code){return EXAMPLES.filter(e=>e.item_code===String(code))}
function checkExamples(core){
  if(!core)throw new Error("Barcode Learning engine unavailable");
  for(const [code,product] of Object.entries(PRODUCTS)){
    for(const row of examplesFor(code)){
      const barcode=core.cleanBarcode(row.barcode);
      if(!core.validBarcode(barcode))throw new Error("Invalid EAN-13 sample "+row.barcode);
      if(barcode.slice(0,6)!==product.barcode_prefix)throw new Error("Wrong salmon sample prefix");
      if(Number(barcode[6])!==core.priceVerifier(row.total_price_fils))throw new Error("Price verifier mismatch in "+row.barcode);
      if(Number(barcode.slice(7,12))!==row.total_price_fils)throw new Error("Encoded total mismatch in "+row.barcode);
      const expected=core.roundedPrice(row.weight_grams,product.unit_price_fils,product.rounding_fils);
      if(Math.abs(expected-row.total_price_fils)>product.sample_price_tolerance_fils)
        throw new Error("Weight/total discrepancy exceeds 5 fils for "+row.barcode);
    }
  }
  return true;
}
function analyzedProfiles(core){
  checkExamples(core);
  return Object.fromEntries(Object.keys(PRODUCTS).map(code=>{
    const samples=examplesFor(code),outcome=core.analyze(samples,PRODUCTS[code]);
    return [code,{...PRODUCTS[code],...outcome,item_code:code,product_name:PRODUCTS[code].product_name,sample_count:samples.length}];
  }));
}
function match(raw,core){
  if(!core||!core.validBarcode(raw))return null;
  const barcode=core.cleanBarcode(raw),product=Object.values(PRODUCTS).find(p=>barcode.slice(0,6)===p.barcode_prefix);
  if(!product)return null;
  const total=Number(barcode.slice(7,12));
  if(Number(barcode[6])!==core.priceVerifier(total))return null;
  const checked=core.analyze(examplesFor(product.item_code),product);
  let weight=null,possible=[];
  if(checked.status==="validated"&&checked.mode==="price5_verified"){
    const profile={...product,pattern_mode:checked.mode,review_status:checked.status};
    const decoded=core.decodeLearned(barcode,profile);
    if(decoded.ok)weight=decoded.weight_grams;else if(decoded.ambiguous)possible=decoded.possible_grams||[];
  }
  if(weight===null){
    const candidates=[];
    for(let grams=1;grams<=100000;grams+=1)if(core.roundedPrice(grams,product.unit_price_fils,product.rounding_fils)===total){candidates.push(grams);if(candidates.length>20)break}
    possible=candidates;
  }
  return {product_code:product.item_code,product_name:product.product_name,barcode,unit_price_fils:product.unit_price_fils,price_fils:total,
    weight_grams:weight,possible_grams:possible.slice(0,10),based_on_samples:true,training_count:examplesFor(product.item_code).length,
    source:weight===null?"Price verified from barcode. Weight requires printed sticker.":"Weight inferred from price and 1 g samples; confirm printed sticker."};
}
return {PRODUCTS,EXAMPLES,examplesFor,checkExamples,analyzedProfiles,match};
});
