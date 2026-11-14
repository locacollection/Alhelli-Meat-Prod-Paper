(()=>{
"use strict";
const $=id=>document.getElementById(id);
const RATE={ "6780":4500, "6781":4500 };
const PRODUCT={ "6780":"Pakistani Beef Minced", "6781":"Pakistani Beef Without Bone" };
const PREFIX={ "966780":"6780", "966781":"6781" };
const STORAGE="alhelli-label-scanner-v2";
const photos=[];
const scannedPhotoKeys=new Set();
const CROPS_DB="meat-production-label-crops-v1";
let cropDbPromise=null;
let cropNumber=0;
function createCropKey(){
  return "label-"+Date.now().toString(36)+"-"+(++cropNumber).toString(36)+"-"+Math.random().toString(36).slice(2,9);
}
function photoKey(f){return [f.name,f.size,f.lastModified].join(":")}
let entries=[];
let scanning=false;
let seq=0;
const makeId=()=>++seq;
const fmtKg=g=>(g/1000).toFixed(3);
const fmtMoney=f=>(f/1000).toFixed(3);
const chip=(txt,cls)=>{const span=document.createElement("span");span.className=cls;span.textContent=txt;return span};
function show(id,msg,cls=""){const el=$(id);el.textContent=msg;el.className="message"+(cls?" "+cls:"")}
function fixed3(text){
  const x=String(text??"").trim().replace(",",".");
  if(!/^\d{1,2}(?:\.\d{1,3})?$/.test(x))return null;
  const [whole,dec=""]=x.split(".");
  return Number(whole)*1000+Number(dec.padEnd(3,"0"));
}
function checkDigit(twelve){
  if(!/^\d{12}$/.test(twelve))return null;
  let s=0;for(let i=0;i<12;i++)s+=Number(twelve[i])*(i%2===0?1:3);
  return (10-s%10)%10;
}
const fivePlus=[0,5,1,6,2,7,3,8,4,9];
const twoMinus=[0,2,4,6,8,9,1,3,5,7];
const fiveMinus=[0,5,9,4,8,3,7,2,6,1];
const inverseFiveMinus=[0,9,7,5,3,1,8,6,4,2];
function priceVerifier(price){
  if(!Number.isInteger(price)||price<0||price>99999)return null;
  let s=String(price).padStart(5,"0");let t=0;
  for(let i=0;i<5;i++)t+=[fivePlus,twoMinus,fiveMinus,fivePlus,twoMinus][i][Number(s[i])];
  return inverseFiveMinus[(10-t%10)%10];
}
function decode(s){
  s=String(s||"").replace(/\s/g,"");
  if(!/^\d{13}$/.test(s))return {error:"A barcode must contain 13 digits."};
  const code=PREFIX[s.slice(0,6)];
  if(!code)return {error:"Only finished minced (6780) and without-bone (6781) labels are accepted."};
  if(Number(s[12])!==checkDigit(s.slice(0,12)))return {error:"The barcode's final EAN-13 check digit is incorrect."};
  const price=Number(s.slice(7,12));
  if(priceVerifier(price)!==Number(s[6]))return {error:"The barcode's internal price-verification digit is incorrect."};
  return {code,price,barcode:s};
}
function roundedPrice(grams,unitFils){
  if(!Number.isSafeInteger(grams)||!Number.isSafeInteger(unitFils))return null;
  return Math.floor((grams*unitFils+2500)/5000)*5;
}
// Rebuild the FULL 13 digits independently using the printed weight and unit price.
// This catches a valid-looking barcode whose encoded price is for another label.
function encodeFromPrinted(item,grams,unitFils){
  const prefix=({"6777":"966777","6780":"966780","6781":"966781"})[item];
  if(!prefix||!Number.isSafeInteger(grams)||grams<1||grams>10000||!Number.isSafeInteger(unitFils)||unitFils<=0)return null;
  const price=roundedPrice(grams,unitFils);
  if(price===null||price<0||price>99999)return null;
  const first12=prefix+String(priceVerifier(price))+String(price).padStart(5,"0");
  return first12+String(checkDigit(first12));
}
// Recover a missed printed unit price only when barcode, weight, and printed total agree.
function fillCatalogUnit(decoded,fields){
  if(!decoded || decoded.error || fields.unit)return {...fields};
  const unit=RATE[decoded.code],grams=fixed3(fields.weight),total=fixed3(fields.printed);
  if(!unit || grams===null || grams<1 || grams>10000 || total===null)return {...fields};
  if(total!==decoded.price || roundedPrice(grams,unit)!==total ||
     encodeFromPrinted(decoded.code,grams,unit)!==decoded.barcode)return {...fields};
  return {...fields,unit:fmtMoney(unit),unitSource:"catalog"};
}
// Barcodes encode price. The following resolves the unique 5 g catalog
// weight at the configured rate; it is not an exact measured weight.
function catalogFromBarcode(barcode){
  const info=decode(barcode);
  if(info.error)return {ok:false,reason:info.error};
  const unit=RATE[info.code];
  if(!unit)return {ok:false,reason:"The saved price for this product is not configured."};
  let match=null;
  for(let grams=5;grams<=10000;grams+=5){
    if(roundedPrice(grams,unit)!==info.price)continue;
    if(encodeFromPrinted(info.code,grams,unit)!==info.barcode)continue;
    if(match!==null)return {ok:false,reason:"Multiple catalog weights share this barcode; check the printed weight."};
    match=grams;
  }
  if(match===null)return {ok:false,reason:"This valid barcode has no match in the 5 g catalog. The store price may have changed."};
  return {ok:true,info,grams:match,unit,price:info.price};
}
function fromBarcode(barcode,original={}){
  const result=catalogFromBarcode(barcode);
  if(!result.ok)return {...original,barcode,confirmed:false,ocrConflict:result.reason};
  // The stored barcode catalog is authoritative. Older manual/OCR weights
  // must not override its 5 g entries when reconstructing a scanned record.
  return {...original,barcode,weight:fmtKg(result.grams),unit:fmtMoney(result.unit),
    printed:fmtMoney(result.price),weightSource:"catalog",unitSource:"catalog",
    printedSource:"barcode",ocrProduct:null,ocrChecked:false,ocrConflict:"",ocrWarning:"",confirmed:true,autoConfirmed:true};
}
function matchPrintedOCR(entry,ocr={}){
  const reference=catalogFromBarcode(entry.barcode);
  if(!reference.ok)return {...entry,confirmed:false,ocrConflict:reference.reason};
  const base=fromBarcode(entry.barcode,entry);
  const differences=[],reads=[];
  for(const [field,expected] of [["weight",reference.grams],["unit",reference.unit],["printed",reference.price]]){
    const raw=String(ocr[field]??"").trim();
    if(!raw)continue;
    const num=fixed3(raw);if(num===null)continue;
    reads.push(field);
    if(field==="weight"&&num!==expected&&roundedPrice(num,reference.unit)===reference.price)continue;
    if(num!==expected)differences.push(field+" "+raw+" instead of "+fmtMoney(expected));
  }
  // A possible mismatch in the product category needs review because it can
  // change the Recipe GRN code (6780 vs 6781).
  if(ocr.ocrProduct && ocr.ocrProduct!==reference.info.code)
    return {...base,confirmed:false,autoConfirmed:false,ocrChecked:false,ocrWarning:"",
      ocrConflict:"Product category differs: barcode identifies "+PRODUCT[reference.info.code]+
      ", but photo text looks like "+PRODUCT[ocr.ocrProduct]+". Check the barcode."};
  // The barcode is authoritative for price. OCR may read 3.105 as 3.108.
  const result={...base,confirmed:true,autoConfirmed:true,ocrConflict:"",
    ocrChecked:reads.length>0&&differences.length===0,
    ocrWarning:differences.length?"Possible photo-reading mistake: "+differences.join("; ")+". Barcode values kept.":"",
    source:differences.length?"Barcode used; OCR warning":"Barcode-derived"};
  // OCR is strictly a second opinion. Never replace catalog weight/price
  // with photo text, even if a 1 g weight rounds to the same barcode price.
  return result;
}
function verify(entry){
  if(entry.ocrConflict)return {ok:false,reason:entry.ocrConflict};
  const info=decode(entry.barcode);
  if(info.error)return {ok:false,reason:info.error};
  const catalog=catalogFromBarcode(entry.barcode);
  if(!catalog.ok)return {ok:false,reason:catalog.reason};
  const grams=fixed3(entry.weight);
  if(grams===null||grams<1||grams>10000){
    const missing=!String(entry.weight??"").trim();
    if(missing){
      const pricePerKg=fixed3(entry.unit);
      const estimate=pricePerKg!==null&&pricePerKg>0?(info.price/pricePerKg).toFixed(3):null;
      return {ok:false,reason:"Printed weight missing. "+(estimate?"Barcode price suggests approximately "+estimate+" kg, but rounding means it cannot confirm exact weight. ":"")+"Type the exact weight written on this label. Gray example text is not entered data."};
    }
    return {ok:false,reason:"The printed weight is invalid. Enter the exact number from the label, between 0.001 and 10.000 kg."};
  }
  if(grams%5!==0){
    return {ok:false,reason:"Only 0.005 kg increments are valid in this barcode catalog. Use the scanned barcode's catalog weight, not an OCR weight."};
  }
  if(grams!==catalog.grams){
    return {ok:false,reason:"Weight differs from the stored barcode catalog: "+fmtKg(catalog.grams)+" kg. Recheck the label."};
  }
  const unit=fixed3(entry.unit);
  if(unit===null||unit<=0)return {ok:false,reason:"Unit price missing."};
  if(unit!==catalog.unit)return {ok:false,reason:"Unit price differs from the saved catalog rate ("+fmtMoney(catalog.unit)+" BD/kg)."};
  const printed=fixed3(entry.printed);
  if(printed===null||printed<0)return {ok:false,reason:"Total price missing."};
  if(printed!==info.price)return {ok:false,reason:"Printed total "+fmtMoney(printed)+" BD does not match this barcode\u0027s "+fmtMoney(info.price)+" BD. This number may belong to another sticker. Recheck the total printed on THIS label."};
  const expected=roundedPrice(grams,unit);
  if(expected!==info.price)return {ok:false,reason:"Weight "+fmtKg(grams)+" kg × "+fmtMoney(unit)+" BD/kg rounds to "+fmtMoney(expected)+" BD, but the barcode encodes "+fmtMoney(info.price)+" BD. Check that the weight is from the SAME label."};
  const reconstructed=encodeFromPrinted(info.code,grams,unit);
  if(reconstructed!==info.barcode){
    return {ok:false,reason:"13-digit barcode sequence mismatch: the printed weight and unit price generate "+(reconstructed||"no valid barcode")+", not "+info.barcode+". Recheck this sticker."};
  }
  if(entry.ocrProduct&&entry.ocrProduct!==info.code)return {ok:false,reason:"Printed product name seems to disagree with the barcode. Review the label."};
  return {ok:true,info,grams,unit,printed};
}
// Each sticker image is keyed by a unique scan-record key, never by barcode.
// Two identical barcodes on different packages must keep different photos.
// Image bytes are stored locally in IndexedDB, not in GitHub, Supabase, CSV or PDF.
function cropDatabase(){
  if(cropDbPromise)return cropDbPromise;
  cropDbPromise=new Promise(resolve=>{
    if(!window.indexedDB){resolve(null);return}
    let request;
    try{request=window.indexedDB.open(CROPS_DB,1)}
    catch(_){resolve(null);return}
    request.onupgradeneeded=()=>{
      if(!request.result.objectStoreNames.contains("labels"))
        request.result.createObjectStore("labels");
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>resolve(null);
    request.onblocked=()=>resolve(null);
  });
  return cropDbPromise;
}
function cropStoreAction(operation,key,blob){
  return cropDatabase().then(db=>new Promise(resolve=>{
    if(!db){resolve(null);return}
    try{
      const tx=db.transaction("labels",operation==="get"?"readonly":"readwrite");
      const store=tx.objectStore("labels");
      const req=operation==="put"?store.put(blob,key):
        operation==="delete"?store.delete(key):store.get(key);
      let result=null;
      req.onsuccess=()=>{result=req.result||null};
      req.onerror=()=>resolve(null);
      tx.oncomplete=()=>resolve(operation==="put"?true:result);
      tx.onerror=()=>resolve(null);
      tx.onabort=()=>resolve(null);
    }catch(_){resolve(null)}
  }));
}
function clearEntryCrop(entry){
  if(entry.cropUrl){
    try{URL.revokeObjectURL(entry.cropUrl)}catch(_){}
    entry.cropUrl="";
  }
  if(entry.cropKey)void cropStoreAction("delete",entry.cropKey);
}
function clearAllCrops(oldEntries){
  for(const entry of oldEntries)clearEntryCrop(entry);
}
async function keepLabelCrop(entry,blob,kind="auto"){
  if(!blob||!entries.includes(entry))return;
  if(entry.cropUrl)try{URL.revokeObjectURL(entry.cropUrl)}catch(_){}
  entry.cropKey=entry.cropKey||createCropKey();
  entry.cropUrl=URL.createObjectURL(blob);
  entry.cropKind=kind;
  persist();render();
  // Persistence may be blocked by browser storage settings. The session
  // image still works, and the UI never falsely claims cloud backup.
  const saved=await cropStoreAction("put",entry.cropKey,blob);
  if(!saved)entry.cropTemporary=true;
}
async function recoverLabelCrops(){
  const records=entries.filter(e=>e.cropKey);
  if(!records.length)return;
  await Promise.all(records.map(async entry=>{
    const blob=await cropStoreAction("get",entry.cropKey);
    if(blob&&entries.includes(entry)){
      if(entry.cropUrl)URL.revokeObjectURL(entry.cropUrl);
      entry.cropUrl=URL.createObjectURL(blob);
    }
  }));
  render();
}
function labelCropBounds(canvas,region,regions=[]){
  const w=Math.max(85,Number(region.w)||85),h=Math.max(12,Number(region.h)||12);
  let left=Math.max(0,Math.floor(region.x-.42*w));
  let top=Math.max(0,Math.floor(region.y-1.34*w));
  let right=Math.min(canvas.width,Math.ceil(region.x+2.50*w));
  let bottom=Math.min(canvas.height,Math.ceil(region.y+h+.13*w));
  // Avoid incorporating the barcode/total from the previous stacked label.
  for(const other of regions){
    if(other===region)continue;
    const sameColumn=Math.abs((other.x+other.w/2)-(region.x+region.w/2))<Math.max(w,other.w||w)*1.30;
    if(sameColumn&&other.y+other.h<=region.y&&other.y+other.h>top)
      top=Math.max(top,Math.ceil(other.y+other.h+Math.max(4,w*.04)));
    // Neighboring stickers on the same horizontal row should not overlap.
    const sameRow=Math.abs((other.y+other.h/2)-(region.y+h/2))<Math.max(w,other.w||w)*.55;
    if(sameRow&&other.x>=region.x+w)
      right=Math.min(right,Math.floor((region.x+w+other.x)/2));
    if(sameRow&&other.x+other.w<=region.x)
      left=Math.max(left,Math.ceil((other.x+other.w+region.x)/2));
  }
  right=Math.max(Math.min(canvas.width,region.x+w),right);
  bottom=Math.max(Math.min(canvas.height,region.y+h),bottom);
  // Cropping may still be imperfect if stickers are heavily overlapping.
  // The thumbnail always remains attached to this barcode's scan record.
  return {x:left,y:top,w:Math.max(1,right-left),h:Math.max(1,bottom-top)};
}
function canvasBlob(canvas,quality=.88){
  return new Promise(resolve=>{
    if(canvas.toBlob)canvas.toBlob(blob=>resolve(blob||null),"image/jpeg",quality);
    else resolve(null);
  });
}
async function croppedLabelBlob(canvas,region,regions){
  const box=labelCropBounds(canvas,region,regions);
  const source=crop(canvas,box.x,box.y,box.w,box.h);
  const scale=Math.min(1,1024/Math.max(source.width,source.height));
  if(scale>=1)return canvasBlob(source);
  const target=document.createElement("canvas");
  target.width=Math.max(1,Math.round(source.width*scale));
  target.height=Math.max(1,Math.round(source.height*scale));
  target.getContext("2d").drawImage(source,0,0,target.width,target.height);
  return canvasBlob(target);
}
async function attachLabelFromFile(file,entry){
  if(!file||!file.type.startsWith("image/"))return;
  let bitmap=null;
  try{
    bitmap=await createImageBitmap(file);
    const c=createScaledCanvas(bitmap);bitmap.close();bitmap=null;
    // User-provided replacement images must show this ONE label.
    // Never attach a cropped area from an unrelated barcode as proof.
    if("BarcodeDetector" in window){
      const detector=new BarcodeDetector({formats:["ean_13"]});
      const detected=await detector.detect(c);
      const valid=detected.map(d=>String(d.rawValue||"").replace(/\s/g,"")).filter(code=>!decode(code).error);
      if(valid.length>1||valid.length===1&&valid[0]!==entry.barcode){
        show("scanMsg","That photo contains another barcode or several stickers. Please crop to the selected label before attaching.","warn");return;
      }
    }
    const blob=await canvasBlob(c);
    await keepLabelCrop(entry,blob,"attached");
    show("scanMsg","Label photo attached to this barcode. Tap the thumbnail to review it.");
  }catch(err){show("scanMsg","Could not attach label photo: "+err.message,"warn")}
  finally{bitmap?.close?.()}
}
function previewEntryCrop(entry){
  if(!entry.cropUrl)return;
  const dialog=$("cropDialog");
  $("cropHeading").textContent=PRODUCT[decode(entry.barcode).code]||"Scanned label";
  $("cropImage").src=entry.cropUrl;
  $("cropImage").alt="Cropped sticker associated with barcode "+entry.barcode;
  $("cropDetails").textContent="Barcode "+entry.barcode+" · "+(entry.weight||"—")+" kg · "+(entry.printed||"—")+" BD";
  if(dialog.showModal)dialog.showModal();
  else dialog.setAttribute("open","");
}
function closeEntryPreview(){
  const dialog=$("cropDialog");
  if(dialog.close)dialog.close();else dialog.removeAttribute("open");
  $("cropImage").removeAttribute("src");
}

function persist(){
  try{localStorage.setItem(STORAGE,JSON.stringify(entries.map(({id,barcode,weight,weightSource,unit,unitSource,printed,printedSource,ocrConflict,ocrWarning,ocrChecked,photoName,ocrProduct,confirmed,autoConfirmed,source,cropKey,cropKind})=>({id,barcode,weight,weightSource,unit,unitSource,printed,printedSource,ocrConflict,ocrWarning,ocrChecked,photoName,ocrProduct,confirmed,autoConfirmed,source,cropKey,cropKind}))))}catch(err){show("scanMsg","Could not store browser session: "+err.message,"warn")}
}
function restore(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE)||"[]");
    if(!Array.isArray(saved))return;
    entries=saved.slice(0,250).filter(x=>x&&typeof x.barcode==="string").map(x=>{
      const old={...x,id:makeId(),barcode:String(x.barcode||""),weight:String(x.weight||""),
        unit:String(x.unit||""),printed:String(x.printed||""),photoName:String(x.photoName||"")};
      // Older OCR and manual values may be wrong or off the 5 g grid.
      // Always restore the scanned barcode's catalog weight and price.
      // Reconstruct their 5 g catalog figures instead.
      return fromBarcode(old.barcode,old);
    });
  }catch(_){}
}
function field(name,val,placeholder,onChange,extra){
  const lbl=document.createElement("label");if(extra)lbl.className=extra;
  const title=document.createElement("span");title.textContent=name;lbl.append(title);
  const input=document.createElement("input");input.type="text";input.value=val||"";input.placeholder=placeholder||"";input.autocomplete="off";if(name.includes("Barcode")){input.inputMode="numeric";input.maxLength=13}else input.inputMode="decimal";
  input.addEventListener("input",e=>onChange(e.target.value));lbl.append(input);return lbl;
}
function buildRow(entry,i){
  const status=verify(entry);
  if(!status.ok)entry.confirmed=false;
  const box=document.createElement("article");box.className="label-card "+(status.ok?(entry.confirmed?"good":""):"bad");
  const head=document.createElement("div");head.className="label-card-head";
  const title=document.createElement("h3");title.textContent="Label "+(i+1)+" · "+(decode(entry.barcode).code?PRODUCT[decode(entry.barcode).code]:"Check barcode");
  head.append(title,chip(status.ok?(entry.confirmed?"Confirmed":"Ready to confirm"):"Needs review","status"));box.append(head);
  if(entry.cropUrl){
    const picture=document.createElement("button");picture.type="button";picture.className="label-crop-inline";
    picture.setAttribute("aria-label","Enlarge cropped sticker for barcode "+entry.barcode);
    const img=document.createElement("img");img.src=entry.cropUrl;img.alt="Original label crop for "+entry.barcode;img.loading="lazy";
    picture.append(img);picture.addEventListener("click",()=>previewEntryCrop(entry));box.append(picture);
  }
  const fields=document.createElement("div");fields.className="label-fields";
  for(const [name,key,placeholder,cls] of [
    ["13-digit barcode","barcode","Enter the actual 13 digits","wide"],
    ["Catalog weight (kg) *","weight","From barcode, e.g. 1.000",""],
    ["Catalog unit price (BD/kg) *","unit","From saved product rate",""],
    ["Barcode total price (BD) *","printed","From barcode",""]
  ]){
    fields.append(field(name,entry[key],placeholder,v=>{
      entry[key]=v;entry.confirmed=false;entry.autoConfirmed=false;entry.ocrConflict="";entry.ocrWarning="";
      if(key==="barcode"){
        const updated=fromBarcode(v,entry);
        Object.assign(entry,updated);
        if(updated.confirmed){persist();render();return}
      }else if(key==="weight")entry.weightSource="manual";
      else if(key==="unit")entry.unitSource="manual";
      else if(key==="printed")entry.printedSource="manual";
      persist();refreshRow(box,entry);refreshSummary();
    },cls));
  }
  box.append(fields);
  if(entry.weightSource==="catalog"){
    const note=document.createElement("p");note.className="fineprint catalog-weight";
    note.textContent="Weight "+entry.weight+" kg inferred from the 5 g barcode catalog. Printed weight may differ by a few grams.";
    box.append(note);
  }
  if(entry.unitSource==="catalog"){
    const inferred=document.createElement("p");inferred.className="fineprint catalog-rate";
    inferred.textContent="Unit price filled from saved product rate ("+entry.unit+" BD/kg), not read from the photo. Check if the store price has changed.";
    box.append(inferred);
  }
  const msg=document.createElement("div");msg.className="message"+(status.ok?"":" warn");
  msg.textContent=status.ok?(entry.confirmed?(entry.ocrWarning?"Barcode valid. OCR had a suspected number-reading error.":entry.ocrChecked?"Barcode matched the recognized printed values.":"Barcode valid. Catalog weight used; printed values not fully recognized."):"Check the printed label if this weight differs from the catalog value."):status.reason;
  box.append(msg);
  if(entry.ocrWarning){
    const warning=document.createElement("p");warning.className="message warn";
    warning.textContent=entry.ocrWarning;box.append(warning);
  }
  const actions=document.createElement("div");actions.className="label-extra";
  const source=document.createElement("small");source.textContent=entry.photoName?"From photo: "+entry.photoName:"Manual / sample label";
  const wrap=document.createElement("div");wrap.className="label-actions";
  if(entry.ocrConflict&&catalogFromBarcode(entry.barcode).ok){
    const keep=document.createElement("button");keep.type="button";keep.className="mini";
    keep.textContent="Keep barcode values";keep.onclick=()=>{
      Object.assign(entry,fromBarcode(entry.barcode,{...entry,source:"Barcode value accepted after OCR mismatch"}));
      persist();render();
    };
    wrap.append(keep);
  }
  const confirm=document.createElement("button");confirm.type="button";confirm.className="mini";confirm.dataset.confirm="1";confirm.textContent=entry.confirmed?"Confirmed ✓":"Confirm printed values";confirm.disabled=!status.ok||entry.confirmed;confirm.addEventListener("click",()=>{entry.confirmed=true;entry.autoConfirmed=false;persist();render()});
  const remove=document.createElement("button");remove.type="button";remove.className="mini";remove.textContent="Remove";remove.addEventListener("click",()=>{clearEntryCrop(entry);entries=entries.filter(x=>x.id!==entry.id);persist();render()});
  const closeup=document.createElement("label");closeup.className="mini closeup-upload";closeup.textContent="Re-read close-up";
  const choose=document.createElement("input");choose.type="file";choose.accept="image/*";choose.hidden=true;
  choose.addEventListener("change",()=>{const file=choose.files?.[0];if(file)readLabelCloseup(file,entry);choose.value=""});
  closeup.append(choose);
  const attach=document.createElement("label");attach.className="mini closeup-upload";attach.textContent=entry.cropUrl?"Replace photo":"Attach label photo";
  const attachInput=document.createElement("input");attachInput.type="file";attachInput.accept="image/*";attachInput.hidden=true;
  attachInput.addEventListener("change",()=>{const f=attachInput.files?.[0];if(f)void attachLabelFromFile(f,entry);attachInput.value=""});
  attach.append(attachInput);
  wrap.append(confirm,closeup,attach,remove);actions.append(source,wrap);box.append(actions);return box;
}
function mode(){return document.querySelector('input[name="materialMode"]:checked')?.value||"no-bones"}
function totals(){
  let m=0,b=0,c=0;
  for(const e of entries){const v=verify(e);if(e.confirmed&&v.ok){if(v.info.code==="6780")m+=v.grams;else b+=v.grams;c++}}
  return {m,b,c,pending:entries.length-c};
}
function paperState(){
  const t=totals(),out=t.m+t.b;let original=out,waste=0,error="";
  if(!entries.length)error="Add at least one minced or boneless label. No production means no Recipe GRN.";
  else if(t.pending>0)error=t.pending+" label(s) need to be checked and confirmed before printing.";
  else if(out<=0)error="No finished meat weight was recorded.";
  if(mode()==="with-bones"){
    original=fixed3($("originalWeight").value);
    if(original===null||original<=0)error="Enter the actual weighed 6777 amount before generating a with-bones production paper.";
    else {waste=original-out;if(waste<0)error="Original 6777 weight is less than finished output. Recheck the printed labels."}
  }
  return {...t,original,waste,error};
}
function refreshRow(box,entry){
  const v=verify(entry);if(!v.ok)entry.confirmed=false;
  box.className="label-card "+(v.ok?(entry.confirmed?"good":""):"bad");
  box.querySelector(".label-card-head h3").textContent="Label "+(entries.indexOf(entry)+1)+" · "+(decode(entry.barcode).code?PRODUCT[decode(entry.barcode).code]:"Check barcode");
  box.querySelector(".status").textContent=v.ok?(entry.confirmed?"Confirmed":"Ready to confirm"):"Needs review";
  const weightNote=box.querySelector(".catalog-weight");
  if(weightNote)weightNote.textContent=entry.weightSource==="catalog"
    ?"Weight "+entry.weight+" kg inferred from 5 g barcode catalog; printed weight may differ by a few grams.":"";
  const priorNote=box.querySelector(".catalog-rate");
  if(priorNote)priorNote.textContent=entry.unitSource==="catalog"
    ?"Unit price filled from saved product rate ("+entry.unit+" BD/kg), not read from the photo. Check if the store price has changed."
    :"";
  const msg=box.querySelector(".message");
  msg.className="message"+(v.ok?"":" warn");
  msg.textContent=v.ok?(entry.confirmed?(entry.ocrWarning?"Barcode valid. OCR warning is informational only.":entry.ocrChecked?"Barcode and recognized printed values agree.":"Barcode valid; catalog weight used, printed values not fully recognized."):"Check the printed label if this weight differs from the catalog value."):v.reason;
  const button=box.querySelector('[data-confirm="1"]');
  button.textContent=entry.confirmed?"Confirmed ✓":"Confirm printed values";
  button.disabled=!v.ok||entry.confirmed;
}
function createReviewTile(entry,index){
  const item=document.createElement("div");item.className="scan-tile";
  const visual=document.createElement("div");visual.className="scan-tile-visual";
  if(entry.cropUrl){
    const zoom=document.createElement("button");zoom.type="button";
    zoom.className="scan-thumbnail";zoom.setAttribute("aria-label","View scanned label "+(index+1));
    const img=document.createElement("img");img.src=entry.cropUrl;img.alt="Cropped printed label for "+entry.barcode;
    img.loading="lazy";zoom.append(img);
    zoom.addEventListener("click",()=>previewEntryCrop(entry));visual.append(zoom);
  }else{
    const missing=document.createElement("div");missing.className="scan-no-photo";
    missing.textContent=entry.photoName?"Crop unavailable":"No label photo";visual.append(missing);
  }
  item.append(visual);
  const info=document.createElement("div");info.className="scan-tile-info";
  const code=decode(entry.barcode).code;
  const heading=document.createElement("strong");heading.textContent="Label "+(index+1)+" · "+(code||"Unknown");
  const barcode=document.createElement("code");barcode.textContent=entry.barcode||"No barcode";
  const number=document.createElement("span");number.className="scan-tile-weight";
  number.textContent=(entry.weight||"—")+" kg · "+(entry.printed||"—")+" BD";
  const status=document.createElement("small");status.className=entry.confirmed&&verify(entry).ok?"scan-ok":"scan-review";
  status.textContent=entry.confirmed&&verify(entry).ok?"Barcode checked":"Needs review";
  info.append(heading,barcode,number,status);
  if(!entry.cropUrl){
    const label=document.createElement("label");label.className="scan-attach-mini";
    label.textContent="Attach cropped photo";
    const input=document.createElement("input");input.type="file";input.accept="image/*";input.hidden=true;
    input.addEventListener("change",()=>{const f=input.files?.[0];if(f)void attachLabelFromFile(f,entry);input.value=""});
    label.append(input);info.append(label);
  }
  item.append(info);
  return item;
}

