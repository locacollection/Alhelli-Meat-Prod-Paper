(()=>{
"use strict";
const $=id=>document.getElementById(id);
const RATE={ "6777":3190, "6780":4500, "6781":4500 };
const PRODUCT={ "6777":"Pakistani Beef With Bone", "6780":"Pakistani Beef Minced", "6781":"Pakistani Beef Without Bone" };
const PREFIX={ "966777":"6777", "966780":"6780", "966781":"6781" };
const STORAGE="alhelli-label-scanner-v2";
const photos=[];
const scannedPhotoKeys=new Set();
const CROPS_DB="meat-production-label-crops-v1";
let cropDbPromise=null;
let initialCropCleanup=null;
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
  if(!code)return {error:"Only 6777, 6780 and 6781 production barcodes are accepted."};
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
        operation==="delete"?store.delete(key):operation==="clear"?store.clear():store.get(key);
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
  // Wait for previous-page crop cleanup so a fast new scan is never erased.
  if(initialCropCleanup)await initialCropCleanup;
  const saved=await cropStoreAction("put",entry.cropKey,blob);
  if(!saved)entry.cropTemporary=true;
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
    show("scanMsg","");
  }catch(err){show("scanMsg","Could not attach label photo: "+err.message,"warn")}
  finally{bitmap?.close?.()}
}
function previewEntryCrop(entry){
  if(!entry.cropUrl)return;
  const dialog=$("cropDialog");
  $("cropHeading").textContent=PRODUCT[decode(entry.barcode).code]||"Scanned label";
  $("cropImage").src=entry.cropUrl;
  $("cropImage").alt="Cropped sticker associated with barcode "+entry.barcode;
  $("cropDetails").textContent=entry.barcode+" · "+(entry.weight||"—")+" kg";
  if(dialog.showModal)dialog.showModal();
  else dialog.setAttribute("open","");
}
function closeEntryPreview(){
  const dialog=$("cropDialog");
  if(dialog.close)dialog.close();else dialog.removeAttribute("open");
  $("cropImage").removeAttribute("src");
}

function persist(){
  try{localStorage.setItem(STORAGE,JSON.stringify(entries.map(({id,barcode,weight,weightSource,unit,unitSource,printed,printedSource,ocrConflict,ocrWarning,ocrChecked,photoName,ocrProduct,confirmed,autoConfirmed,source,cropKey,cropKind,kind,sheetId})=>({id,barcode,weight,weightSource,unit,unitSource,printed,printedSource,ocrConflict,ocrWarning,ocrChecked,photoName,ocrProduct,confirmed,autoConfirmed,source,cropKey,cropKind,kind,sheetId}))))}catch(err){show("scanMsg","Could not store browser session: "+err.message,"warn")}
}
function startBlankSheet(){
  // Refresh always begins a new production paper. Never restore labels
  // from an earlier page load, even when a previous scan was incomplete.
  entries=[];
  photos.splice(0);
  scannedPhotoKeys.clear();
  try{localStorage.removeItem(STORAGE)}catch(_){}
  // Cropped sticker images were formerly saved in IndexedDB. Delete them
  // too so old sheets are not left in device storage or brought back later.
  initialCropCleanup=cropStoreAction("clear");
}

