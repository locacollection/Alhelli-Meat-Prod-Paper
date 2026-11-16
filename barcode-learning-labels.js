/* Independently recognize printed weight, unit price, and total price
   from an individual label crop. Unknown or conflicting fields remain reviewable.
   Layout fallbacks use barcode location, not arbitrary numbers on other stickers. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.BarcodeLabelOCR=api;
})(typeof window!=="undefined"?window:null,function(){
"use strict";
const nameFor={6376:"Atlantic Salmon Fish",6668:"Salmon Fillet Fish (With Skin)",
  7144:"Salmon Fish Bone",6777:"Pakistani Beef With Bone",
  6780:"Pakistani Beef Minced",6781:"Pakistani Beef Without Bone"};
function normalized(input){
  return String(input??"").replace(/[٠-٩]/g,x=>String("٠١٢٣٤٥٦٧٨٩".indexOf(x)))
    .replace(/[۰-۹]/g,x=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(x)))
    .replace(/\u00a0/g," ").replace(/[，٫]/g,".").replace(/،/g,",");
}
function amount(token){
  const s=normalized(token).trim().replace(/,/g,".");
  if(!/^\d{1,3}\.\d{3}$/.test(s))return null;
  const [whole,frac]=s.split(".");
  const num=Number(whole)*1000+Number(frac);
  return num>=0&&num<=999999?num:null;
}
function detectProduct(text){
  const t=normalized(text).toUpperCase().replace(/\s+/g," ");
  if(/\bSALMON\b/.test(t)&&/\bBONE\b/.test(t))return "7144";
  if(/\bSALMON\b/.test(t)&&/\bFILLET\b/.test(t))return "6668";
  if(/ATLANTIC.{0,18}SALMON/.test(t))return "6376";
  if(/PAKISTAN(I)?\s+BEEF/.test(t)&&/\bMIN/.test(t))return "6780";
  if(/PAKISTAN(I)?\s+BEEF/.test(t)&&/(WITHOUT|W\s?\/\s?OUT|W\/O)/.test(t))return "6781";
  if(/PAKISTAN(I)?\s+BEEF/.test(t)&&/(W\s?\/\s?BON|WITH\s+BONE)/.test(t))return "6777";
  return null;
}
function boxesFromResult(result){
  const data=result?.data||result||{};
  const words=[];
  if(Array.isArray(data.words)&&data.words.length){
    for(const w of data.words){
      const value=normalized(w.text||"").trim();
      const box=w.bbox||{};
      const x0=Number(box.x0??box.left),x1=Number(box.x1??box.right);
      const y0=Number(box.y0??box.top),y1=Number(box.y1??box.bottom);
      if(!value||![x0,x1,y0,y1].every(Number.isFinite))continue;
      words.push({text:value,x:(x0+x1)/2,y:(y0+y1)/2,w:x1-x0,h:y1-y0,
        confidence:Number(w.confidence)||0});
    }
  }
  // Tesseract may join adjacent numeric glyphs into multiple tokens.
  const combined=[];
  for(let i=0;i<words.length;i++){
    combined.push(words[i]);
    const a=words[i],b=words[i+1];
    if(b&&/^\d{1,3}[.,]$/.test(a.text)&&/^\d{3}$/.test(b.text)&&
      Math.abs(b.y-a.y)<=Math.max(5,a.h*.6)&&b.x-a.x<Math.max(42,a.w*2.5)){
      combined.push({text:a.text+b.text,x:(a.x+b.x)/2,y:(a.y+b.y)/2,
        w:(b.x-a.x)+(a.w+b.w)/2,h:Math.max(a.h,b.h),
        confidence:Math.min(a.confidence,b.confidence)});
    }
  }
  return combined;
}
function extractLabeled(text,kind){
  const re=kind==="weight"?
    /(?:\bWEIGHT\b|\bWT\b|الوزن)[^0-9]{0,32}(\d{1,3}[.,]\d{3})/i:
    kind==="unit"?
    /(?:\bUNIT\s*PRICE\b|\bPRICE\s*PER\s*KG\b|سعر\s*الوحدة)[^0-9]{0,32}(\d{1,3}[.,]\d{3})/i:
    /(?:\bTOTAL\s*PRICE\b|\bTOTAL\b|إجمالي\s*السعر)[^0-9]{0,32}(\d{1,3}[.,]\d{3})/i;
  const m=normalized(text).match(re);
  return m?amount(m[1]):null;
}
function chooseByLocation(words,box,kind){
  if(!box||!(box.w>0)||!Number.isFinite(box.x)||!Number.isFinite(box.y))return null;
  const limits={
    weight:{minX:-.15,maxX:1.42,minY:-1.20,maxY:-.035,cx:.60,cy:-.36},
    unit:{minX:1.00,maxX:3.20,minY:-1.20,maxY:-.035,cx:1.88,cy:-.36},
    total:{minX:1.03,maxX:3.30,minY:-.04,maxY:.83,cx:1.90,cy:.22}
  }[kind];
  const found=words.flatMap(word=>{
    const n=amount(word.text);
    if(n===null||word.confidence<25)return [];
    const x=(word.x-box.x)/box.w,y=(word.y-box.y)/box.w;
    if(x<limits.minX||x>limits.maxX||y<limits.minY||y>limits.maxY)return [];
    const score=Math.abs(x-limits.cx)+Math.abs(y-limits.cy)*1.6-
      Math.min(0.6,word.confidence/200);
    return [{n,score,confidence:word.confidence}];
  }).sort((a,b)=>a.score-b.score);
  // A weak spatial guess is not safe enough to prefill a printed value.
  if(!found.length||found[0].score>1.12)return null;
  if(found.length>1&&found[1].n!==found[0].n&&found[1].score-found[0].score<.12)
    return null;
  return found[0].n;
}
function detectPrinted(result,options={}){
  const data=result?.data||result||{};
  const text=normalized(data.text||(Array.isArray(data.lines)?data.lines.map(x=>x.text||"").join("\n"):""));
  const words=boxesFromResult(result);
  const box=options.barcodeBox||null;
  const read=kind=>{
    const spatial=chooseByLocation(words,box,kind);
    // Spatial positions take priority because OCR lines may join two columns
    // and associate the wrong price with the wrong heading.
    return spatial??extractLabeled(text,kind);
  };
  const weight_grams=read("weight"),unit_price_fils=read("unit"),total_price_fils=read("total");
  return {product_code:detectProduct(text),
    weight_grams,unit_price_fils,total_price_fils,
    read_from_photo:{weight:weight_grams!==null,unit:unit_price_fils!==null,total:total_price_fils!==null},
    text_excerpt:text.slice(0,500)};
}
/* Individual numeric boxes are much more reliable than OCR of the whole
   multilingual sticker. All coordinates are relative to its detected EAN. */
