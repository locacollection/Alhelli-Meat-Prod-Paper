/* Barcode Learning: infer kg-label patterns only from independently confirmed
   printed examples. This does not add checkout-valid barcodes or alter recipes. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.BarcodeLearningCore=api;
})(typeof window!=="undefined"?window:null,function(){
"use strict";
const MODES={
  price5_verified:"5-digit price + verified internal check digit",
  price5_unverified:"5-digit price; internal digit unknown",
  price6:"6-digit encoded total price",
  weight5:"5-digit encoded grams",
  weight6:"6-digit encoded grams"
};
const EXPERIMENTAL=new Set(["price5_unverified"]);
const KNOWN_MEAT_PREFIXES=new Set(["966777","966780","966781"]);
function cleanBarcode(input){return String(input||"").replace(/[\s-]/g,"")}
function checkDigit(twelve){
  if(!/^\d{12}$/.test(twelve))return null;
  let sum=0;
  for(let i=0;i<12;i++)sum+=Number(twelve[i])*(i%2?3:1);
  return (10-sum%10)%10;
}
function validBarcode(value){
  const s=cleanBarcode(value);
  return /^\d{13}$/.test(s)&&Number(s[12])===checkDigit(s.slice(0,12));
}
const fivePlus=[0,5,1,6,2,7,3,8,4,9];
const twoMinus=[0,2,4,6,8,9,1,3,5,7];
const fiveMinus=[0,5,9,4,8,3,7,2,6,1];
const inverseFiveMinus=[0,9,7,5,3,1,8,6,4,2];
function priceVerifier(fils){
  if(!Number.isSafeInteger(fils)||fils<0||fils>99999)return null;
  const digits=String(fils).padStart(5,"0");
  const maps=[fivePlus,twoMinus,fiveMinus,fivePlus,twoMinus];
  let sum=0;
  for(let i=0;i<5;i++)sum+=maps[i][Number(digits[i])];
  return inverseFiveMinus[(10-sum%10)%10];
}
function parseAmount(input){
  const raw=String(input??"").trim().replace(",",".");
  if(!/^\d{1,3}(?:\.\d{1,3})?$/.test(raw))return null;
  const [whole,part=""]=raw.split(".");
  const amount=Number(whole)*1000+Number(part.padEnd(3,"0"));
  return Number.isSafeInteger(amount)?amount:null;
}
function formatAmount(v){return (v/1000).toFixed(3)}
function roundedPrice(grams,rate,rounding=5){
  if(!Number.isSafeInteger(grams)||!Number.isSafeInteger(rate)||![1,5].includes(rounding))return null;
  return Math.floor((grams*rate+rounding*500)/ (rounding*1000))*rounding;
}
function profileConfig(config){
  const step=Number(config.weight_step_grams);
  const rate=Number(config.unit_price_fils);
  const rounding=Number(config.rounding_fils);
  const code=String(config.item_code||"").trim();
  const name=String(config.product_name||"").trim();
  if(!/^[\w -]{1,32}$/.test(code))throw new Error("Enter an item/PLU code (up to 32 characters).");
  if(!name||name.length>120)throw new Error("Enter an item name.");
  if(![1,2,5,10].includes(step))throw new Error("Choose 1, 2, 5 or 10 gram increments.");
  if(!Number.isInteger(rate)||rate<1||rate>999999)throw new Error("Enter the unit price in BD per kg.");
  if(![1,5].includes(rounding))throw new Error("Choose 1 or 5 fils price rounding.");
  return {item_code:code,product_name:name,weight_step_grams:step,unit_price_fils:rate,rounding_fils:rounding};
}
function sampleCheck(sample,config){
  const barcode=cleanBarcode(sample.barcode);
  if(!validBarcode(barcode))return {ok:false,reason:"Invalid barcode or EAN-13 check digit."};
  // A valid EAN/checksum and matching price cannot make a 6781 label a
  // 6780 training example. Guard the protected meat item prefixes.
  const expectedMeatPrefix="96"+String(config?.item_code??"");
  if(KNOWN_MEAT_PREFIXES.has(expectedMeatPrefix)&&
     barcode.slice(0,6)!==expectedMeatPrefix)
    return {ok:false,reason:"Barcode prefix "+barcode.slice(0,6)+
      " is not the "+expectedMeatPrefix+" prefix for item "+config.item_code+
      ". Select the correct meat item profile before saving."};
  if(sample.weight_grams===null||sample.weight_grams===undefined||
     sample.total_price_fils===null||sample.total_price_fils===undefined)
    return {ok:false,reason:"Printed weight and total price are both required."};
  const weight=Number(sample.weight_grams),price=Number(sample.total_price_fils);
  if(!Number.isSafeInteger(weight)||weight<1||weight>100000||weight%config.weight_step_grams!==0)
    return {ok:false,reason:"Weight must be a multiple of "+config.weight_step_grams+" grams (max 100 kg)."};
  if(!Number.isSafeInteger(price)||price<0||price>999999)
    return {ok:false,reason:"Enter the total price printed on this exact label."};
  const expected=roundedPrice(weight,config.unit_price_fils,config.rounding_fils);
  const tolerance=Number(config.sample_price_tolerance_fils||0);
  if(Math.abs(expected-price)>tolerance)
    return {ok:false,reason:"Printed weight × unit price gives "+formatAmount(expected)+
      " BD, not "+formatAmount(price)+" BD. Check the original label or price setting."};
  return {ok:true,barcode,weight,price,prefix:barcode.slice(0,6)};
}
/* One source of truth for the label's Save button and the actual save action.
   A correct EAN check digit alone does NOT prove a price-encoding rule.
   verified_price_prefix must come from a verified item format. */