function render(){
  const container=$("labels");container.replaceChildren();
  if(!entries.length){
    const p=document.createElement("p");p.className="empty";
    p.textContent="No labels yet. Choose a label-sheet photo to scan automatically.";
    container.append(p);
  }else{
    const gallery=document.createElement("div");gallery.className="scan-gallery";
    entries.forEach((entry,index)=>gallery.append(createReviewTile(entry,index)));
    container.append(gallery);
    const ready=[],needsReview=[];
    entries.forEach((entry,index)=>((entry.confirmed&&verify(entry).ok)?ready:needsReview).push({entry,index}));
    if(ready.length){
      const details=document.createElement("details");details.className="auto-verified";
      const summary=document.createElement("summary");
      const warns=ready.filter(x=>x.entry.ocrWarning).length;summary.textContent="✓ "+ready.length+" barcode-derived label"+(ready.length===1?"":"s")+" included"+(warns?" · "+warns+" nonblocking OCR warning"+(warns===1?"":"s"):"")+" · Tap to inspect";
      details.append(summary);
      for(const row of ready)details.append(buildRow(row.entry,row.index));
      container.append(details);
    }
    if(needsReview.length){
      const tip=document.createElement("p");tip.className="review-heading";
      tip.textContent=needsReview.length+" label"+(needsReview.length===1?" needs":"s need")+" attention";
      container.append(tip);
      for(const row of needsReview)container.append(buildRow(row.entry,row.index));
    }
  }
  refreshSummary();
}
function refreshSummary(){
  $("labelCount").textContent=entries.length+" label"+(entries.length===1?"":"s");
  $("originalWeightBlock").classList.toggle("hidden",mode()!=="with-bones");
  const t=paperState();
  $("issueTotal").textContent=t.original===null?"—":fmtKg(t.original)+" kg";
  $("mincedTotal").textContent=fmtKg(t.m)+" kg";$("bonelessTotal").textContent=fmtKg(t.b)+" kg";
  $("wasteTotal").textContent=fmtKg(t.waste)+" kg";$("verifiedTotal").textContent=t.c+" / "+entries.length;
  const blocked=Boolean(t.error)||scanning;
  $("printBtn").disabled=blocked;if($("quickPrintBtn"))$("quickPrintBtn").disabled=blocked;$("exportBtn").disabled=blocked;
  show("paperWarning",t.error||"Paper ready: Recipe Issue "+fmtKg(t.original)+" kg = finished products "+fmtKg(t.m+t.b)+" kg"+(mode()==="with-bones"?" + bones/trimming "+fmtKg(t.waste)+" kg.":"; zero wastage."),t.error?"warn":"");
  show("balanceText",t.error||"Barcode-derived weights totalled. Check the label count and current product prices.",t.error?"warn":"");
}
function addLabel(entry={}){
  const barcode=String(entry.barcode||"").replace(/\s/g,"");
  const derived=barcode?fromBarcode(barcode,entry):{...entry,barcode};
  entries.push({id:makeId(),barcode,weight:derived.weight||"",weightSource:derived.weightSource||"manual",
    unit:derived.unit||"",unitSource:derived.unitSource||"manual",
    printed:derived.printed||"",printedSource:derived.printedSource||"manual",
    ocrConflict:derived.ocrConflict||"",ocrWarning:derived.ocrWarning||"",ocrChecked:!!derived.ocrChecked,
    photoName:derived.photoName||"",ocrProduct:derived.ocrProduct||null, cropKey:derived.cropKey||"",cropKind:derived.cropKind||"",cropUrl:derived.cropUrl||"",
    confirmed:!!derived.confirmed,autoConfirmed:!!derived.autoConfirmed,source:derived.source||"manual"});
  persist();render();
  return entries[entries.length-1];
}
function imgPreview(file){
  const item=document.createElement("div");item.className="photo-item";const pic=document.createElement("img");pic.alt="Selected photo preview";pic.src=URL.createObjectURL(file);pic.onload=()=>URL.revokeObjectURL(pic.src);const span=document.createElement("span");span.textContent=file.name;item.append(pic,span);return item;
}
function updatePhotoQueue(){
  $("photoQueue").replaceChildren();photos.forEach(f=>$("photoQueue").append(imgPreview(f)));$("scanBtn").disabled=!photos.length||scanning;$("clearPhotos").disabled=!photos.length||scanning;
}
function addPhotos(files){
  let count=0;
  for(const file of files){
    if(file.type.startsWith("image/")&&photos.length<30&&!scannedPhotoKeys.has(photoKey(file))){
      photos.push(file);count++;
    }
  }
  updatePhotoQueue();
  if(count){
    show("scanMsg",count+" photo(s) selected. Reading the labels automatically now...");
    void scanPhotos();
  }else show("scanMsg","These photos have already been scanned in this production paper. Use New production paper to start again.","warn");
}
function createScaledCanvas(bitmap,maxDimension=2600){
  const scale=Math.min(1,maxDimension/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement("canvas");canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  canvas.getContext("2d",{willReadFrequently:true}).drawImage(bitmap,0,0,canvas.width,canvas.height);
  return canvas;
}
function crop(canvas,x,y,w,h){const c=document.createElement("canvas");c.width=Math.max(1,Math.floor(w));c.height=Math.max(1,Math.floor(h));c.getContext("2d",{willReadFrequently:true}).drawImage(canvas,x,y,w,h,0,0,c.width,c.height);return c;}
function nearby(a,b){const dx=(a.x+a.w/2)-(b.x+b.w/2);const dy=(a.y+a.h/2)-(b.y+b.h/2);return Math.hypot(dx,dy)<Math.max(20,Math.min(a.w,b.w)*.32)}
async function detectAll(canvas){
  if(!("BarcodeDetector" in window))return [];
  const detector=new BarcodeDetector({formats:["ean_13"]});
  const results=[];
  async function run(x,y,w,h){
    try{
      const img=(x===0&&y===0&&w===canvas.width&&h===canvas.height)?canvas:crop(canvas,x,y,w,h);
      const found=await detector.detect(img);
      for(const q of found){
        const value=q.rawValue.replace(/\s/g,"");
        if(!/^\d{13}$/.test(value))continue;
        const rect=q.boundingBox||{x:0,y:0,width:w,height:h};
        const p={barcode:value,x:x+rect.x,y:y+rect.y,w:rect.width,h:rect.height};
        if(!results.some(r=>r.barcode===p.barcode&&nearby(r,p)))results.push(p);
      }
    }catch(_){}
  }
  await run(0,0,canvas.width,canvas.height);
  for(const grid of [2,3]){
    const tileW=canvas.width*(grid===2?.64:.46),tileH=canvas.height*(grid===2?.64:.46);
    const starts=grid===2?[0,.36]:[0,.27,.54];
    for(const xx of starts)for(const yy of starts){
      const x=Math.floor(xx*canvas.width),y=Math.floor(yy*canvas.height);
      const w=Math.min(canvas.width-x,Math.ceil(tileW)),h=Math.min(canvas.height-y,Math.ceil(tileH));
      if(w>30&&h>30)await run(x,y,w,h);
    }
    if(results.length>30)break;
  }
  return results.sort((a,b)=>a.y-b.y||a.x-b.x);
}
// Crop by the barcode's position, not the whole sticker sheet.
// AlHelli's price, weight and barcode appear in separate consistent rows.
// A neighboring sticker must never contribute its values to this barcode.
function photoRegion(canvas,r){
  const width=Math.max(r.w,85);
  const x=Math.max(0,Math.floor(r.x-width*.32));
  const y=Math.max(0,Math.floor(r.y-width*1.15));
  const right=Math.min(canvas.width,Math.ceil(r.x+width*2.62));
  const bottom=Math.min(canvas.height,Math.ceil(r.y+r.h+width*.05));
  return crop(canvas,x,y,Math.max(1,right-x),Math.max(1,bottom-y));
}
function fieldRegion(canvas,r,which){
  const width=Math.max(r.w,85);
  // [relative x, relative y, relative width, relative height]
  const offsets={
    weight:[.24,-.50,1.00,.43],
    unit:[1.33,-.50,1.22,.43],
    printed:[1.30,-.06,1.25,.52]
  };
  const [dx,dy,dw,dh]=offsets[which];
  const x=Math.max(0,Math.floor(r.x+dx*width));
  const y=Math.max(0,Math.floor(r.y+dy*width));
  const right=Math.min(canvas.width,Math.ceil(r.x+(dx+dw)*width));
  const bottom=Math.min(canvas.height,Math.ceil(r.y+(dy+dh)*width));
  return crop(canvas,x,y,Math.max(1,right-x),Math.max(1,bottom-y));
}
function readUniqueDecimal(text){
  const found=[...String(text||"").replace(/,/g,".").matchAll(/(?:^|[^\d])(\d{1,2}\.\d{3})(?!\d)/gm)].map(x=>x[1]);
  const unique=[...new Set(found)];
  return unique.length===1?unique[0]:"";
}
function shouldAutoConfirm(entry,cropped,confidenceCount){
  return Boolean(cropped&&confidenceCount===3&&verify(entry).ok);
}
async function readFieldsForBarcode(worker,canvas,region,decoded){
  const fields={weight:"",unit:"",printed:"",ocrProduct:null,autoReady:false};
  let good=0;
  for(const kind of ["weight","unit","printed"]){
    try{
      const result=await worker.recognize(fieldRegion(canvas,region,kind));
      const value=readUniqueDecimal(result.data.text||"");
      const confidence=Number(result.data.confidence);
      if(value){
        fields[kind]=value;
        if(!Number.isFinite(confidence)||confidence>=60)good++;
      }
    }catch(_){}
  }
  if(shouldAutoConfirm({barcode:region.barcode,...fields},true,good)){
    fields.autoReady=true;fields.unitSource="label";return fields;
  }
  if(!fields.unit && good>=2){
    const filled=fillCatalogUnit(decoded,{barcode:region.barcode,...fields});
    if(filled.unitSource==="catalog"){
      fields.unit=filled.unit;fields.unitSource="catalog";fields.autoReady=true;
      return fields;
    }
  }
  // Unclear text is a review exception. Never auto-approve from an estimate.
  try{
    const result=await worker.recognize(photoRegion(canvas,region));
    const hint=ocrFields(result.data.text||"",decoded);
    fields.ocrProduct=hint.ocrProduct;
    if(verify({barcode:region.barcode,...hint}).ok){
      for(const kind of ["weight","unit","printed"])
        if(!fields[kind])fields[kind]=hint[kind];
    }
  }catch(_){}
  if(!fields.unit){
    const filled=fillCatalogUnit(decoded,{barcode:region.barcode,...fields});
    if(filled.unitSource==="catalog"){fields.unit=filled.unit;fields.unitSource="catalog"}
  }
  if(fields.unit&&!fields.unitSource)fields.unitSource="label";
  return fields;
}

function ocrFields(text,decoded){
  const normalized=text.replace(/,/g,".");
  const nums=[...normalized.matchAll(/(^|[^\d])(\d{1,2}\.\d{3})(?!\d)/gm)].map(x=>x[2]);
  const values=nums.map(x=>({s:x,n:fixed3(x)}));
  const standardRate=RATE[decoded.code];
  const candidates=values.filter(v=>v.n>0&&v.n<=10000&&roundedPrice(v.n,standardRate)===decoded.price);
  const weights=[...new Set(candidates.map(v=>v.n))];
  const weight=weights.length===1?fmtKg(weights[0]):"";
  const rate=values.some(v=>v.n===standardRate)?fmtMoney(standardRate):"";
  const printed=values.some(v=>v.n===decoded.price)?fmtMoney(decoded.price):"";
  const minHint=/\bMIN(CED)?\b|MIN\s+KG/i.test(text);
  const bonelessHint=/W\s*[/\\]?\s*OUT\s*BONE|WITHOUT\s+BONE/i.test(text);
  return {weight,unit:rate,printed,ocrProduct:minHint&&!bonelessHint?"6780":bonelessHint&&!minHint?"6781":null};
}
let loadOCRPromise=null;
async function loadOCR(){
  if(window.Tesseract)return window.Tesseract;
  if(!loadOCRPromise)loadOCRPromise=new Promise((resolve,reject)=>{
    const script=document.createElement("script");script.src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(new Error("OCR library unavailable"));
    script.onerror=()=>reject(new Error("OCR library could not load. An internet connection is required."));
    document.head.append(script);
  });
  return loadOCRPromise;
}
async function readLabelCloseup(file,entry){
  const known=decode(entry.barcode);
  if(known.error){show("scanMsg","A valid 6780/6781 barcode is required first.","warn");return}
  show("scanMsg","Checking printed text from a close-up photo...");
  let worker=null;
  try{
    if("BarcodeDetector" in window){
      try{
        const bitmap=await createImageBitmap(file);
        const found=await(new BarcodeDetector({formats:["ean_13"]})).detect(bitmap);bitmap.close();
        const visible=found.map(x=>String(x.rawValue).replace(/\s/g,"")).filter(x=>!decode(x).error);
        if(visible.length>1||visible.length===1&&visible[0]!==entry.barcode){
          show("scanMsg","Crop the close-up to exactly this label. The picture contains another barcode.","warn");return;
        }
      }catch(_){}
    }
    await attachLabelFromFile(file,entry);
    worker=await(await loadOCR()).createWorker("eng");
    const result=await worker.recognize(file);
    const textFields=ocrFields(result.data.text||"",known);
    Object.assign(entry,matchPrintedOCR(entry,textFields));
    entry.photoName=file.name;
    persist();render();
    show("scanMsg",entry.ocrConflict
      ?"The close-up conflicts with the barcode. Review this one label, or choose Keep barcode values."
      :"Barcode figures are ready. Recognized printed values are only used for checking.",entry.ocrConflict?"warn":"");
  }catch(err){show("scanMsg","Close-up reading failed, but the barcode-derived values remain: "+err.message,"warn")}
  finally{if(worker)try{await worker.terminate()}catch(_){}}
}

function fallbackBarcodesFromText(text){
  const out=[];const regexp=/9[\s:|]*6678([01])(\d)[\s:|]*(\d{6})/g;let m;
  while((m=regexp.exec(text))!==null){const value="96678"+m[1]+m[2]+m[3];if(!decode(value).error&&!out.includes(value))out.push(value)}
  return out;
}
async function scanPhotos(){
  if(!photos.length||scanning)return;
  scanning=true;
  const batch=photos.splice(0,photos.length);
  $("scanBtn").textContent="Scanning…";updatePhotoQueue();
  let added=0,ready=0,review=0,ocrChecks=0,worker=null,errors=0;
  try{
    for(let i=0;i<batch.length;i++){
      const file=batch[i];
      show("scanMsg","Scanning barcodes in photo "+(i+1)+" of "+batch.length+"…");
      let bitmap=null;
      try{
        bitmap=await createImageBitmap(file);
        const canvas=createScaledCanvas(bitmap);bitmap.close();bitmap=null;
        const regions=await detectAll(canvas);
        if(!regions.length){
          // OCR fallback is not the primary scanning path. A correctly read 13
          // digit number still uses the barcode catalog to resolve its weight.
          try{
            if(!worker)worker=await(await loadOCR()).createWorker("eng");
            const text=(await worker.recognize(canvas)).data.text||"";
            for(const code of fallbackBarcodesFromText(text)){
              const entry=addLabel({barcode:code,photoName:file.name,source:"OCR barcode fallback"});
              added++;if(entry.confirmed)ready++;else review++;
            }
          }catch(err){errors++}
        }else{
          for(let j=0;j<regions.length;j++){
            const region=regions[j],decoded=decode(region.barcode);
            if(decoded.error)continue;
            // PRIMARY: Add barcode and catalog-derived weight before OCR starts.
            const entry=addLabel({barcode:region.barcode,photoName:file.name,source:"Barcode + 5 g catalog"});
            // Crop directly from the detected BARCODE position. Never use the
            // barcode digits as an image key because different stickers repeat.
            try{
              const cropped=await croppedLabelBlob(canvas,region,regions);
              if(cropped)await keepLabelCrop(entry,cropped);
            }catch(err){errors++}
            added++;
            if(entry.confirmed)ready++;else review++;
            show("scanMsg","Read barcode "+(j+1)+"/"+regions.length+" in photo "+(i+1)+". Checking visible text only as a backup…");
            if(!entry.confirmed)continue;
            try{
              if(!worker)worker=await(await loadOCR()).createWorker("eng");
              const fields=await readFieldsForBarcode(worker,canvas,region,decoded);
              const verified=matchPrintedOCR(entry,fields);
              Object.assign(entry,verified);
              if(entry.ocrChecked)ocrChecks++;
              if(!entry.confirmed){ready--;review++}
              persist();render();
            }catch(err){
              // OCR failure is not a barcode failure; leave the derived weight.
              errors++;
            }
          }
        }
        scannedPhotoKeys.add(photoKey(file));
      }catch(err){errors++;show("scanMsg","Unable to scan "+file.name+": "+err.message,"warn")}
      finally{bitmap?.close?.()}
    }
  }finally{
    if(worker)try{await worker.terminate()}catch(_){}
    scanning=false;$("scanBtn").textContent="Retry queued photos";updatePhotoQueue();render();
    show("scanMsg",added
      ?"Detected "+added+" label(s). "+ready+" barcode-derived weight(s) ready; "+review+" need review. Printed-text cross-checks: "+ocrChecks+
       ". Check the count against your sticker sheet before printing."+(errors?" Some labels' text could not be read.":"")
      :"No valid 6780/6781 barcodes found. Try a clearer image, or photograph smaller groups.",added?"":"warn");
    if(photos.length)void scanPhotos();
  }
}

function td(text){const e=document.createElement("td");e.textContent=String(text);return e}
function tr(values){const e=document.createElement("tr");values.forEach(v=>e.append(td(v)));return e}
function padPaperRows(body,rows,minRows=10){
  body.replaceChildren();
  for(const record of rows)body.append(tr(record));
  for(let i=rows.length;i<minRows;i++)body.append(tr(["","","",""]));
}
function preparePaper(){
  const p=paperState();
  if(p.error)return;
  $("ppPlant").textContent=$("plant").value||"SEEF ARAD";
  const rawDate=$("date").value;
  const dateParts=/^(\d{4})-(\d{2})-(\d{2})$/.exec(rawDate);
  $("ppDate").textContent=dateParts?dateParts[3]+"/"+dateParts[2]+"/"+dateParts[1]:(rawDate||"  /  /  ");
  $("ppStaff").textContent=$("staff").value||"";
  $("ppReference").textContent=$("reference").value||"";
  padPaperRows($("ppIssueRows"),[["6777","Pakistani Beef With Bone","kg",fmtKg(p.original)]],10);
  const grn=[];
  if(p.m>0)grn.push(["6780","Pakistani Beef Minced","kg",fmtKg(p.m)]);
  if(p.b>0)grn.push(["6781","Pakistani Beef Without Bone","kg",fmtKg(p.b)]);
  if(mode()==="with-bones"&&p.waste>0)grn.push(["","Wastage for Meat","kg",fmtKg(p.waste)]);
  padPaperRows($("ppGrn"),grn,9);
}
function exportCsv(){
  const p=paperState();if(p.error)return;
  const table=[["item","barcode","weight_kg","unit_BD_per_kg","total_BD"]];
  for(const e of entries){const v=verify(e);table.push([v.info.code,e.barcode,fmtKg(v.grams),fmtMoney(v.unit),fmtMoney(v.printed)])}
  table.push(["Recipe Issue 6777","",fmtKg(p.original),"",""]);
  const csv=table.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download="meat-production-verified-"+($("date").value||"paper")+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$("cropClose").addEventListener("click",closeEntryPreview);
$("cropDialog").addEventListener("click",e=>{if(e.target===$("cropDialog"))closeEntryPreview()});
$("sheetPhotos").addEventListener("change",e=>{addPhotos(e.target.files);e.target.value=""});
$("cameraPhoto").addEventListener("change",e=>{addPhotos(e.target.files);e.target.value=""});
$("scanBtn").addEventListener("click",scanPhotos);
$("clearPhotos").addEventListener("click",()=>{photos.splice(0);updatePhotoQueue();show("scanMsg","Photos removed from the queue. Previously scanned label values are unchanged.")});
$("addLabel").addEventListener("click",()=>addLabel());
$("clearLabels").addEventListener("click",()=>{
  if(entries.length&&!confirm("Start a new production paper and clear all labels?"))return;
  clearAllCrops(entries);entries=[];photos.splice(0);scannedPhotoKeys.clear();persist();render();updatePhotoQueue();
  show("scanMsg","New production paper ready. Choose photos to scan automatically.");
});
function printWithBarcodeNotice(){
  const state=paperState();if(state.error)return;
  const estimated=entries.filter(e=>e.confirmed&&e.weightSource==="catalog").length;
  const warning="Detected "+entries.length+" labels. Check this matches the stickers on the plastic sheet."+
    (estimated?String.fromCharCode(10)+estimated+" weight(s) inferred from the 5 g barcode catalog, not verified exact printed weights.":"")+
    String.fromCharCode(10)+"Prepare the production paper?";
  if(!confirm(warning))return;
  preparePaper();window.print();
}
$("printBtn").addEventListener("click",printWithBarcodeNotice);
$("quickPrintBtn")?.addEventListener("click",printWithBarcodeNotice);
$("exportBtn").addEventListener("click",exportCsv);
document.querySelectorAll('input[name="materialMode"]').forEach(el=>el.addEventListener("change",render));
$("originalWeight").addEventListener("input",render);
$("sampleBtn").addEventListener("click",()=>{
  if(entries.length&&!confirm("Replace all current labels with demonstration values?"))return;
  clearAllCrops(entries);entries=[];document.querySelector('input[name="materialMode"][value="no-bones"]').checked=true;
  const sample=[
    {barcode:"9667806157508",weight:"3.500",unit:"4.500",printed:"15.750"},
    {barcode:"9667818292501",weight:"6.500",unit:"4.500",printed:"29.250"}
  ];
  // These examples are only demonstrations; verify the barcodes before use.
  for(const s of sample)addLabel({...s,source:"demo"});render();show("scanMsg","Demonstration rows loaded. They are not confirmed real labels. Review and confirm each barcode and printed price before producing a paper.","warn");
});
window.MeatProductionChecks={decode,priceVerifier,checkDigit,roundedPrice,fixed3,verify,readUniqueDecimal,ocrFields,photoRegion,fieldRegion,shouldAutoConfirm,encodeFromPrinted,fillCatalogUnit,catalogFromBarcode,fromBarcode,matchPrintedOCR,addLabel,totals,paperState,preparePaper,padPaperRows,labelCropBounds,createReviewTile,keepLabelCrop};
const now=new Date();$("date").value=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
restore();render();void recoverLabelCrops();
})();