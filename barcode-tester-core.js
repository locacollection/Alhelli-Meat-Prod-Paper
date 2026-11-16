/* Independent barcode tester: interpret an EAN against ALL saved private
   profiles, versions and exact labels, never the selected learning profile.
   Read-only. Returned results distinguish records from learned estimates. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.BarcodeTesterCore=api;
})(typeof window!=="undefined"?window:null,function(){
"use strict";
function evaluate(raw,{profiles=[],examples=[],custom=[],catalog=[]}={},core){
  const barcode=core?.cleanBarcode(raw)||"";
  if(!core||!core.validBarcode(barcode))
    return {barcode,invalid:true,results:[],notes:["Enter a valid 13-digit EAN-13 barcode with a correct check digit."]};
  const matching=new Set();
  const results=[],notes=[];
  const profileIndex=new Map(profiles.map(p=>[p.id,p]));
  // The label family is encoded by the protected meat prefix, not by a
  // manually assigned profile. Never trust a 966781 sticker as item 6780.
  const meatCodes=new Set(["6777","6780","6781"]);
  const barcodeMeatCode=barcode.startsWith("96")&&meatCodes.has(barcode.slice(2,6))?
    barcode.slice(2,6):null;
  function wronglyAssigned(itemCode){
    return barcodeMeatCode&&String(itemCode)!==barcodeMeatCode;
  }
  const badAssignments=new Set();
  function rejectWrongItem(itemCode,source){
    if(!wronglyAssigned(itemCode))return false;
    badAssignments.add(source+" assigned to "+itemCode);
    return true;
  }
  function push(data,identity){
    if(matching.has(identity))return;
    matching.add(identity);results.push(data);
  }
  function savedProfileResult(profile,row){
    const weight=Number(row.weight_grams),total=Number(row.total_price_fils);
    const rate=Number(profile.unit_price_fils);
    const calc=core.roundedPrice(weight,rate,Number(profile.rounding_fils));
    const valid=core.sampleCheck({barcode,weight_grams:weight,total_price_fils:total},profile);
    const prefix=String(profile.barcode_prefix||"");
    const prefixOk=!prefix||barcode.startsWith(prefix);
    const consistent=valid.ok&&prefixOk&&calc===total;
    return {
      source:"learning",profileId:profile.id,
      title:profile.product_name,itemCode:profile.item_code,
      priceVersion:Number(profile.price_version)||1,
      archived:!!profile.archived_at,
      weightGrams:weight,unitRate:rate,totalFils:total,
      verified:row.verified_from_label===true&&consistent,
      exact:true,ambiguous:false,
      note:consistent?
        "Exact barcode found in saved training labels. Compare the physical sticker with this stored weight and price.":
        "This saved label conflicts with its price profile or barcode format. Review the original label before use."
    };
  }
  for(const e of examples){
    if(String(e.barcode)!==barcode)continue;
    const p=profileIndex.get(e.profile_id);
    if(!p){notes.push("An exact saved example has no matching accessible profile. Review saved training records.");continue}
    if(rejectWrongItem(p.item_code,"Training example"))continue;
    const row=savedProfileResult(p,e);
    push(row,"learning:"+p.id+":"+row.weightGrams+":"+row.totalFils);
  }
  for(const row of custom){
    if(String(row.barcode)!==barcode)continue;
    if(rejectWrongItem(row.item_code,"Saved barcode"))continue;
    const pcs=row.unit_type==="pcs"?Number(row.quantity_pieces):null;
    const grams=pcs===null?Number(row.weight_grams):null;
    const rate=Number(row.unit_price_fils);
    const total=row.total_price_fils===null?null:Number(row.total_price_fils);
    push({
      source:"custom",title:row.product_name,itemCode:row.item_code,
      weightGrams:Number.isSafeInteger(grams)?grams:null,
      pieces:Number.isSafeInteger(pcs)?pcs:null,
      unitRate:Number.isSafeInteger(rate)?rate:null,
      totalFils:Number.isSafeInteger(total)?total:null,
      exact:true,verified:false,ambiguous:false,
      note:"Exact barcode in Saved Barcodes. This is a database record, not an independent reading of the current sticker."
    },"custom:"+row.barcode+":"+row.item_code);
  }
  for(const row of catalog){
    if(String(row.ean13)!==barcode)continue;
    if(rejectWrongItem(row.item_code,"Catalog record"))continue;
    push({
      source:"catalog",title:row.product_name,itemCode:row.item_code,
      weightGrams:Number(row.weight_grams),unitRate:Number(row.unit_price_fils_per_kg),
      totalFils:Number(row.total_price_fils),exact:true,
      verified:row.label_verified===true,ambiguous:false,
      note:row.label_verified===true?
        "Exact barcode marked as verified in the meat catalog. Check the printed label.":
        "This catalog barcode was calculated or stored without physical-label verification."
    },"catalog:"+row.ean13+":"+row.item_code+":"+row.weight_grams+":"+row.unit_price_fils_per_kg);
  }
  const known=new Set(results.filter(r=>r.source==="learning").map(r=>r.profileId));
  const matchingProfiles=profiles.filter(p=>{
    if(String(p.barcode_prefix||"")!==barcode.slice(0,6))return false;
    return !rejectWrongItem(p.item_code,"Learning profile");
  });
  for(const p of matchingProfiles){
    if(known.has(p.id))continue;
    if(p.review_status!=="validated")continue;
    const decoded=core.decodeLearned(barcode,p);
    if(decoded.ok){
      push({
        source:"pattern",profileId:p.id,title:p.product_name,itemCode:p.item_code,
        priceVersion:Number(p.price_version)||1,archived:!!p.archived_at,
        weightGrams:decoded.weight_grams,unitRate:decoded.unit_price_fils,
        totalFils:decoded.price_fils,exact:false,verified:false,ambiguous:false,
        note:"Weight and total inferred from a validated learning pattern. This exact barcode was not found in this profile's saved training examples. Verify against the printed sticker."
      },"pattern:"+p.id);
    }else if(decoded.ambiguous){
      push({
        source:"ambiguous",profileId:p.id,title:p.product_name,itemCode:p.item_code,
        priceVersion:Number(p.price_version)||1,archived:!!p.archived_at,
        weightGrams:null,unitRate:Number(p.unit_price_fils),
        totalFils:Number(decoded.price_fils),exact:false,verified:false,ambiguous:true,
        possibleWeights:(decoded.possible_grams||[]).slice(0,10),
        note:"The barcode encodes a price, but several weights fit this rate. It cannot establish an exact weight. Check the printed sticker."
      },"ambiguous:"+p.id);
    }
  }
  // Different tables or price versions may contain the *same* item,
  // weight, rate and total. Show one result per DISTINCT reading and keep
  // references to additional sources; do not erase any saved database rows.
  const sourceName=r=>{
    if(r.source==="learning")return r.verified?
      "Confirmed training label":"Saved training example";
    if(r.source==="catalog")return r.verified?
      "Verified catalog label":"Unverified catalog record";
    if(r.source==="custom")return "Saved Barcodes record";
    if(r.source==="pattern")return "Learned pattern";
    return "Ambiguous learned pattern";
  };
  const priority=r=>{
    if(r.source==="learning"&&r.verified)return 0;
    if(r.source==="catalog"&&r.verified)return 1;
    if(r.source==="custom")return 2;
    if(r.source==="learning")return 3;
    if(r.source==="catalog")return 4;
    if(r.source==="pattern")return 5;
    return 6;
  };
  const grouped=new Map();
  for(const r of results){
    const key=[r.itemCode,Number.isInteger(r.weightGrams)?r.weightGrams:"unknown",
      Number.isInteger(r.pieces)?r.pieces:"none",
      Number.isInteger(r.unitRate)?r.unitRate:"unknown",
      Number.isInteger(r.totalFils)?r.totalFils:"unknown"].join(":");
    const old=grouped.get(key);
    if(!old){
      grouped.set(key,{...r,otherSources:[],_sources:new Set([sourceName(r)])});
      continue;
    }
    const preferred=priority(r)<priority(old)?r:old;
    const references=old._sources;
    references.add(sourceName(r));
    grouped.set(key,{...preferred,
      otherSources:[...references].filter(label=>label!==sourceName(preferred)),
      _sources:references});
  }
  const consolidated=[...grouped.values()].map(({_sources,...r})=>r)
    .sort((a,b)=>priority(a)-priority(b));
  if(badAssignments.size){
    notes.push("Some saved records have the wrong product assignment ("+
      [...badAssignments].join("; ")+"). Barcode "+barcode.slice(0,6)+
      " identifies item "+barcodeMeatCode+
      ". Those records were excluded from results. Review the mistaken training examples in Barcode Learning.");
  }
  const verifiedReadings=new Set(consolidated.filter(r=>r.exact).map(r=>[
    r.itemCode,r.weightGrams,r.pieces,r.unitRate,r.totalFils
  ].join(":")));
  if(verifiedReadings.size>1)notes.push(
    "Several saved records match this barcode but disagree about item, weight or price. Check the printed sticker; do not select one automatically.");
  const distinctReadings=new Set(consolidated.filter(r=>Number.isInteger(r.weightGrams)||
    Number.isInteger(r.pieces)).map(r=>[
    r.itemCode,r.weightGrams,r.pieces,r.unitRate,r.totalFils
  ].join(":")));
  if(distinctReadings.size>1&&!notes.some(n=>n.startsWith("Several saved records")))
    notes.push("Different weights or unit prices are possible for this barcode. Inspect the printed sticker to identify the correct one.");
  if(!consolidated.length){
    if(matchingProfiles.length)notes.push(
      "A saved item matches the barcode prefix, but there is no exact saved record or usable validated decoding result. Check the label or train the item.");
    else if(!badAssignments.size)notes.push(
      "No saved barcode or validated learning profile matches this number. Add the real label in Barcode Learning or Saved Barcodes.");
  }
  return {barcode,invalid:false,results:consolidated,notes};
}
return {evaluate};
});