function numericWindow(kind,barcodeBox,canvasWidth,canvasHeight){
  if(!barcodeBox||!Number.isFinite(barcodeBox.x)||!Number.isFinite(barcodeBox.y)||
     !(barcodeBox.w>0))return null;
  const b=barcodeBox,w=b.w;
  // The previous windows were too tall: the weight region included the
  // packed/use-by dates. A single-line OCR engine cannot read both rows.
  // Ratios are relative to the EAN-13 bars, not to the whole photo.
  const areas={
    weight:[.24,-.49,1.13,-.10],
    unit:[1.30,-.49,2.49,-.10],
    total:[1.23,-.04,2.65,.46]
  };
  const a=areas[kind];
  if(!a)return null;
  const x=Math.max(0,Math.floor(b.x+a[0]*w));
  const y=Math.max(0,Math.floor(b.y+a[1]*w));
  const right=Math.min(canvasWidth,Math.ceil(b.x+a[2]*w));
  const bottom=Math.min(canvasHeight,Math.ceil(b.y+a[3]*w));
  return right>x+10&&bottom>y+5?{x,y,w:right-x,h:bottom-y}:null;
}
function numericCandidates(text){
  const t=normalized(text).replace(/(?<=\d)[oO](?=[.,\d])/g,"0")
    .replace(/[٠-٩]/g,x=>String("٠١٢٣٤٥٦٧٨٩".indexOf(x)));
  const values=[];
  const regex=/(?:^|[^\d])((?:\d{1,3})?[.,]\s*\d{3})(?!\d)/g;
  for(const match of t.matchAll(regex)){
    const token=match[1].replace(/\s/g,"");
    const n=amount(token.startsWith(".")||token.startsWith(",")?"0"+token:token);
    if(n!==null)values.push(n);
  }
  return [...new Set(values)];
}
function supplementPrinted(base,improved){
  const result={...base,
    read_from_photo:{weight:!!base.read_from_photo?.weight,
      unit:!!base.read_from_photo?.unit,total:!!base.read_from_photo?.total}};
  const notes=[];
  const kinds=[["weight_grams","weight"],["unit_price_fils","unit"],["total_price_fils","total"]];
  for(const [property,kind] of kinds){
    const n=improved[kind];
    if(!Number.isInteger(n))continue;
    if(!Number.isInteger(result[property])){
      result[property]=n;
      result.read_from_photo[kind]=true;
    }else if(result[property]!==n){
      // Two different OCR readings can never silently overwrite one another.
      result[property]=null;
      result.read_from_photo[kind]=false;
      notes.push("Two photo scans disagree about "+kind+". Verify printed sticker.");
    }
  }
  result.ocr_conflicts=notes;
  return result;
}
/* An untrained item's price encoding can sometimes still suggest a UNIQUE
   weight. This is a hypothesis for staff review, not an OCR reading or a
   verified profile. Do not use it for auto-confirming/production/checkout. */
