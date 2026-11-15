/* Salmon production scanner, manual review and live EAN-13 capture.
   Never derive fish weight or item code from an unverified EAN prefix. */
(()=>{
"use strict";
const core=window.FishProductionCore;
const $=id=>document.getElementById(id);
const entries=[];let sequence=0,editing=null,scanning=false,stageUrl="",cameraStream=null;
let cameraReader=null,cameraDetector=null,cameraToken=0,cameraTimer=null,cameraOpen=false;
let ocrPromise=null,ZXingPromise=null,previewObject=null;
const bodyIds=["fishCode","fishBarcode","fishWeight","fishUnitPrice","fishTotalPrice"];
function show(id,message,warning=false){
  const node=$(id);node.textContent=message||"";
  node.hidden=!message;
  node.classList.toggle("is-warning",warning);
}
function openDialog(el){if(el.showModal)el.showModal();else el.setAttribute("open","")}
function closeDialog(el){if(el.open){if(el.close)el.close();else el.removeAttribute("open")}}
function make(tag,cls,text){
  const el=document.createElement(tag);if(cls)el.className=cls;
  if(text!==undefined)el.textContent=String(text);
  return el;
}
function revokeImage(entry){
  if(entry?.photoUrl){URL.revokeObjectURL(entry.photoUrl);entry.photoUrl=""}
}
function removeEntry(entry){
  const pos=entries.indexOf(entry);
  if(pos>=0){entries.splice(pos,1);revokeImage(entry)}
  render();
}
function moveEntry(entry,direction){
  const i=entries.indexOf(entry),next=i+direction;
  if(i<0||next<0||next>=entries.length)return;
  [entries[i],entries[next]]=[entries[next],entries[i]];
  render();
}
function resultTitle(entry){
  return core.PRODUCT[entry.product_code]||"Unidentified fish label";
}
function addEntry(data={}){
  const entry={id:++sequence,product_code:data.product_code||"",barcode:data.barcode||"",
    weight_grams:data.weight_grams??null,unit_price_fils:data.unit_price_fils??null,
    total_price_fils:data.total_price_fils??null,confirmed:false,
    photoUrl:data.photoUrl||"",photoName:data.photoName||"",ocrHint:data.ocrHint||""};
  entries.push(entry);render();return entry;
}
function openEditor(entry){
  editing=entry;
  $("fishEditTitle").textContent=entry.confirmed?"Review fish label":"Confirm fish label";
  $("fishCode").value=entry.product_code;
  $("fishBarcode").value=entry.barcode;
  $("fishWeight").value=Number.isInteger(entry.weight_grams)?core.fmtKg(entry.weight_grams):"";
  $("fishUnitPrice").value=Number.isInteger(entry.unit_price_fils)?core.fmtBD(entry.unit_price_fils):"";
  $("fishTotalPrice").value=Number.isInteger(entry.total_price_fils)?core.fmtBD(entry.total_price_fils):"";
  $("fishEditPhotoWrap").hidden=!entry.photoUrl;
  if(entry.photoUrl)$("fishEditPhoto").src=entry.photoUrl;
  else $("fishEditPhoto").removeAttribute("src");
  show("fishEditError",entry.ocrHint||"",!!entry.ocrHint);
  openDialog($("fishEditDialog"));
}
function validateEditor(){
  const product_code=$("fishCode").value,
    barcode=String($("fishBarcode").value||"").replace(/\s/g,"");
  const weight_grams=core.parseDecimal($("fishWeight").value);
  const unit_price_fils=$("fishUnitPrice").value.trim()?core.parseDecimal($("fishUnitPrice").value):null;
  const total_price_fils=$("fishTotalPrice").value.trim()?core.parseDecimal($("fishTotalPrice").value):null;
  if($("fishUnitPrice").value.trim()&&unit_price_fils===null)throw new Error("Enter a valid price, up to 3 decimal places.");
  if($("fishTotalPrice").value.trim()&&total_price_fils===null)throw new Error("Enter a valid total price, up to 3 decimal places.");
  const record={product_code,barcode,weight_grams,unit_price_fils,total_price_fils,confirmed:true};
  const check=core.validateEntry(record);
  if(!check.ok)throw new Error(check.reason);
  return record;
}
function saveEditor(event){
  event.preventDefault();
  if(!editing)return;
  try{
    Object.assign(editing,validateEditor(),{ocrHint:""});
    closeDialog($("fishEditDialog"));render();
  }catch(err){show("fishEditError",err.message,true)}
}
function addEditButton(actions,entry,label="Review"){
  const button=make("button","mini",label);button.type="button";
  button.addEventListener("click",()=>openEditor(entry));actions.append(button);
}
function renderLabels(){
  const list=$("fishLabels");list.replaceChildren();
  $("fishLabelCount").textContent=entries.length+" label"+(entries.length===1?"":"s");
  if(!entries.length){list.append(make("p","fish-hint","No fish labels added yet."));return}
  for(let i=0;i<entries.length;i++){
    const e=entries[i],check=core.validateEntry(e);
    const card=make("article","fish-card "+(e.confirmed&&check.ok?"is-checked":"is-pending"));
    const head=make("div","fish-card-head"),heading=make("div","fish-card-heading");
    heading.append(make("small","","LABEL "+(i+1)+" · "+(e.product_code||"UNKNOWN")));
    heading.append(make("strong","",resultTitle(e)));
    head.append(heading,make("span","fish-card-badge",e.confirmed&&check.ok?"Confirmed":"Needs review"));card.append(head);
    const stats=make("div","fish-card-stats");
    const w=make("div","fish-card-stat");
    w.append(make("small","","Weight"),make("strong","",Number.isInteger(e.weight_grams)?core.fmtKg(e.weight_grams)+" kg":"Not confirmed"));
    const p=make("div","fish-card-stat");
    p.append(make("small","","Total price"),make("strong","",Number.isInteger(e.total_price_fils)?core.fmtBD(e.total_price_fils)+" BD":"Not entered"));
    stats.append(w,p);card.append(stats);
    card.append(make("code","fish-card-code",e.barcode||"No barcode recorded"));
    if(e.ocrHint)card.append(make("div","fish-issues",e.ocrHint));
    if(!e.confirmed&& !e.ocrHint)card.append(make("div","fish-issues","Check the product and printed weight before confirming."));
    const actions=make("div","fish-card-actions");
    addEditButton(actions,e,e.confirmed?"Edit":"Review label");
    if(e.photoUrl){
      const preview=make("button","mini","Preview sticker");preview.type="button";
      preview.addEventListener("click",()=>{
        $("fishImageTitle").textContent=resultTitle(e);
        $("fishImage").src=e.photoUrl;
        openDialog($("fishImageDialog"));
      });actions.append(preview);
    }
    const up=make("button","mini","↑");up.type="button";up.disabled=i===0;
    up.title="Move this label above";up.addEventListener("click",()=>moveEntry(e,-1));
    const down=make("button","mini","↓");down.type="button";down.disabled=i===entries.length-1;
    down.title="Move this label below";down.addEventListener("click",()=>moveEntry(e,1));
    const remove=make("button","mini","Remove");remove.type="button";
    remove.addEventListener("click",()=>removeEntry(e));
    actions.append(up,down,remove);card.append(actions);list.append(card);
  }
}
function displayTotals(){
  const totals=core.calculate(entries);
  $("fishIssue").textContent=core.fmtKg(totals.issue||0)+" kg";
  $("fishFillet").textContent=core.fmtKg(totals.fillet||0)+" kg";
  $("fishBone").textContent=core.fmtKg(totals.bone||0)+" kg";
  $("fishWaste").textContent=(totals.wastage<0?"−":"")+core.fmtKg(Math.abs(totals.wastage||0))+" kg";
  $("fishOutput").textContent=core.fmtKg((totals.fillet||0)+(totals.bone||0))+" kg";
  $("fishValue").textContent=totals.priced_outputs?
    core.fmtBD(totals.value_fils)+" BD"+(totals.unpriced_outputs?" (partial)":""):"Not available";
  const groups=$("fishBatchSummary");groups.replaceChildren();
  if(totals.groups?.length>1){
    for(const group of totals.groups){
      groups.append(make("div","",
        "Batch "+group.number+": "+core.fmtKg(group.issue)+" − "+core.fmtKg(group.fillet)+
        " − "+core.fmtKg(group.bone)+" = "+core.fmtKg(group.wastage)+" kg wastage"));
    }
  }
  show("fishPaperError",totals.error||"",!!totals.error);
  $("fishPreview").disabled=!totals.ok||scanning;
  $("fishSave").disabled=!totals.ok||scanning;
}
function render(){renderLabels();displayTotals()}
function createSnapshot(){
  return core.snapshot(entries,{
    production_date:$("fishDate").value,plant:$("fishPlant").value,
    staff_name:$("fishStaff").value,paper_reference:$("fishRef").value
  });
}
function newSheet(){
  if(entries.length&&!confirm("Clear this unsaved fish production sheet and all its label photos?"))return;
  entries.forEach(revokeImage);entries.splice(0);
  show("fishScanStatus","");render();
}
function photoCrop(canvas,region,all=[]){
  const w=Math.max(65,region.w||65),h=Math.max(12,region.h||12);
  let x=Math.max(0,Math.floor(region.x-w*.45));
  let y=Math.max(0,Math.floor(region.y-w*1.35));
  let endX=Math.min(canvas.width,Math.ceil(region.x+w*2.4));
  const endY=Math.min(canvas.height,Math.ceil(region.y+h+w*.12));
  for(const other of all){
    if(other===region)continue;
    if(other.y+other.h<=region.y&&other.y+other.h>y&&
      Math.abs(other.x-region.x)<w*1.5)
      y=Math.max(y,Math.floor(other.y+other.h+3));
    if(other.x>region.x&&Math.abs(other.y-region.y)<h*3)
      endX=Math.min(endX,Math.floor((region.x+w+other.x)/2));
  }
  const out=document.createElement("canvas");
  out.width=Math.max(1,endX-x);out.height=Math.max(1,endY-y);
  out.getContext("2d").drawImage(canvas,x,y,out.width,out.height,0,0,out.width,out.height);
  return out;
}
async function asBlob(canvas){
  return new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",.86));
}
function inferPrintedText(text){
  const words=String(text||"").replace(/\s+/g," ").toUpperCase();
  const fillet=/SALMON.{0,20}FILLET|FILLET.{0,20}SALMON/.test(words);
  const bone=/SALMON.{0,20}BONE|BONE.{0,20}SALMON/.test(words);
  const original=/ATLANTIC.{0,18}SALMON|SALMON FISH/.test(words);
  const product_code=fillet&&!bone?"6668":bone&&!fillet?"7144":original&&!fillet&&!bone?"6376":"";
  // Accept an OCR weight hint only when directly following the WEIGHT label.
  // Do not select an arbitrary decimal that might be unit or total price.
  const hit=words.match(/(?:WEIGHT|WT\.?)[^\d]{0,23}(\d{1,3}\.\d{3})/);
  const grams=hit?core.parseDecimal(hit[1]):null;
  const weight_grams=grams!==null&&grams>=2&&grams<=100000&&grams%2===0?grams:null;
  return {product_code,weight_grams};
}
let cropReaderPromise=null;
async function loadCropReader(){
  if(window.Tesseract)return window.Tesseract;
  if(!cropReaderPromise){
    cropReaderPromise=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(new Error("OCR unavailable"));
      script.onerror=()=>reject(new Error("OCR download unavailable"));
      document.head.append(script);
    }).catch(err=>{cropReaderPromise=null;throw err});
  }
  return cropReaderPromise;
}
async function detectBarcodes(canvas){
  if(typeof window.BarcodeDetector!=="function")return [];
  const d=new window.BarcodeDetector({formats:["ean_13"]});
  const result=[];
  async function sweep(x,y,w,h){
    const image=document.createElement("canvas");
    image.width=w;image.height=h;
    image.getContext("2d").drawImage(canvas,x,y,w,h,0,0,w,h);
    try{
      const found=await d.detect(image);
      for(const item of found){
        const barcode=String(item.rawValue||"").replace(/\s/g,"");
        if(!core.validEAN(barcode))continue;
        const b=item.boundingBox||{x:0,y:0,width:w,height:20};
        const obj={barcode,x:x+b.x,y:y+b.y,w:b.width,h:b.height};
        if(result.some(a=>a.barcode===barcode&&Math.abs(a.x-obj.x)<Math.max(25,obj.w*.28)&&
          Math.abs(a.y-obj.y)<Math.max(25,obj.h*2)))continue;
        result.push(obj);
      }
    }catch(_){}
  }
  await sweep(0,0,canvas.width,canvas.height);
  for(const grid of [2,3]){
    const starts=grid===2?[0,.38]:[0,.28,.56];
    const tw=Math.ceil(canvas.width*(grid===2?.63:.45));
    const th=Math.ceil(canvas.height*(grid===2?.63:.45));
    for(const xx of starts)for(const yy of starts){
      const x=Math.floor(xx*canvas.width),y=Math.floor(yy*canvas.height);
      await sweep(x,y,Math.min(tw,canvas.width-x),Math.min(th,canvas.height-y));
    }
  }
  return result.sort((a,b)=>a.y-b.y||a.x-b.x);
}
function startScanStage(file,which,total){
  const stage=$("fishScanStage");stage.hidden=false;
  $("fishScanProgress").textContent=which+"/"+total;
  if(stageUrl)URL.revokeObjectURL(stageUrl);
  stageUrl=URL.createObjectURL(file);
  $("fishScanImage").src=stageUrl;
}
function endScanStage(){
  $("fishScanStage").hidden=true;$("fishScanImage").removeAttribute("src");
  if(stageUrl)URL.revokeObjectURL(stageUrl);stageUrl="";
}
async function scanImages(files){
  if(scanning)return;
  const list=[...(files||[])].filter(f=>f.type.startsWith("image/"));
  if(!list.length)return;
  scanning=true;displayTotals();
  let count=0,unclear=0;
  try{
    for(let i=0;i<list.length;i++){
      const file=list[i];startScanStage(file,i+1,list.length);
      let bitmap=null,worker=null;
      try{
        show("fishScanStatus","Scanning "+file.name+"…");
        bitmap=await createImageBitmap(file);
        const ratio=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));
        const canvas=document.createElement("canvas");
        canvas.width=Math.round(bitmap.width*ratio);
        canvas.height=Math.round(bitmap.height*ratio);
        canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);
        bitmap.close();bitmap=null;
        const positions=await detectBarcodes(canvas);
        if(!positions.length){unclear++;continue}
        // OCR is a suggestion. The employee must confirm each detected label.
        try{worker=await(await loadCropReader()).createWorker("eng")}catch(_){}
        for(const region of positions){
          const cropped=photoCrop(canvas,region,positions);
          const blob=await asBlob(cropped);
          const photoUrl=blob?URL.createObjectURL(blob):"";
          let hint={},ocrHint="Check the product and printed weight.";
          if(worker){
            try{
              const output=await worker.recognize(cropped);
              hint=inferPrintedText(output.data?.text||"");
              ocrHint="Text recognition is a suggestion. Confirm against this sticker.";
            }catch(_){}
          }
          const learned=await window.FishStoreChecks?.matchLearnedBarcode?.(region.barcode);
          if(learned){
            const mismatch=hint.product_code&&hint.product_code!==learned.product_code;
            const printedMismatch=Number.isInteger(hint.weight_grams)&&
              Number.isInteger(learned.weight_grams)&&hint.weight_grams!==learned.weight_grams;
            ocrHint=(mismatch?"Printed product text may disagree. ":"")+
              (printedMismatch?"Printed weight differs from barcode estimate. ":"")+
              (Number.isInteger(learned.weight_grams)?
                "Barcode suggests "+core.fmtKg(learned.weight_grams)+" kg. ":
                "Barcode price cannot identify one exact weight. ")+
              "Encoded price "+core.fmtBD(learned.price_fils)+" BD. Check the printed sticker.";
            hint={product_code:learned.product_code,
              weight_grams:learned.weight_grams??hint.weight_grams??null};
          }
          addEntry({barcode:region.barcode,photoUrl,photoName:file.name,
            product_code:hint.product_code||"",weight_grams:hint.weight_grams??null,
            unit_price_fils:learned?.unit_price_fils??null,
            total_price_fils:learned?.price_fils??null,
            ocrHint});
          count++;
        }
      }catch(err){
        unclear++;
        show("fishScanStatus","Could not read "+file.name+": "+err.message,true);
      }finally{
        bitmap?.close?.();
        if(worker)try{await worker.terminate()}catch(_){}
      }
    }
  }finally{
    scanning=false;endScanStage();render();
    show("fishScanStatus",count+" sticker barcode"+(count===1?"":"s")+" detected. "+
      "Review each fish weight and item before saving."+
      (unclear?" "+unclear+" photo(s) need a clearer scan or manual entry.":""),
      count===0||unclear>0);
  }
}
function closeCamera(){
  cameraToken++;
  cameraOpen=false;
  if(cameraTimer!==null){clearTimeout(cameraTimer);cameraTimer=null}
  if(cameraReader){try{cameraReader.reset()}catch(_){}cameraReader=null}
  if(cameraStream){cameraStream.getTracks().forEach(t=>{try{t.stop()}catch(_){}});cameraStream=null}
  try{$("fishVideo").pause()}catch(_){}
  $("fishVideo").srcObject=null;
  closeDialog($("fishCameraDialog"));
}
function oneBarcode(barcode){
  if(!cameraOpen)return false;
  barcode=String(barcode||"").replace(/\s/g,"");
  if(!core.validEAN(barcode))return false;
  // Close camera first, preventing duplicate labels from the next video frame.
  closeCamera();
  const entry=addEntry({barcode,ocrHint:"Identify the fish product and confirm its printed weight."});
  openEditor(entry);
  // The camera can close immediately while the private profile lookup runs.
  // Do not mark the label confirmed or overwrite any staff-edited fields.
  void Promise.resolve(window.FishStoreChecks?.matchLearnedBarcode?.(barcode)).then(learned=>{
    if(!learned||entry.confirmed||!entries.includes(entry))return;
    const hasWeight=Number.isInteger(learned.weight_grams);
    entry.ocrHint=(hasWeight?
      "Price barcode suggests "+core.fmtKg(learned.weight_grams)+" kg. ":
      "Price barcode is not enough to determine an exact weight. ")+
      "Check the printed sticker before confirming.";
    if(!entry.product_code)entry.product_code=learned.product_code;
    if(hasWeight&&!Number.isInteger(entry.weight_grams))entry.weight_grams=learned.weight_grams;
    if(!Number.isInteger(entry.unit_price_fils))entry.unit_price_fils=learned.unit_price_fils;
    if(!Number.isInteger(entry.total_price_fils))entry.total_price_fils=learned.price_fils;
    if(editing===entry){
      if(!$("fishCode").value)$("fishCode").value=entry.product_code;
      if(hasWeight&&!$("fishWeight").value)$("fishWeight").value=core.fmtKg(entry.weight_grams);
      if(!$("fishUnitPrice").value)$("fishUnitPrice").value=core.fmtBD(entry.unit_price_fils);
      if(!$("fishTotalPrice").value)$("fishTotalPrice").value=core.fmtBD(entry.total_price_fils);
      show("fishEditError",entry.ocrHint,true);
    }
    render();
  }).catch(()=>{});
  return true;
}
async function legacyScanner(){
  if(window.ZXing?.BrowserMultiFormatReader)return window.ZXing;
  if(!ZXingPromise){
    ZXingPromise=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
      script.onload=()=>window.ZXing?.BrowserMultiFormatReader?resolve(window.ZXing):reject(new Error("Barcode library unavailable"));
      script.onerror=()=>reject(new Error("Could not load camera barcode reader"));
      document.head.append(script);
    }).catch(e=>{ZXingPromise=null;throw e});
  }
  return ZXingPromise;
}
async function liveLoop(token){
  if(!cameraOpen||token!==cameraToken)return;
  try{
    if($("fishVideo").readyState>=2){
      const found=await cameraDetector.detect($("fishVideo"));
      if(!cameraOpen||token!==cameraToken)return;
      for(const x of found)if(oneBarcode(x.rawValue))return;
    }
  }catch(_){}
  if(cameraOpen&&token===cameraToken)
    cameraTimer=setTimeout(()=>void liveLoop(token),160);
}
async function openCamera(){
  if(cameraOpen)return;
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){
    show("fishScanStatus","Live barcode scanning needs HTTPS and camera permission.",true);return;
  }
  const token=++cameraToken;cameraOpen=true;
  openDialog($("fishCameraDialog"));
  $("fishCameraStatus").textContent="Opening rear camera…";
  try{
    const stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},audio:false
    });
    if(!cameraOpen||token!==cameraToken){stream.getTracks().forEach(x=>x.stop());return}
    cameraStream=stream;$("fishVideo").srcObject=stream;
    await $("fishVideo").play();
    if(!cameraOpen||token!==cameraToken)return;
    if(typeof window.BarcodeDetector==="function"){
      try{
        const supported=await window.BarcodeDetector.getSupportedFormats?.();
        if(!supported||supported.includes("ean_13")){
          cameraDetector=new window.BarcodeDetector({formats:["ean_13"]});
          $("fishCameraStatus").textContent="Point at one 13-digit barcode.";
          void liveLoop(token);return;
        }
      }catch(_){}
    }
    $("fishCameraStatus").textContent="Starting compatible barcode reader…";
    const ZXing=await legacyScanner();
    if(!cameraOpen||token!==cameraToken)return;
    const hints=new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS,[ZXing.BarcodeFormat.EAN_13]]]);
    cameraReader=new ZXing.BrowserMultiFormatReader(hints,180);
    await cameraReader.decodeFromVideoElementContinuously($("fishVideo"),result=>{
      if(cameraOpen&&token===cameraToken&&result)oneBarcode(result.getText());
    });
  }catch(err){
    if(!cameraOpen||token!==cameraToken)return;
    closeCamera();
    show("fishScanStatus","Camera unavailable: "+(err?.message||"Use manual entry."),true);
  }
}
$("fishPhotos").addEventListener("change",e=>{void scanImages(e.target.files);e.target.value=""});
$("fishCameraPhoto").addEventListener("change",e=>{void scanImages(e.target.files);e.target.value=""});
$("fishLiveStart").addEventListener("click",()=>void openCamera());
$("fishCameraClose").addEventListener("click",closeCamera);
$("fishCameraDialog").addEventListener("cancel",e=>{e.preventDefault();closeCamera()});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&cameraOpen)closeCamera()});
window.addEventListener("pagehide",closeCamera);
$("fishAddManual").addEventListener("click",()=>openEditor(addEntry()));
$("fishEditForm").addEventListener("submit",saveEditor);
$("fishEditCancel").addEventListener("click",()=>closeDialog($("fishEditDialog")));
$("fishEditRemove").addEventListener("click",()=>{if(editing)removeEntry(editing);editing=null;closeDialog($("fishEditDialog"))});
$("fishImageClose").addEventListener("click",()=>closeDialog($("fishImageDialog")));
$("fishNewSheet").addEventListener("click",newSheet);
const now=new Date();
$("fishDate").value=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
render();
window.FishProductionApp={entries,createSnapshot,render,openEditor,addEntry,inferPrintedText,oneBarcode,
  scanImages,detectBarcodes,closeCamera};
})();