function labelAgreement(fields,profile,options={}){
  const missing=(message)=>({ok:false,state:"missing",message});
  const invalid=(message)=>({ok:false,state:"mismatch",message});
  if(!profile)return missing("Select an item profile.");
  const b=cleanBarcode(fields?.barcode);
  if(!b)return missing("Scan or enter the 13-digit barcode.");
  if(!validBarcode(b))return invalid("Check the 13-digit barcode and check digit.");
  const expectedMeatPrefix="96"+String(profile.item_code);
  if(KNOWN_MEAT_PREFIXES.has(expectedMeatPrefix)&&b.slice(0,6)!==expectedMeatPrefix)
    return invalid("Barcode prefix "+b.slice(0,6)+" belongs to a different meat item. "+
      "Select "+profile.item_code+" only for "+expectedMeatPrefix+" labels.");
  if(options.expected_product_code&&String(options.expected_product_code)!==String(profile.item_code))
    return invalid("This barcode belongs to item "+options.expected_product_code+". Select that product.");
  if(options.printed_product_code&&String(options.printed_product_code)!==String(profile.item_code))
    return invalid("Printed item name differs from the selected profile.");
  const weight=Number(fields?.weight_grams),unit=Number(fields?.unit_price_fils);
  const total=Number(fields?.total_price_fils);
  if(fields?.weight_grams===null||fields?.weight_grams===undefined)
    return missing("Enter the printed weight.");
  if(fields?.unit_price_fils===null||fields?.unit_price_fils===undefined)
    return missing("Enter the unit price.");
  if(fields?.total_price_fils===null||fields?.total_price_fils===undefined)
    return missing("Enter the printed total price.");
  if(!Number.isSafeInteger(weight)||weight<1||weight>100000||
      weight%Number(profile.weight_step_grams)!==0)
    return invalid("Weight must follow the item's "+profile.weight_step_grams+" g increments.");
  if(!Number.isSafeInteger(unit)||unit!==Number(profile.unit_price_fils))
    return invalid("Unit price must match the selected item profile ("+
      formatAmount(Number(profile.unit_price_fils))+" BD/kg).");
  if(!Number.isSafeInteger(total)||total<0||total>999999)
    return invalid("Enter a valid printed total.");
  const expected=roundedPrice(weight,unit,Number(profile.rounding_fils));
  if(expected!==total)return invalid(formatAmount(weight)+" kg × "+
    formatAmount(unit)+" BD/kg rounds to "+formatAmount(expected)+
    " BD, not "+formatAmount(total)+" BD.");
  const prefix=String(options.verified_price_prefix||"");
  if(prefix){
    if(!/^\d{6}$/.test(prefix)||b.slice(0,6)!==prefix)
      return invalid("Barcode prefix does not match this item.");
    const price=Number(b.slice(7,12));
    if(Number(b[6])!==priceVerifier(price))
      return invalid("Barcode internal price check does not match.");
    if(price!==total)return invalid("Barcode encodes "+formatAmount(price)+
      " BD, not "+formatAmount(total)+" BD.");
  }
  return {ok:true,state:"ready",message:prefix?
    "All values match. Ready to confirm.":"Weight, rate and total match. EAN verified; price encoding not yet learned."};
}
function candidateMatches(mode,sample){
  const b=sample.barcode,w=sample.weight,p=sample.price;
  if(mode==="price5_verified")
    return p<=99999&&Number(b.slice(7,12))===p&&Number(b[6])===priceVerifier(p);
  if(mode==="price5_unverified")
    return p<=99999&&Number(b.slice(7,12))===p;
  if(mode==="price6")return p<=999999&&Number(b.slice(6,12))===p;
  if(mode==="weight5")return w<=99999&&Number(b.slice(7,12))===w;
  if(mode==="weight6")return w<=999999&&Number(b.slice(6,12))===w;
  return false;
}
function candidateList(samples){
  return Object.keys(MODES).filter(mode=>samples.every(x=>candidateMatches(mode,x)));
}
function distinct(values){return new Set(values).size}
function analyze(raw,rawConfig){
  const config=profileConfig(rawConfig);
  const checks=(raw||[]).map((x,i)=>({...sampleCheck(x,config),index:i+1}));
  const bad=checks.find(x=>!x.ok);
  if(bad)return {status:"collecting",error:"Sample "+bad.index+": "+bad.reason,
    candidates:[],config,barcode_prefix:"",sample_count:checks.length};
  if(checks.length===0)return {status:"collecting",error:"Scan at least 4 different labels.",
    candidates:[],config,barcode_prefix:"",sample_count:0};
  const examples=checks.map(x=>({barcode:x.barcode,weight:x.weight,price:x.price,prefix:x.prefix}));
  const prefix=examples[0].prefix;
  if(examples.some(x=>x.prefix!==prefix))return {status:"ambiguous",error:
    "These stickers do not share the same first 6 digits. Train each product and barcode family separately.",
    candidates:[],config,barcode_prefix:"",sample_count:examples.length};
  const repeated=new Map();
  for(const e of examples){
    const known=repeated.get(e.barcode);
    if(known &&(known.weight!==e.weight||known.price!==e.price))
      return {status:"ambiguous",error:"The same 13-digit barcode appears with different weights/prices. "+
        "A barcode alone cannot uniquely recover the printed weight.",config,candidates:[],
        barcode_prefix:prefix,sample_count:examples.length};
    repeated.set(e.barcode,e);
  }
  const count=examples.length;
  const result={status:"collecting",error:"",mode:"unknown",candidates:[],
    config,barcode_prefix:prefix,sample_count:count,
    distinct_weights:distinct(examples.map(e=>e.weight)),
    distinct_prices:distinct(examples.map(e=>e.price)),holdout_count:0};
  if(count<4||repeated.size<4||result.distinct_weights<3||result.distinct_prices<3){
    result.error="Add at least 4 different barcodes, with 3 distinct weights and totals.";
    result.candidates=candidateList(examples);
    return result;
  }
  // Determine hypotheses with the first three samples only. Hold out every
  // subsequent example as an independent check against any proposed rule.
  const train=examples.slice(0,3),holdout=examples.slice(3);
  const trained=candidateList(train);
  const tested=trained.filter(mode=>holdout.every(s=>candidateMatches(mode,s)));
  // Verified price5 is strictly stronger than unverified price5.
  const strong=tested.filter(mode=>mode!=="price5_unverified");
  const meaningful=strong.includes("price5_verified")?
    strong.filter(mode=>mode!=="price6"||train.some(s=>Number(s.barcode[6])!==0)):
    strong;
  // If a candidate has already matched an EAN barcode with the known
  // internal price verifier, do not treat its generic 5-digit suffix as a
  // distinct second pattern. But weight-vs-price ambiguity is still real.
  const filtered=meaningful.includes("price5_verified")?
    meaningful.filter(mode=>mode!=="price5_unverified"):meaningful;
  result.candidates=filtered.length?filtered:tested;
  result.holdout_count=holdout.length;
  if(result.candidates.length===1){
    result.mode=result.candidates[0];
    result.status=EXPERIMENTAL.has(result.mode)?"proposed":"validated";
    result.error=result.status==="validated"?"":
      "The price suffix fits, but its internal verifier is unknown. Pattern is only a proposal.";
  }else if(result.candidates.length>1){
    result.status="ambiguous";
    result.error="Multiple barcode formats match these labels. Scan more different weights or prices.";
  }else{
    result.status="ambiguous";
    result.error="No tested price or weight pattern explains all confirmed examples.";
  }
  return result;
}
function priceWeights(total,profile){
  const result=[];
  const max=100000,step=Number(profile.weight_step_grams);
  for(let grams=step;grams<=max;grams+=step){
    if(roundedPrice(grams,Number(profile.unit_price_fils),Number(profile.rounding_fils))===total){
      result.push(grams);
      if(result.length>60)break;
    }
  }
  return result;
}
function decodeLearned(raw,profile){
  const barcode=cleanBarcode(raw);
  if(!validBarcode(barcode))return {ok:false,error:"EAN-13 check digit is incorrect."};
  if(profile.review_status!=="validated"||!Object.hasOwn(MODES,profile.pattern_mode)||
      EXPERIMENTAL.has(profile.pattern_mode))
    return {ok:false,error:"This profile has no validated decoding pattern yet."};
  if(!/^\d{6}$/.test(profile.barcode_prefix)||barcode.slice(0,6)!==profile.barcode_prefix)
    return {ok:false,error:"Barcode prefix does not match this learned item."};
  const mode=profile.pattern_mode;
  const total=mode==="price5_verified"||mode==="price5_unverified"?
    Number(barcode.slice(7,12)):Number(barcode.slice(6,12));
  if(mode==="price5_verified"&&Number(barcode[6])!==priceVerifier(total))
    return {ok:false,error:"Internal price-verifier digit does not match."};
  const isPrice=mode.startsWith("price");
  const grams=isPrice?priceWeights(total,profile):[
    Number(barcode.slice(mode==="weight5"?7:6,12))
  ];
  if(!grams.length)return {ok:false,error:"Price is not consistent with this item's saved rate."};
  if(grams.length!==1)
    return {ok:false,ambiguous:true,error:"Barcode matches "+grams.length+
      (grams.length>60?"+":"")+" possible weights at this unit price. Check the printed weight.",
      possible_grams:grams.slice(0,10),price_fils:isPrice?total:null};
  const weight=grams[0];
  if(!Number.isInteger(weight)||weight<1||weight>100000||weight%profile.weight_step_grams)
    return {ok:false,error:"Decoded weight is outside the allowed gram increments."};
  const calculated=roundedPrice(weight,Number(profile.unit_price_fils),Number(profile.rounding_fils));
  return {ok:true,barcode,weight_grams:weight,price_fils:isPrice?total:calculated,
    unit_price_fils:Number(profile.unit_price_fils),item_code:profile.item_code,
    product_name:profile.product_name,mode,source:"Learned barcode pattern; verify printed label"};
}
/* A price-based barcode can be calculable without proving a unique weight.
   Only expose a candidate after a fully validated price-encoding rule and a
   verified EAN-13 checksum. This NEVER counts as a confirmed weight. */
