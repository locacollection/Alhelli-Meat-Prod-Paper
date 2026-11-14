(()=>{
"use strict";
const $=id=>document.getElementById(id);
const RATE={ "6780":4500, "6781":4500 };
const PRODUCT={ "6780":"Pakistani Beef Minced", "6781":"Pakistani Beef Without Bone" };
const PREFIX={ "966780":"6780", "966781":"6781" };
const STORAGE="alhelli-label-scanner-v2";
const photos=[];
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
function verify(entry){
  const info=decode(entry.barcode);
  if(info.error)return {ok:false,reason:info.error};
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
  const unit=fixed3(entry.unit);
  if(unit===null||unit<=0)return {ok:false,reason:"Read or enter the unit price printed on the label."};
  const printed=fixed3(entry.printed);
  if(printed===null||printed<0)return {ok:false,reason:"Read or enter the total price printed on the label."};
  if(printed!==info.price)return {ok:false,reason:"Printed total "+fmtMoney(printed)+" BD does not match this barcode\u0027s "+fmtMoney(info.price)+" BD. This number may belong to another sticker. Recheck the total printed on THIS label."};
  const expected=roundedPrice(grams,unit);
  if(expected!==info.price)return {ok:false,reason:"Weight "+fmtKg(grams)+" kg × "+fmtMoney(unit)+" BD/kg rounds to "+fmtMoney(expected)+" BD, but the barcode encodes "+fmtMoney(info.price)+" BD. Check that the weight is from the SAME label."};
  if(entry.ocrProduct&&entry.ocrProduct!==info.code)return {ok:false,reason:"Printed product name seems to disagree with the barcode. Review the label."};
  return {ok:true,info,grams,unit,printed};
}
function persist(){
  try{localStorage.setItem(STORAGE,JSON.stringify(entries.map(({id,barcode,weight,unit,printed,photoName,ocrProduct,confirmed,autoConfirmed,source})=>({id,barcode,weight,unit,printed,photoName,ocrProduct,confirmed,autoConfirmed,source}))))}catch(err){show("scanMsg","Could not store browser session: "+err.message,"warn")}
}
function restore(){
  try{const v=JSON.parse(localStorage.getItem(STORAGE)||"[]");if(Array.isArray(v))entries=v.slice(0,250).filter(x=>x&&typeof x.barcode==="string").map(x=>({id:makeId(),barcode:x.barcode,weight:String(x.weight||""),unit:String(x.unit||""),printed:String(x.printed||""),photoName:String(x.photoName||""),ocrProduct:x.ocrProduct||null,confirmed:Boolean(x.confirmed),autoConfirmed:Boolean(x.autoConfirmed),source:x.source||"saved"}));}catch(_){}
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
  const fields=document.createElement("div");fields.className="label-fields";
  for(const [name,key,placeholder,cls] of [
    ["13-digit barcode","barcode","Enter the actual 13 digits","wide"],
    ["Printed weight (kg) *","weight","Enter weight, e.g. 1.000",""],
    ["Unit price (BD/kg) *","unit","Enter price per kg",""],
    ["Printed total price (BD) *","printed","Enter total price",""]
  ]){
    fields.append(field(name,entry[key],placeholder,v=>{entry[key]=v;entry.confirmed=false;entry.autoConfirmed=false;persist();refreshRow(box,entry);refreshSummary()},cls));
  }
  box.append(fields);
  const msg=document.createElement("div");msg.className="message"+(status.ok?"":" warn");
  msg.textContent=status.ok?(entry.confirmed?"Printed values and EAN-13 barcode agree. Label confirmed.":"All values agree. Compare them with the actual printed label, then tap Confirm printed values."):status.reason;
  box.append(msg);
  const actions=document.createElement("div");actions.className="label-extra";
  const source=document.createElement("small");source.textContent=entry.photoName?"From photo: "+entry.photoName:"Manual / sample label";
  const wrap=document.createElement("div");wrap.className="label-actions";
  const confirm=document.createElement("button");confirm.type="button";confirm.className="mini";confirm.dataset.confirm="1";confirm.textContent=entry.confirmed?"Confirmed ✓":"Confirm printed values";confirm.disabled=!status.ok||entry.confirmed;confirm.addEventListener("click",()=>{entry.confirmed=true;entry.autoConfirmed=false;persist();render()});
  const remove=document.createElement("button");remove.type="button";remove.className="mini";remove.textContent="Remove";remove.addEventListener("click",()=>{entries=entries.filter(x=>x.id!==entry.id);persist();render()});
  const closeup=document.createElement("label");closeup.className="mini closeup-upload";closeup.textContent="Re-read close-up";
  const choose=document.createElement("input");choose.type="file";choose.accept="image/*";choose.hidden=true;
  choose.addEventListener("change",()=>{const file=choose.files?.[0];if(file)readLabelCloseup(file,entry);choose.value=""});
  closeup.append(choose);wrap.append(confirm,closeup,remove);actions.append(source,wrap);box.append(actions);return box;
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
  const msg=box.querySelector(".message");
  msg.className="message"+(v.ok?"":" warn");
  msg.textContent=v.ok?(entry.confirmed?"Printed values and EAN-13 barcode agree. Label confirmed.":"All values agree. Compare them with the actual printed label, then tap Confirm printed values."):v.reason;
  const button=box.querySelector('[data-confirm="1"]');
  button.textContent=entry.confirmed?"Confirmed ✓":"Confirm printed values";
  button.disabled=!v.ok||entry.confirmed;
}
function render(){
  const container=$("labels");container.replaceChildren();
  if(!entries.length){
    const p=document.createElement("p");p.className="empty";
    p.textContent="No labels yet. Choose a label-sheet photo to scan automatically.";
    container.append(p);
  }else{
    const ready=[],needsReview=[];
    entries.forEach((entry,index)=>((entry.confirmed&&verify(entry).ok)?ready:needsReview).push({entry,index}));
    if(ready.length){
      const details=document.createElement("details");details.className="auto-verified";
      const summary=document.createElement("summary");
      summary.textContent="✓ "+ready.length+" barcode-checked label"+(ready.length===1?"":"s")+" ready · Tap to inspect";
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
  $("printBtn").disabled=Boolean(t.error);if($("quickPrintBtn"))$("quickPrintBtn").disabled=Boolean(t.error);$("exportBtn").disabled=Boolean(t.error);
  show("paperWarning",t.error||"Paper ready: Recipe Issue "+fmtKg(t.original)+" kg = finished products "+fmtKg(t.m+t.b)+" kg"+(mode()==="with-bones"?" + bones/trimming "+fmtKg(t.waste)+" kg.":"; zero wastage."),t.error?"warn":"");
  show("balanceText",t.error||"All labels confirmed. Recipe Issue and GRN match.",t.error?"warn":"");
}
function addLabel(entry={}){
  entries.push({id:makeId(),barcode:entry.barcode||"",weight:entry.weight||"",unit:entry.unit||"",printed:entry.printed||"",photoName:entry.photoName||"",ocrProduct:entry.ocrProduct||null,confirmed:!!entry.confirmed,autoConfirmed:!!entry.autoConfirmed,source:entry.source||"manual"});
  persist();render();
}
function imgPreview(file){
  const item=document.createElement("div");item.className="photo-item";const pic=document.createElement("img");pic.alt="Selected photo preview";pic.src=URL.createObjectURL(file);pic.onload=()=>URL.revokeObjectURL(pic.src);const span=document.createElement("span");span.textContent=file.name;item.append(pic,span);return item;
}
function updatePhotoQueue(){
  $("photoQueue").replaceChildren();photos.forEach(f=>$("photoQueue").append(imgPreview(f)));$("scanBtn").disabled=!photos.length||scanning;$("clearPhotos").disabled=!photos.length||scanning;
}
function addPhotos(files){for(const file of files){if(file.type.startsWith("image/")&&photos.length<30)photos.push(file)}updatePhotoQueue();show("scanMsg",photos.length+" photo(s) queued. Tap Scan all photos to read the labels.")}
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
    fields.autoReady=true;return fields;
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
  if(known.error){show("scanMsg","Enter or correct the 13-digit barcode first, then re-read a close-up label image.","warn");return}
  show("scanMsg","Reading close-up photo for "+PRODUCT[known.code]+"…");
  let worker=null;
  let validCountInCloseup=0;
  try{
    if("BarcodeDetector" in window){
      try{
        const bitmap=await createImageBitmap(file);const detector=new BarcodeDetector({formats:["ean_13"]});
        const found=await detector.detect(bitmap);bitmap.close();
        const valid=found.map(x=>String(x.rawValue).replace(/\s/g,"")).filter(x=>!decode(x).error);
        validCountInCloseup=valid.length;
        if(valid.length>0 && !valid.includes(entry.barcode)){
          show("scanMsg","Close-up shows a different product/price barcode. No values were changed. Check that you selected the correct label.","warn");return;
        }
      }catch(_){}
    }
    worker=await(await loadOCR()).createWorker("eng");
    const result=await worker.recognize(file);
    const fields=ocrFields(result.data.text||"",known);
    // A close-up should show only one label. Refuse OCR assignments if it looks like a sticker sheet.
    if(validCountInCloseup>1){show("scanMsg","This close-up contains multiple barcodes. Crop it to just one label before re-reading.","warn");return}
    if(!fields.weight&&!fields.unit&&!fields.printed){
      show("scanMsg","The close-up was not clear enough to extract printed values. Enter the exact weight and prices manually.","warn");return;
    }
    if(fields.weight)entry.weight=fields.weight;
    if(fields.unit)entry.unit=fields.unit;
    if(fields.printed)entry.printed=fields.printed;
    if(fields.ocrProduct)entry.ocrProduct=fields.ocrProduct;
    entry.photoName=file.name;entry.confirmed=false;persist();render();
    show("scanMsg","Close-up processed. Recheck every extracted number against the actual printed label, then confirm it.");
  }catch(e){show("scanMsg","Could not read close-up: "+e.message+". You can enter the label values manually.","warn")}
  finally{if(worker)try{await worker.terminate()}catch(_){}}
}
function fallbackBarcodesFromText(text){
  const out=[];const regexp=/9[\s:|]*6678([01])(\d)[\s:|]*(\d{6})/g;let m;
  while((m=regexp.exec(text))!==null){const value="96678"+m[1]+m[2]+m[3];if(!decode(value).error&&!out.includes(value))out.push(value)}
  return out;
}
async function scanPhotos(){
  if(!photos.length||scanning)return;
  if(entries.length){if(!confirm("Start a fresh photo scan? This will replace the existing label rows (including any saved examples)."))return;entries=[];persist();render();}
  scanning=true;updatePhotoQueue();$("scanBtn").textContent="Scanning…";
  let detected=0;let added=0;let worker=null;let errorCount=0;
  try{
    for(let i=0;i<photos.length;i++){
      const file=photos[i];show("scanMsg","Photo "+(i+1)+" of "+photos.length+": finding all visible 13-digit barcodes…");
      let bitmap=null;
      try{
        bitmap=await createImageBitmap(file);
        const canvas=createScaledCanvas(bitmap);
        bitmap.close();bitmap=null;
        let regions=await detectAll(canvas);
        let fallbackText="";
        if(!regions.length){
          show("scanMsg","Photo "+(i+1)+": barcode detection missed the labels. Trying printed-digit recognition…","warn");
          try{
            if(!worker)worker=await (await loadOCR()).createWorker("eng");
            const r=await worker.recognize(canvas);fallbackText=r.data.text||"";
            const codes=fallbackBarcodesFromText(fallbackText);
            for(const code of codes){
              addLabel({barcode:code,photoName:file.name,source:"OCR barcode only - review required"});
              added++;
            }
          }catch(e){errorCount++;show("scanMsg","Photo "+(i+1)+": "+e.message+" Add labels manually if necessary.","warn")}
          continue;
        }
        detected+=regions.length;
        if(!worker)worker=await (await loadOCR()).createWorker("eng");
        for(let j=0;j<regions.length;j++){
          const region=regions[j];
          const decoded=decode(region.barcode);
          if(decoded.error)continue;
          show("scanMsg","Photo "+(i+1)+"/"+photos.length+", label "+(j+1)+"/"+regions.length+": checking written weight and prices…");
          let fields={weight:"",unit:"",printed:"",ocrProduct:null};
          try{
            fields=await readFieldsForBarcode(worker,canvas,region,decoded);
          }catch(_){errorCount++}
          addLabel({barcode:region.barcode,...fields,photoName:file.name,source:"BarcodeDetector + OCR"});added++;
        }
      }catch(e){errorCount++;show("scanMsg","Photo "+(i+1)+": "+e.message,"warn")}
      finally{bitmap?.close?.()}
    }
  }finally{
    if(worker)try{await worker.terminate()}catch(_){}
    scanning=false;$("scanBtn").textContent="Scan all photos";updatePhotoQueue();
    show("scanMsg",added
      ? "Found "+added+" label(s) from "+photos.length+" photo(s). Review every written weight and price below. "+(errorCount?"Some text could not be read. ":"")+"If labels were missed, add them manually."
      :"No usable 6780/6781 barcodes were found. Try sharp, closer photos of smaller groups of labels, or add their numbers and written values manually.",added?"":"warn");
  }
}
function td(text){const e=document.createElement("td");e.textContent=String(text);return e}
function tr(values){const e=document.createElement("tr");values.forEach(v=>e.append(td(v)));return e}
function preparePaper(){
  const p=paperState();if(p.error)return;
  $("ppPlant").textContent=$("plant").value||"________________";
  $("ppDate").textContent=$("date").value||"________________";
  $("ppStaff").textContent=$("staff").value||"________________";
  $("ppReference").textContent=$("reference").value||"________________";
  $("ppIssue").textContent=fmtKg(p.original);
  $("ppMode").textContent=mode()==="no-bones"?"No-bones conversion: Recipe Issue is the sum of the two finished products. Wastage: 0.000 kg.":"With-bones conversion: original 6777 weight is measured before processing. Calculated bones/trimming: "+fmtKg(p.waste)+" kg.";
  const tbody=$("ppGrn");tbody.replaceChildren();
  if(p.m>0)tbody.append(tr(["6780","Pakistani Beef Minced","kg",fmtKg(p.m)]));
  if(p.b>0)tbody.append(tr(["6781","Pakistani Beef Without Bone","kg",fmtKg(p.b)]));
  if(mode()==="with-bones"&&p.waste>0)tbody.append(tr(["—","Bones / trimming (calculated)","kg",fmtKg(p.waste)]));
  const labels=$("ppLabels");labels.replaceChildren();entries.forEach((e,i)=>{const v=verify(e);labels.append(tr([i+1,v.info.code,fmtKg(v.grams),fmtMoney(v.unit),fmtMoney(v.printed),e.barcode]))});
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
$("sheetPhotos").addEventListener("change",e=>{addPhotos(e.target.files);e.target.value=""});
$("cameraPhoto").addEventListener("change",e=>{addPhotos(e.target.files);e.target.value=""});
$("scanBtn").addEventListener("click",scanPhotos);
$("clearPhotos").addEventListener("click",()=>{photos.splice(0);updatePhotoQueue();show("scanMsg","Photos removed from the queue. Previously scanned label values are unchanged.")});
$("addLabel").addEventListener("click",()=>addLabel());
$("clearLabels").addEventListener("click",()=>{if(entries.length&&confirm("Clear all scanned and manually entered labels?")){entries=[];persist();render()}});
$("printBtn").addEventListener("click",()=>{if(paperState().error)return;preparePaper();window.print()});
$("exportBtn").addEventListener("click",exportCsv);
document.querySelectorAll('input[name="materialMode"]').forEach(el=>el.addEventListener("change",render));
$("originalWeight").addEventListener("input",render);
$("sampleBtn").addEventListener("click",()=>{
  if(entries.length&&!confirm("Replace all current labels with demonstration values?"))return;
  entries=[];document.querySelector('input[name="materialMode"][value="no-bones"]').checked=true;
  const sample=[
    {barcode:"9667806157508",weight:"3.500",unit:"4.500",printed:"15.750"},
    {barcode:"9667818292501",weight:"6.500",unit:"4.500",printed:"29.250"}
  ];
  // These examples are only demonstrations; verify the barcodes before use.
  for(const s of sample)addLabel({...s,source:"demo"});render();show("scanMsg","Demonstration rows loaded. They are not confirmed real labels. Review and confirm each barcode and printed price before producing a paper.","warn");
});
window.MeatProductionChecks={decode,priceVerifier,checkDigit,roundedPrice,fixed3,verify,readUniqueDecimal,ocrFields,photoRegion,fieldRegion,shouldAutoConfirm};
const now=new Date();$("date").value=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
restore();render();
})();