function createLabelValue(title,value,unit,className){
  const item=document.createElement("div");item.className="label-value "+className;
  const name=document.createElement("span");name.className="label-value-title";name.textContent=title;
  const body=document.createElement("div");body.className="label-value-number";
  const number=document.createElement("strong");number.textContent=value||"—";
  body.append(number);
  if(unit){const suffix=document.createElement("span");suffix.textContent=unit;body.append(suffix)}
  item.append(name,body);
  return item;
}
function buildRow(entry,i){
  const status=verify(entry);
  if(!status.ok)entry.confirmed=false;
  const product=decode(entry.barcode).code;
  const box=document.createElement("article");
  box.className="label-card read-only-card product-"+(product||"unknown")+" "+(status.ok?(entry.confirmed?"good":""):"bad");
  const head=document.createElement("div");head.className="label-card-head";
  const headerText=document.createElement("div");headerText.className="label-card-heading";
  const sequence=document.createElement("span");sequence.className="label-sequence";
  sequence.textContent="LABEL "+(i+1);
  const identity=document.createElement("div");identity.className="label-identity identity-"+(product||"unknown");
  const itemCode=document.createElement("strong");itemCode.className="label-item-code";itemCode.textContent=product||"????";
  const role=document.createElement("span");role.className="label-item-role";
  role.textContent=product==="6777"?"ORIGINAL · WITH BONE":
    product==="6780"?(sourceKind(entry)==="bone"?"OUTPUT · MINCED":"MINCED"):
    product==="6781"?(sourceKind(entry)==="bone"?"OUTPUT · BONELESS":"BONELESS"):"UNKNOWN PRODUCT";
  identity.append(itemCode,role);
  const title=document.createElement("h3");title.textContent=product?PRODUCT[product]:"Unreadable barcode";
  headerText.append(sequence,identity,title);
  const statusLabel=chip(status.ok?(entry.confirmed?"Verified":"Ready to confirm"):"Needs review","status");
  head.append(headerText,statusLabel);box.append(head);

  const preview=document.createElement("button");
  preview.type="button";preview.className="mini label-preview-button";
  preview.textContent="Preview label";preview.disabled=!entry.cropUrl;
  preview.title=entry.cropUrl?"Open label photo":"Photo unavailable";
  preview.setAttribute("aria-label","Preview cropped sticker for barcode "+(entry.barcode||"not entered"));
  preview.addEventListener("click",()=>previewEntryCrop(entry));

  // Weight is the main purpose of this page. Keep every product's prices
  // available for auditing, but collapsed by default.
  const primary=document.createElement("div");primary.className="label-primary";
  const weight=createLabelValue("Weight",entry.weight,"kg","weight");
  const barcodeBlock=document.createElement("div");barcodeBlock.className="label-barcode-block";
  const barcodeHeading=document.createElement("span");barcodeHeading.textContent="Barcode";
  barcodeHeading.className="label-value-title";
  const barcode=document.createElement("code");barcode.className="label-barcode";
  barcode.textContent=entry.barcode||"—";
  barcodeBlock.append(barcodeHeading,barcode);
  primary.append(weight,barcodeBlock);
  box.append(primary);

  const priceDetails=document.createElement("details");priceDetails.className="label-price-details";
  const priceSummary=document.createElement("summary");priceSummary.textContent="Price details";
  const priceValues=document.createElement("div");priceValues.className="label-price-grid";
  priceValues.append(
    createLabelValue("Total price",entry.printed,"BD","price"),
    createLabelValue("Unit price",entry.unit,"BD/kg","rate")
  );
  priceDetails.append(priceSummary,priceValues);
  box.append(priceDetails);

  if(!status.ok){
    const warning=document.createElement("div");warning.className="message warn label-validation-warning";
    warning.textContent=status.reason;
    box.append(warning);
  }
  if(entry.ocrWarning){
    const ocrNote=document.createElement("small");ocrNote.className="fineprint";
    ocrNote.textContent=entry.ocrWarning;priceDetails.append(ocrNote);
  }

  const actions=document.createElement("div");actions.className="label-actions read-only-actions";
  actions.append(preview);
  if(entry.ocrConflict&&catalogFromBarcode(entry.barcode).ok){
    const keep=document.createElement("button");keep.type="button";keep.className="mini";
    keep.textContent="Use barcode values";keep.addEventListener("click",()=>{
      Object.assign(entry,fromBarcode(entry.barcode,{...entry,source:"Barcode value accepted after OCR mismatch"}));
      persist();render();
    });
    actions.append(keep);
  }
  if(status.ok&&!entry.confirmed){
    const confirm=document.createElement("button");confirm.type="button";confirm.className="mini";
    confirm.textContent="Confirm barcode";confirm.dataset.confirm="1";
    confirm.addEventListener("click",()=>{entry.confirmed=true;entry.autoConfirmed=false;persist();render()});
    actions.append(confirm);
  }
  const closeup=document.createElement("label");closeup.className="mini closeup-upload";
  closeup.textContent="Re-read photo";
  const choose=document.createElement("input");choose.type="file";choose.accept="image/*";choose.hidden=true;
  choose.addEventListener("change",()=>{const file=choose.files?.[0];if(file)void readLabelCloseup(file,entry);choose.value=""});
  closeup.append(choose);
  const attach=document.createElement("label");attach.className="mini closeup-upload";
  attach.textContent=entry.cropUrl?"Replace photo":"Attach photo";
  const attachInput=document.createElement("input");attachInput.type="file";attachInput.accept="image/*";attachInput.hidden=true;
  attachInput.addEventListener("change",()=>{const file=attachInput.files?.[0];if(file)void attachLabelFromFile(file,entry);attachInput.value=""});
  attach.append(attachInput);
  const remove=document.createElement("button");remove.type="button";remove.className="mini remove-label";
  remove.textContent="Remove";remove.addEventListener("click",()=>{
    clearEntryCrop(entry);entries=entries.filter(item=>item.id!==entry.id);persist();render();
  });
  actions.append(closeup,attach,remove);box.append(actions);
  return box;
}
function sourceKind(entry){return entry.kind==="bone"?"bone":"normal"}
function finishedCode(code){return code==="6780"||code==="6781"}
function productionCalculation(records){
  let normalM=0,normalB=0,boneM=0,boneB=0,boneOriginal=0,waste=0,c=0,pending=0;
  const errors=[],sheetGroups=new Map(),batches=[];
  for(const e of records){
    const v=verify(e);
    if(!e.confirmed||!v.ok){
      pending++;errors.push("Label "+(records.indexOf(e)+1)+": "+(!v.ok?v.reason:"barcode not confirmed"));
      continue;
    }
    c++;
    const kind=sourceKind(e);
    if(kind==="normal"){
      if(v.info.code==="6777"){
        errors.push("6777 original label is on a normal-production sheet. Scan it as a bone-in sheet.");
        continue;
      }
      if(v.info.code==="6780")normalM+=v.grams;
      if(v.info.code==="6781")normalB+=v.grams;
    }else{
      const key=String(e.sheetId||"bone-unassigned");
      if(!sheetGroups.has(key))sheetGroups.set(key,[]);
      sheetGroups.get(key).push({entry:e,code:v.info.code,grams:v.grams});
    }
  }
  for(const [sheetId,items] of sheetGroups){
    let current=null;let batchNumber=0;
    function closeBatch(){
      if(!current)return;
      const out=current.minced+current.boneless;
      if(out===0)errors.push("Bone-in sheet "+current.name+" has 6777 but no finished 6780/6781 label after it.");
      else if(out>current.original)errors.push("Bone-in sheet "+current.name+" has more finished meat than its original 6777 weight.");
      else{
        boneOriginal+=current.original;boneM+=current.minced;boneB+=current.boneless;
        waste+=current.original-out;
        batches.push({...current,waste:current.original-out});
      }
    }
    for(const item of items){
      if(item.code==="6777"){
        closeBatch();batchNumber++;
        current={sheetId,name:sheetId+" / pair "+batchNumber,original:item.grams,minced:0,boneless:0,
          originalBarcode:item.entry.barcode,finishedBarcodes:[]};
      }else if(!current){
        errors.push("Bone-in sheet "+sheetId+" has a "+item.code+" label before its 6777 original. Recheck the sticker order.");
      }else if(item.code==="6780"){
        current.minced+=item.grams;current.finishedBarcodes.push(item.entry.barcode);
      }else if(item.code==="6781"){
        current.boneless+=item.grams;current.finishedBarcodes.push(item.entry.barcode);
      }
    }
    closeBatch();
  }
  const m=normalM+boneM,b=normalB+boneB;
  const normalOriginal=normalM+normalB,original=normalOriginal+boneOriginal;
  return {m,b,c,pending,normalM,normalB,normalOriginal,boneM,boneB,boneOriginal,waste,original,
    batches,boneSheets:sheetGroups.size,errors,error:errors.length?errors[0]:""};
}
function totals(){return productionCalculation(entries)}
function paperState(){
  const t=totals();
  let error=t.error;
  if(!entries.length)error="Scan normal 6780/6781 labels or a bone-in 6777 → 6780 sheet to create a production paper.";
  else if(t.pending)error=t.pending+" label(s) still need barcode review. "+(error||"");
  else if(t.original<=0)error=error||"No finished meat is available for the production paper.";
  return {...t,error};
}
function groupBoneSheetRows(rows){
  const groups=[];
  let current=null,portion=0;
  for(const row of rows){
    const code=decode(row.entry.barcode).code;
    if(code==="6777"){
      current={number:++portion,rows:[row],unpaired:false};
      groups.push(current);
    }else if(current){
      current.rows.push(row);
    }else{
      groups.push({number:null,rows:[row],unpaired:true});
    }
  }
  return groups;
}
function appendReviewGroup(container,title,rows,open=false,description=""){
  if(!rows.length)return;
  const section=document.createElement("details");section.className="auto-verified production-review-group";
  section.open=open;
  const summary=document.createElement("summary");summary.textContent=title+" · "+rows.length+" label"+(rows.length===1?"":"s");
  section.append(summary);

  for(const row of rows)section.append(buildRow(row.entry,row.index));
  container.append(section);
}
function appendBoneReviewGroup(container,sheetId,rows){
  if(!rows.length)return;
  const section=document.createElement("details");section.className="auto-verified production-review-group bone-review-group";
  const title=document.createElement("summary");title.textContent="Bone-in sheet · "+rows.length+" labels";
  section.append(title);
  for(const group of groupBoneSheetRows(rows)){
    const wrapper=document.createElement("div");
    wrapper.className="processing-portion"+(group.unpaired?" portion-unpaired":"");
    const header=document.createElement("div");header.className="processing-portion-header";
    const name=document.createElement("strong");
    name.textContent=group.unpaired?"UNPAIRED OUTPUT":"PORTION "+group.number;
    const count=document.createElement("span");
    count.textContent=group.unpaired?"Original 6777 needed":
      "6777 ORIGINAL → "+group.rows.slice(1).map(r=>decode(r.entry.barcode).code).join(" + ").replace(/^$/,"Awaiting output");
    header.append(name,count);wrapper.append(header);
    for(const row of group.rows)wrapper.append(buildRow(row.entry,row.index));
    section.append(wrapper);
  }
  container.append(section);
}
function render(){
  const container=$("labels");container.replaceChildren();
  if(!entries.length){
    const p=document.createElement("p");p.className="empty";
    p.textContent="No labels";
    container.append(p);
  }else{
    const normal=[],boneSheets=new Map(),needsReview=[];
    entries.forEach((entry,index)=>{
      const row={entry,index};
      if(!entry.confirmed||!verify(entry).ok){needsReview.push(row);return}
      if(sourceKind(entry)==="normal")normal.push(row);
      else{
        const key=entry.sheetId||"Unassigned bone-in sheet";
        if(!boneSheets.has(key))boneSheets.set(key,[]);
        boneSheets.get(key).push(row);
      }
    });
    if(normal.length)appendReviewGroup(container,"Normal production",normal);
    for(const [sheetId,rows] of boneSheets)appendBoneReviewGroup(container,sheetId,rows);
    if(needsReview.length){
      const tip=document.createElement("p");tip.className="review-heading";
      tip.textContent=needsReview.length+" label"+(needsReview.length===1?" needs":"s need")+" attention";
      container.append(tip);
      for(const row of needsReview)container.append(buildRow(row.entry,row.index));
    }
  }
  refreshSummary();
  updateManualSheetOptions();
}
function refreshSummary(){
  $("labelCount").textContent=entries.length+" label"+(entries.length===1?"":"s");
  const t=paperState();
  $("issueTotal").textContent=fmtKg(t.original)+" kg";
  $("mincedTotal").textContent=fmtKg(t.m)+" kg";
  $("bonelessTotal").textContent=fmtKg(t.b)+" kg";
  $("wasteTotal").textContent=fmtKg(t.waste)+" kg";
  const blocked=Boolean(t.error)||scanning;
  $("printBtn").disabled=blocked;
  $("saveBtn").disabled=blocked;
  let finishedValue=0;
  for(const e of entries){
    const v=verify(e);
    if(e.confirmed&&v.ok&&finishedCode(v.info.code))finishedValue+=v.printed;
  }
  $("extraWeight").textContent=fmtKg(t.m+t.b)+" kg";
  $("extraPrice").textContent=fmtMoney(finishedValue)+" BD";
  show("paperWarning",t.error||"",t.error?"warn":"");
}
function addLabel(entry={}){
  const barcode=String(entry.barcode||"").replace(/\s/g,"");
  const derived=barcode?fromBarcode(barcode,entry):{...entry,barcode};
  entries.push({id:makeId(),barcode,weight:derived.weight||"",weightSource:derived.weightSource||"manual",
    unit:derived.unit||"",unitSource:derived.unitSource||"manual",
    printed:derived.printed||"",printedSource:derived.printedSource||"manual",
    ocrConflict:derived.ocrConflict||"",ocrWarning:derived.ocrWarning||"",ocrChecked:!!derived.ocrChecked,
    photoName:derived.photoName||"",ocrProduct:derived.ocrProduct||null,kind:derived.kind==="bone"?"bone":"normal",sheetId:derived.sheetId||"", cropKey:derived.cropKey||"",cropKind:derived.cropKind||"",cropUrl:derived.cropUrl||"",
    confirmed:!!derived.confirmed,autoConfirmed:!!derived.autoConfirmed,source:derived.source||"manual"});
  persist();render();
  return entries[entries.length-1];
}
function updateManualSheetOptions(){
  const select=$("manualSource");
  const old=String(select.value||"normal");
  select.replaceChildren();
  const options=[["normal","Normal production (6780 / 6781)"],["bone-new","New bone-in sheet (start with 6777)"]];
  const ids=new Set();
  for(const e of entries)if(sourceKind(e)==="bone"&&e.sheetId)ids.add(e.sheetId);
  for(const id of ids)options.push(["bone:"+id,"Bone-in: "+id]);
  for(const [value,name] of options){
    const option=document.createElement("option");
    option.value=value;option.textContent=name;select.append(option);
  }
  select.value=options.some(([id])=>id===old)?old:"normal";
  updateManualInsertionOptions();
}
function updateManualInsertionOptions(){
  const kind=String($("manualSource").value||"normal");
  const block=$("manualInsertBlock"),list=$("manualInsert");
  const current=list.value||"end";
  block.hidden=!kind.startsWith("bone:");
  list.replaceChildren();
  const items=[["end","After last label"]];
  if(kind.startsWith("bone:")){
    const sheetId=kind.slice(5);
    items.push(["start","Before first label"]);
    for(const e of entries.filter(x=>sourceKind(x)==="bone"&&x.sheetId===sheetId)){
      items.push(["after:"+e.id,"After "+decode(e.barcode).code+" · "+e.weight+" kg"]);
    }
  }
  for(const [value,name] of items){
    const option=document.createElement("option");option.value=value;option.textContent=name;list.append(option);
  }
  list.value=items.some(([v])=>v===current)?current:"end";
}
function insertManualEntry(barcode){
  const decoded=decode(barcode);
  if(decoded.error)return {error:decoded.error};
  const selected=String($("manualSource").value||"normal");
  const kind=selected==="normal"?"normal":"bone";
  if(kind==="normal"&&decoded.code==="6777")
    return {error:"6777 original stickers belong to a separate bone-in sheet. Select a bone-in source."};
  if(selected==="bone-new"&&decoded.code!=="6777")
    return {error:"A new bone-in sheet must begin with the original 6777 label."};
  const sheetId=kind==="normal"?"":selected==="bone-new"?
    "Bone-in manual #"+createCropKey().slice(-6):selected.slice(5);
  const entry=addLabel({barcode,kind,sheetId,source:"Manual barcode entry"});
  if(kind==="bone"&&selected.startsWith("bone:")){
    const position=$("manualInsert").value;
    if(position==="start"||position.startsWith("after:")){
      entries=entries.filter(x=>x!==entry);
      let index=0;
      if(position==="start"){
        index=entries.findIndex(x=>sourceKind(x)==="bone"&&x.sheetId===sheetId);
        if(index<0)index=entries.length;
      }else{
        const id=Number(position.slice(6));index=entries.findIndex(x=>x.id===id);
        index=index<0?entries.length:index+1;
      }
      entries.splice(index,0,entry);
    }
  }
  persist();render();
  if(kind==="bone"){
    $("manualSource").value="bone:"+sheetId;
    updateManualInsertionOptions();
  }
  return {entry};
}
function imgPreview(job){
  const file=job.file;
  const item=document.createElement("div");item.className="photo-item";
  const pic=document.createElement("img");pic.alt="Selected photo preview";
  pic.src=URL.createObjectURL(file);pic.onload=()=>URL.revokeObjectURL(pic.src);
  const span=document.createElement("span");span.textContent=file.name;
  item.append(pic,span);return item;
}
function updatePhotoQueue(){
  $("photoQueue").replaceChildren();
  photos.forEach(job=>$("photoQueue").append(imgPreview(job)));
  $("scanBtn").disabled=!photos.length||scanning;
  $("clearPhotos").disabled=!photos.length||scanning;
}
function newSheetId(file){
  const stem=String(file.name||"photo").slice(0,40);
  return "Sheet "+stem+" #"+createCropKey().slice(-6);
}
function classifyPhotoBarcodes(barcodes){
  return barcodes.some(barcode=>decode(barcode).code==="6777")?"bone":"normal";
}
function addPhotos(files){
  let count=0;
  for(const file of files){
    if(file.type.startsWith("image/")&&photos.length<30&&!scannedPhotoKeys.has(photoKey(file))){
      photos.push({file,sheetId:newSheetId(file)});
      count++;
    }
  }
  updatePhotoQueue();
  if(count){
    show("scanMsg","Scanning "+count+" photo"+(count===1?"":"s")+"…");
    void scanPhotos();
  }else show("scanMsg","Photo already scanned.","warn");
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
  const withBoneHint=/W\s*[/\\]?\s*BON\b|WITH\s+BONE/i.test(text)&&!bonelessHint;
  return {weight,unit:rate,printed,ocrProduct:minHint&&!bonelessHint?"6780":bonelessHint&&!minHint?"6781":withBoneHint&&!minHint?"6777":null};
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
  if(known.error){show("scanMsg","Invalid barcode.","warn");return}
  show("scanMsg","Checking photo…");
  let worker=null;
  try{
    if("BarcodeDetector" in window){
      try{
        const bitmap=await createImageBitmap(file);
        const found=await(new BarcodeDetector({formats:["ean_13"]})).detect(bitmap);bitmap.close();
        const visible=found.map(x=>String(x.rawValue).replace(/\s/g,"")).filter(x=>!decode(x).error);
        if(visible.length>1||visible.length===1&&visible[0]!==entry.barcode){
          show("scanMsg","Photo contains a different barcode or multiple stickers.","warn");return;
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
    show("scanMsg",entry.ocrConflict?"Photo/barcode mismatch.":"",entry.ocrConflict?"warn":"");
  }catch(err){show("scanMsg","Photo reading failed: "+err.message,"warn")}
  finally{if(worker)try{await worker.terminate()}catch(_){}}
}

function fallbackBarcodesFromText(text){
  const out=[];const regexp=/9[\s:|]*667(77|80|81)(\d)[\s:|]*(\d{6})/g;let m;
  while((m=regexp.exec(text))!==null){const value="9667"+m[1]+m[2]+m[3];if(!decode(value).error&&!out.includes(value))out.push(value)}
  return out;
}
async function scanPhotos(){
  if(!photos.length||scanning)return;
  scanning=true;
  const batch=photos.splice(0,photos.length);
  $("scanBtn").textContent="Scanning…";updatePhotoQueue();
  let added=0,ready=0,review=0,ocrChecks=0,worker=null,errors=0,orderingWarning=false;
  try{
    for(let i=0;i<batch.length;i++){
      const {file,sheetId}=batch[i];
      const countBeforePhoto=added;
      show("scanMsg","Scanning "+(i+1)+"/"+batch.length+"…");
      let bitmap=null;
      try{
        bitmap=await createImageBitmap(file);
        const canvas=createScaledCanvas(bitmap);bitmap.close();bitmap=null;
        const regions=await detectAll(canvas);
        const effectiveKind=classifyPhotoBarcodes(regions.map(r=>r.barcode));
        if(!regions.length){
          // OCR fallback is not the primary scanning path. A correctly read 13
          // digit number still uses the barcode catalog to resolve its weight.
          try{
            if(!worker)worker=await(await loadOCR()).createWorker("eng");
            const text=(await worker.recognize(canvas)).data.text||"";
            const codes=fallbackBarcodesFromText(text);
            // Without detected positions, OCR alone cannot reliably pair
            // originals and finished labels on a bone-in sticker sheet.
            if(classifyPhotoBarcodes(codes)==="bone"){
              errors++;orderingWarning=true;
              show("scanMsg","6777 found, but label order is unclear. Rescan the sheet.","warn");
            }else{
              for(const code of codes){
                const entry=addLabel({barcode:code,kind:"normal",sheetId,photoName:file.name,source:"OCR barcode fallback"});
                added++;if(entry.confirmed)ready++;else review++;
              }
            }
          }catch(err){errors++}
        }else{
          for(let j=0;j<regions.length;j++){
            const region=regions[j],decoded=decode(region.barcode);
            if(decoded.error)continue;
            // PRIMARY: Add barcode and catalog-derived weight before OCR starts.
            const entry=addLabel({barcode:region.barcode,kind:effectiveKind,sheetId,photoName:file.name,source:"Barcode + 5 g catalog"});
            // Crop directly from the detected BARCODE position. Never use the
            // barcode digits as an image key because different stickers repeat.
            try{
              const cropped=await croppedLabelBlob(canvas,region,regions);
              if(cropped)await keepLabelCrop(entry,cropped);
            }catch(err){errors++}
            added++;
            if(entry.confirmed)ready++;else review++;
            show("scanMsg","Scanning "+(i+1)+"/"+batch.length+" · "+(j+1)+"/"+regions.length+" labels…");
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
        if(added>countBeforePhoto)scannedPhotoKeys.add(photoKey(file));
      }catch(err){errors++;show("scanMsg","Unable to scan "+file.name+": "+err.message,"warn")}
      finally{bitmap?.close?.()}
    }
  }finally{
    if(worker)try{await worker.terminate()}catch(_){}
    scanning=false;$("scanBtn").textContent="Retry queued photos";updatePhotoQueue();render();
    show("scanMsg",added?
      added+" scanned · "+ready+" verified"+(review?" · "+review+" review":"")+
      (orderingWarning?" · 6777 order unclear, rescan photo":"")+
      (errors?" · "+errors+" reading warnings":""):
      orderingWarning?"6777 order unclear. Rescan photo.":"No valid barcodes found.",
      !added||errors||review?"warn":"");

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
  if(p.waste>0)grn.push(["","Wastage for Meat","kg",fmtKg(p.waste)]);
  padPaperRows($("ppGrn"),grn,9);
}
function exportCsv(){
  const p=paperState();if(p.error)return;
  const table=[["item","barcode","weight_kg","unit_BD_per_kg","total_BD","source","sheet"]];
  for(const e of entries){const v=verify(e);table.push([v.info.code,e.barcode,fmtKg(v.grams),fmtMoney(v.unit),fmtMoney(v.printed),sourceKind(e),e.sheetId||""])}
  table.push(["Recipe Issue 6777","",fmtKg(p.original),"","","combined",""]);
  table.push(["Bones and wastage","",fmtKg(p.waste),"","","bone-in",""]);
  const csv=table.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download="meat-production-verified-"+($("date").value||"paper")+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$("cropClose").addEventListener("click",closeEntryPreview);
$("cropDialog").addEventListener("click",e=>{if(e.target===$("cropDialog"))closeEntryPreview()});
$("sheetPhotos").addEventListener("change",e=>{addPhotos(e.target.files);e.target.value=""});
$("cameraPhoto").addEventListener("change",e=>{addPhotos(e.target.files);e.target.value=""});
$("scanBtn").addEventListener("click",scanPhotos);
$("clearPhotos").addEventListener("click",()=>{photos.splice(0);updatePhotoQueue();show("scanMsg","")});
$("addLabel").addEventListener("click",()=>{
  const form=$("manualBarcodeForm");
  form.hidden=!form.hidden;
  $("manualBarcodeError").textContent="";
  if(!form.hidden)$("manualBarcode").focus();
});
$("manualSource").addEventListener("change",updateManualInsertionOptions);
$("manualBarcodeForm").addEventListener("submit",event=>{
  event.preventDefault();
  const raw=$("manualBarcode").value.replace(/\s/g,"");
  const lookup=catalogFromBarcode(raw);
  if(!lookup.ok){$("manualBarcodeError").textContent=lookup.reason;return}
  const result=insertManualEntry(raw);
  if(result.error){$("manualBarcodeError").textContent=result.error;return}
  $("manualBarcode").value="";
  $("manualBarcodeError").textContent="";
  $("manualBarcodeForm").hidden=true;
});
$("cancelManualBarcode").addEventListener("click",()=>{
  $("manualBarcodeForm").hidden=true;$("manualBarcodeError").textContent="";
  $("manualBarcode").value="";
});
$("clearLabels").addEventListener("click",()=>{
  if(entries.length&&!confirm("Start a new production paper and clear all labels?"))return;
  clearAllCrops(entries);entries=[];photos.splice(0);scannedPhotoKeys.clear();persist();render();updatePhotoQueue();
  show("scanMsg","");
});
// Preview, saving, and optional PDF export are handled by paper-store.js.
function paperSnapshot(){
  const state=paperState();
  if(scanning)throw new Error("Wait for scanning to finish.");
  if(state.error)throw new Error(state.error);
  const date=$("date").value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Select a production date.");
  const labels=entries.map(e=>{
    const v=verify(e);
    if(!e.confirmed||!v.ok)throw new Error("An unverified barcode remains.");
    return {barcode:e.barcode,product_code:v.info.code,
      weight_grams:v.grams,price_fils:v.printed,
      source:sourceKind(e),sheet_id:String(e.sheetId||"").slice(0,100)};
  });
  const finishedValue=labels.filter(e=>finishedCode(e.product_code)).reduce((n,e)=>n+e.price_fils,0);
  return {
    production_date:date,plant:$("plant").value.trim()||"Seef Arad / Meat",
    staff_name:$("staff").value.trim(),paper_reference:$("reference").value.trim(),
    issue_weight_grams:state.original,minced_weight_grams:state.m,
    boneless_weight_grams:state.b,wastage_weight_grams:state.waste,
    finished_value_fils:finishedValue,label_count:labels.length,
    label_details:labels
  };
}

window.MeatProductionApp={paperSnapshot,preparePaper,paperState};
window.MeatProductionChecks={decode,priceVerifier,checkDigit,roundedPrice,fixed3,verify,readUniqueDecimal,ocrFields,photoRegion,fieldRegion,shouldAutoConfirm,encodeFromPrinted,fillCatalogUnit,catalogFromBarcode,fromBarcode,matchPrintedOCR,addLabel,totals,paperState,preparePaper,padPaperRows,labelCropBounds,buildRow,keepLabelCrop,productionCalculation,insertManualEntry,groupBoneSheetRows,appendBoneReviewGroup,classifyPhotoBarcodes,addPhotos};
const now=new Date();$("date").value=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
startBlankSheet();render();updatePhotoQueue();
})();