function suggestBarcodeCandidate(weight,profile){
  if(!profile||profile.review_status!=="validated")
    return {ok:false,error:"Train and validate a profile first."};
  const grams=Number(weight),step=Number(profile.weight_step_grams);
  if(!Number.isSafeInteger(grams)||grams<1||grams>100000||
    ![1,2,5,10].includes(step)||grams%step!==0)
    return {ok:false,error:"Weight must follow the selected gram increment."};
  const mode=profile.pattern_mode,prefix=String(profile.barcode_prefix||"");
  if(!["price5_verified","price6"].includes(mode)||!/^[0-9]{6}$/.test(prefix))
    return {ok:false,error:"This profile has no validated price barcode format."};
  const total=roundedPrice(grams,Number(profile.unit_price_fils),Number(profile.rounding_fils));
  if(!Number.isSafeInteger(total)||total<0||
      (mode==="price5_verified"&&total>99999)||(mode==="price6"&&total>999999))
    return {ok:false,error:"Calculated price cannot fit this barcode format."};
  const first12=mode==="price5_verified"?
    prefix+priceVerifier(total)+String(total).padStart(5,"0"):
    prefix+String(total).padStart(6,"0");
  const barcode=first12+checkDigit(first12);
  if(!validBarcode(barcode))return {ok:false,error:"Cannot verify the predicted EAN-13 check digit."};
  const decoded=decodeLearned(barcode,profile);
  if(!decoded.ambiguous||decoded.price_fils!==total)
    return {ok:false,error:decoded.error||"The proposed barcode is not supported by the validated pattern."};
  return {ok:true,ambiguous:true,barcode,total_price_fils:total,weight_grams:grams,
    possible_grams:decoded.possible_grams||[],
    warning:"Calculated barcode candidate only. The barcode encodes "+formatAmount(total)+
      " BD, which can correspond to several weights. It does NOT verify "+
      formatAmount(grams)+" kg. Compare it with a real printed label. Not valid evidence for checkout, stock or production records."};
}
function suggestBarcode(weight,profile){
  if(profile.review_status!=="validated")return {ok:false,error:"Train and validate a profile first."};
  const grams=Number(weight),step=Number(profile.weight_step_grams);
  if(!Number.isSafeInteger(grams)||grams<1||grams>100000||grams%step)
    return {ok:false,error:"Weight must follow the selected gram increment."};
  const mode=profile.pattern_mode,prefix=profile.barcode_prefix;
  const total=roundedPrice(grams,Number(profile.unit_price_fils),Number(profile.rounding_fils));
  let first12=null;
  if(mode==="price5_verified"&&total<=99999)
    first12=prefix+priceVerifier(total)+String(total).padStart(5,"0");
  if(mode==="price6"&&total<=999999)
    first12=prefix+String(total).padStart(6,"0");
  if(mode==="weight6")
    first12=prefix+String(grams).padStart(6,"0");
  if(first12===null)return {ok:false,error:"The learned pattern cannot safely generate this barcode."};
  const barcode=first12+checkDigit(first12);
  const result=decodeLearned(barcode,profile);
  if(!result.ok||result.weight_grams!==grams)return {ok:false,error:
    "The predicted barcode is not unique for this weight. Use an actual printed sticker."};
  return {ok:true,barcode,total_price_fils:total,weight_grams:grams,
    warning:"Predicted by a learned pattern. Not authorized for checkout or stock recording."};
}
/* Compare a prediction to independently read, physical sticker fields.
   Checksum/pattern checks alone never authenticate a real store label. */