function inferUniqueWeight(barcode,profile,core){
  const b=String(barcode||"").trim();
  if(!profile||!core?.validBarcode?.(b))return null;
  const step=Number(profile.weight_step_grams);
  const rate=Number(profile.unit_price_fils);
  const rounding=Number(profile.rounding_fils);
  if(![1,2,5,10].includes(step)||!Number.isInteger(rate)||rate<=0||
      ![1,5].includes(rounding))return null;
  if(profile.barcode_prefix && profile.barcode_prefix!==b.slice(0,6))return null;
  const price=Number(b.slice(7,12));
  // EAN checksum is not enough. Also require the internal price verifier.
  if(Number(b[6])!==core.priceVerifier(price))return null;
  const center=price*1000/rate;
  const range=Math.ceil((rounding*1000/rate)+2*step);
  const minimum=Math.max(step,Math.ceil((center-range)/step)*step);
  const maximum=Math.min(100000,Math.floor((center+range)/step)*step);
  const matches=[];
  for(let g=minimum;g<=maximum;g+=step){
    if(core.roundedPrice(g,rate,rounding)===price)matches.push(g);
    if(matches.length>2)break;
  }
  return {barcode:b,price_fils:price,weight_grams:matches.length===1?matches[0]:null,
    candidates:matches,unique:matches.length===1,
    source:"Estimated using barcode price, saved rate and weight increment. Verify the printed label."};
}

/* Detect OCR's weight/total swap before any sample is saved. For a verified
   price-encoded prefix, suggest only an unambiguous gram weight, never silently
   overwrite OCR or certify it without a person's review. */
function weightPriceConflict(fields,profile,barcode,core,knownPrefix=""){
  if(!profile||!core)return null;
  const grams=fields?.weight_grams;
  const rate=Number(profile.unit_price_fils);
  const rounding=Number(profile.rounding_fils);
  const total=fields?.total_price_fils;
  if(!Number.isInteger(grams)||!Number.isInteger(total)||
    !Number.isInteger(rate)||![1,5].includes(rounding))return null;
  const calculated=core.roundedPrice(grams,rate,rounding);
  const barcodeTotal=derivePriceFromBarcode(barcode,core,knownPrefix);
  const doesNotBalance=calculated!==total;
  const barcodeDisagrees=barcodeTotal!==null&&barcodeTotal!==total;
  if(!doesNotBalance&&!barcodeDisagrees)return null;
  const inferred=knownPrefix?inferUniqueWeight(barcode,profile,core):null;
  const suggested=inferred?.unique&&inferred.price_fils===total?
    inferred.weight_grams:null;
  return {ocr_weight_grams:grams,calculated_total_fils:calculated,
    total_price_fils:total,barcode_total_fils:barcodeTotal,
    suggested_weight_grams:suggested,doesNotBalance,barcodeDisagrees,
    message:"OCR weight "+core.formatAmount(grams)+" kg would cost "+
      core.formatAmount(calculated)+" BD at "+core.formatAmount(rate)+
      " BD/kg, but the label total is "+core.formatAmount(total)+" BD."+
      (Number.isInteger(suggested)?" Barcode and price suggest "+
        core.formatAmount(suggested)+" kg.":" Check the printed weight.")};
}

