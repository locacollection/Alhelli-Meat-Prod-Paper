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
    const row=savedProfileResult(p,e);
    push(row,"learning:"+p.id+":"+row.weightGrams+":"+row.totalFils);
  }
  for(const row of custom){
    if(String(row.barcode)!==barcode)continue;
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
  const matchingProfiles=profiles.filter(p=>String(p.barcode_prefix||"")===barcode.slice(0,6));
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
  const rawExact=results.filter(r=>r.exact);
  if(rawExact.length>1){
    const unique=new Set(rawExact.map(r=>[
      r.itemCode,r.weightGrams,r.pieces,r.unitRate,r.totalFils
    ].join(":")));
    if(unique.size>1)notes.push(
      "Several saved records match this barcode but disagree about item, weight or price. Check the physical sticker; do not select one automatically.");
  }
  const trained=results.filter(r=>r.source==="pattern"||r.source==="ambiguous");
  if(trained.length>1)notes.push(
    "This barcode also matches more than one saved price version or learned pattern. A barcode alone may not identify the original price period.");
  if(!results.length){
    if(matchingProfiles.length)notes.push(
      "A saved item matches the barcode prefix, but there is no exact saved record or usable validated decoding result. Check the label or train the item.");
    else notes.push(
      "No saved barcode or validated learning profile matches this number. Add the real label in Barcode Learning or Saved Barcodes.");
  }
  return {barcode,invalid:false,results,notes};
}
return {evaluate};
});