function verifyPredictedAgainstLabel({
  profile,predicted_barcode,requested_weight_grams,
  printed_barcode,printed_weight_grams,printed_total_fils
}={}){
  const errors=[];
  const predicted=cleanBarcode(predicted_barcode);
  const printed=cleanBarcode(printed_barcode);
  const grams=Number(requested_weight_grams);
  const stickerGrams=Number(printed_weight_grams);
  const stickerPrice=Number(printed_total_fils);
  if(!profile||profile.review_status!=="validated")
    return {ok:false,errors:["Select a validated item profile."]};
  if(!validBarcode(predicted))errors.push("The predicted barcode has an invalid EAN-13 check digit.");
  const strict=suggestBarcode(grams,profile);
  const candidate=!strict.ok?suggestBarcodeCandidate(grams,profile):null;
  const expected=strict.ok?strict:(candidate?.ok?candidate:null);
  if(!expected||expected.barcode!==predicted)
    errors.push("Prediction no longer matches the selected profile and entered weight. Predict again.");
  if(!validBarcode(printed))
    errors.push("The real sticker barcode must be 13 digits with a valid EAN-13 check digit.");
  else if(printed!==predicted)
    errors.push("Real sticker barcode differs from the predicted barcode.");
  if(!Number.isSafeInteger(stickerGrams)||stickerGrams<1||stickerGrams>100000||
      stickerGrams%Number(profile.weight_step_grams)!==0)
    errors.push("Enter the actual printed weight in this item's valid gram increments.");
  else if(stickerGrams!==grams)
    errors.push("Real sticker weight differs from the predicted weight.");
  const expectedPrice=roundedPrice(grams,Number(profile.unit_price_fils),Number(profile.rounding_fils));
  if(!Number.isSafeInteger(stickerPrice)||stickerPrice<0||stickerPrice>999999)
    errors.push("Enter the actual total price printed on the sticker.");
  else if(stickerPrice!==expectedPrice)
    errors.push("Real sticker total differs from the price calculated using the saved item rate.");
  return {ok:errors.length===0,errors,
    ambiguous_weight:!!expected?.ambiguous,expected_price_fils:expectedPrice,
    barcode:predicted};
}
return {MODES,cleanBarcode,validBarcode,checkDigit,priceVerifier,parseAmount,formatAmount,
  roundedPrice,profileConfig,sampleCheck,labelAgreement,candidateList,analyze,decodeLearned,suggestBarcode,suggestBarcodeCandidate,verifyPredictedAgainstLabel};
});