function derivePriceFromBarcode(barcode,core,knownPrefix){
  const b=String(barcode||"").trim();
  if(!core?.validBarcode?.(b)||!knownPrefix||!b.startsWith(knownPrefix))return null;
  const encoded=Number(b.slice(7,12));
  if(Number(b[6])!==core.priceVerifier(encoded))return null;
  return encoded;
}
function review(fields,profile,barcode,core,knownPrefix=""){
  const notes=[...(fields.ocr_conflicts||[])];
  const data={...fields};
  const b=String(barcode||"");
  const barcodePrice=derivePriceFromBarcode(b,core,knownPrefix);
  if(barcodePrice!==null){
    if(data.total_price_fils===null||data.total_price_fils===undefined){
      data.total_price_fils=barcodePrice;
      data.source_total="barcode";
      notes.push("Total price read from verified barcode pattern, not printed text.");
    }else{
      data.source_total="photo";
      if(data.total_price_fils!==barcodePrice)
        notes.push("Printed total differs from barcode-encoded price. Recheck sticker.");
    }
  }else data.source_total=data.read_from_photo?.total?"photo":"missing";
  if(profile){
    if(!Number.isInteger(data.unit_price_fils)){
      data.unit_price_fils=Number(profile.unit_price_fils);
      data.source_unit="profile";
      notes.push("Unit price filled from saved item rate. Check the label.");
    }else{
      data.source_unit="photo";
      if(data.unit_price_fils!==Number(profile.unit_price_fils))
        notes.push("Printed unit price differs from this item's saved rate.");
    }
    if(Number.isInteger(data.weight_grams)&&
      (data.weight_grams<Number(profile.weight_step_grams)||
      data.weight_grams>100000||
      data.weight_grams%Number(profile.weight_step_grams)!==0))
      notes.push("Printed weight is outside this item's weight increments.");
  }else data.source_unit=data.read_from_photo?.unit?"photo":"missing";
  if(!Number.isInteger(data.weight_grams))notes.push("Printed weight unreadable; enter it from the sticker.");
  if(!Number.isInteger(data.unit_price_fils))notes.push("Unit price unreadable; enter it from the sticker.");
  if(!Number.isInteger(data.total_price_fils))notes.push("Total price unreadable; enter it from the sticker.");
  if(profile&&Number.isInteger(data.weight_grams)&&Number.isInteger(data.total_price_fils)){
    const expected=core?.roundedPrice?.(data.weight_grams,Number(profile.unit_price_fils),Number(profile.rounding_fils));
    if(Number.isInteger(expected)&&expected!==data.total_price_fils)
      notes.push("Weight × item rate differs from printed/encoded total.");
  }
  data.warnings=notes;
  data.complete=Number.isInteger(data.weight_grams)&&Number.isInteger(data.unit_price_fils)&&
    Number.isInteger(data.total_price_fils)&&notes.every(s=>
      !/differs|outside|unreadable|recheck sticker|disagree/.test(s.toLowerCase()));
  data.barcode_price_fils=barcodePrice;
  return data;
}
function labelCropRegion(imageW,imageH,box,otherBoxes=[]){
  if(!box||!Number.isFinite(box.x)||!Number.isFinite(box.y)||
      !(box.w>0)||!(box.h>0))return {x:0,y:0,w:imageW,h:imageH,barcodeBox:null};
  const width=box.w;
  let x=Math.max(0,Math.floor(box.x-.33*width));
  let y=Math.max(0,Math.floor(box.y-1.60*width));
  let x2=Math.min(imageW,Math.ceil(box.x+2.65*width));
  let y2=Math.min(imageH,Math.ceil(box.y+Math.max(box.h,0.42*width)));
  // Earlier sticker bottoms are not part of the current label. This avoids
  // reading a nearby label's price/weight when sheets have vertical rows.
  for(const other of otherBoxes){
    if(other===box)continue;
    if(Math.abs(other.x-box.x)<Math.max(other.w,box.w)*1.4){
      if(other.y+other.h<=box.y&&other.y+other.h>y)
        y=Math.max(y,Math.ceil(other.y+other.h+4));
      if(other.y>box.y&&other.y<y2)y2=Math.min(y2,Math.floor(other.y-4));
    }
    if(Math.abs(other.y-box.y)<Math.max(other.h,box.h)*2){
      if(other.x+other.w<=box.x&&other.x+other.w>x)
        x=Math.max(x,Math.ceil(other.x+other.w+4));
      if(other.x>box.x&&other.x<x2)x2=Math.min(x2,Math.floor(other.x-4));
    }
  }
  const w=Math.max(1,x2-x),h=Math.max(1,y2-y);
  return {x,y,w,h,barcodeBox:{x:box.x-x,y:box.y-y,w:box.w,h:box.h}};
}
return {nameFor,normalized,amount,detectProduct,boxesFromResult,extractLabeled,
  chooseByLocation,detectPrinted,numericWindow,numericCandidates,supplementPrinted,
  inferUniqueWeight,weightPriceConflict,derivePriceFromBarcode,review,labelCropRegion};
});