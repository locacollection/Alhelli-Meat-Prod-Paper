/* Image scanner for learning labels. Reads each barcode and its own nearby
   sticker, then runs browser OCR locally. Never writes to Supabase. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.LearningPhotoScanner=api;
})(typeof window!=="undefined"?window:null,function(){
"use strict";
const MAX_DIM=2400,MAX_LABELS=50;
let ocrLoader=null,zxingLoader=null;
function loadScript(url,check){
  if(check())return Promise.resolve(check());
  return new Promise((resolve,reject)=>{
    const tag=document.createElement("script");tag.src=url;
    tag.onload=()=>check()?resolve(check()):reject(new Error("OCR / barcode library unavailable"));
    tag.onerror=()=>reject(new Error("Could not load image recognition library"));
    document.head.append(tag);
  });
}
async function ocrLibrary(){
  if(!ocrLoader)ocrLoader=loadScript(
    "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
    ()=>window.Tesseract||null).catch(err=>{ocrLoader=null;throw err});
  return ocrLoader;
}
async function zxingLibrary(){
  if(!zxingLoader)zxingLoader=loadScript(
    "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js",
    ()=>window.ZXing?.BrowserMultiFormatReader?window.ZXing:null
  ).catch(err=>{zxingLoader=null;throw err});
  return zxingLoader;
}
function uniquePositions(list){
  const out=[];
  for(const item of list){
    if(!item.barcode)continue;
    const other=out.find(q=>{
      if(q.barcode!==item.barcode)return false;
      const hq=Number.isFinite(q.h)&&q.h>0?q.h:Math.max(12,q.w*.12);
      const hi=Number.isFinite(item.h)&&item.h>0?item.h:Math.max(12,item.w*.12);
      const cxq=q.x+q.w/2,cyq=q.y+hq/2;
      const cxi=item.x+item.w/2,cyi=item.y+hi/2;
      return Math.abs(cxq-cxi)<Math.max(q.w,item.w)*.40&&
        Math.abs(cyq-cyi)<Math.max(hq,hi)*.40;
    });
    if(!other)out.push(item);
    else if(item.precision>other.precision){
      Object.assign(other,item);
    }
  }
  return out.sort((a,b)=>a.y-b.y||a.x-b.x);
}
function barcodeFromZXing(result,x,y){
  if(!result)return null;
  const points=result.getResultPoints?.()||[];
  const coords=points.map(p=>({x:Number(p.getX?.()??p.x),y:Number(p.getY?.()??p.y)}))
    .filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(coords.length>=2){
    const xx=coords.map(p=>p.x),yy=coords.map(p=>p.y);
    const left=Math.min(...xx),right=Math.max(...xx);
    const top=Math.min(...yy),bottom=Math.max(...yy);
    const w=Math.max(48,right-left),h=Math.max(8,bottom-top,w*.07);
    return {barcode:result.getText(),x:x+left,y:y+top-h/2,w,h,precision:2};
  }
  return {barcode:result.getText(),x,y,w:220,h:18,precision:0};
}
async function detectRegions(canvas,core,progress){
  const candidates=[];
  const windows=[{x:0,y:0,w:canvas.width,h:canvas.height}];
  for(const [scale,positions] of [[.63,[0,.38]],[.45,[0,.28,.56]]]){
    for(const u of positions)for(const v of positions){
      const x=Math.floor(canvas.width*u),y=Math.floor(canvas.height*v);
      windows.push({x,y,w:Math.min(canvas.width-x,Math.ceil(canvas.width*scale)),
        h:Math.min(canvas.height-y,Math.ceil(canvas.height*scale))});
    }
  }
  let native=null;
  if(typeof window.BarcodeDetector==="function"){
    try{
      const supported=await window.BarcodeDetector.getSupportedFormats?.();
      if(!supported||supported.includes("ean_13"))
        native=new window.BarcodeDetector({formats:["ean_13"]});
    }catch(_){}
  }
  let zx=null,reader=null;
  if(!native){
    try{
      zx=await zxingLibrary();
      const hints=new Map([[zx.DecodeHintType.POSSIBLE_FORMATS,[zx.BarcodeFormat.EAN_13]]]);
      reader=new zx.BrowserMultiFormatReader(hints,120);
    }catch(_){}
  }
  for(const [i,w] of windows.entries()){
    progress?.("Looking for barcodes: "+(i+1)+"/"+windows.length);
    const tile=document.createElement("canvas");
    tile.width=w.w;tile.height=w.h;
    tile.getContext("2d").drawImage(canvas,w.x,w.y,w.w,w.h,0,0,w.w,w.h);
    if(native){
      try{
        const found=await native.detect(tile);
        for(const f of found){
          const barcode=String(f.rawValue||"").replace(/\s/g,"");
          if(!core.validBarcode(barcode))continue;
          const b=f.boundingBox||{},bw=Number(b.width),bh=Number(b.height);
          candidates.push({barcode,
            x:w.x+(Number.isFinite(b.x)?b.x:w.w*.3),
            y:w.y+(Number.isFinite(b.y)?b.y:w.h*.7),
            w:bw>0?bw:Math.min(w.w*.5,200),
            h:bh>0?bh:18,precision:bw>0?3:0});
        }
      }catch(_){}
    }else if(reader){
      try{
        const img=document.createElement("img");img.src=tile.toDataURL("image/png");
        if(img.decode)await img.decode();
        const value=await reader.decodeFromImageElement(img);
        const candidate=barcodeFromZXing(value,w.x,w.y);
        if(candidate&&core.validBarcode(candidate.barcode))candidates.push(candidate);
      }catch(_){}
    }
  }
  if(native&&candidates.length===0){
    // Some Android browsers expose BarcodeDetector but cannot resolve small
    // labels in photos. Use the ZXing backup rather than returning no labels.
    try{
      const zx2=await zxingLibrary();
      const hints=new Map([[zx2.DecodeHintType.POSSIBLE_FORMATS,[zx2.BarcodeFormat.EAN_13]]]);
      const fallbackReader=new zx2.BrowserMultiFormatReader(hints,120);
      for(const windowBox of windows){
        try{
          const tile=document.createElement("canvas");
          tile.width=windowBox.w;tile.height=windowBox.h;
          tile.getContext("2d").drawImage(canvas,windowBox.x,windowBox.y,
            windowBox.w,windowBox.h,0,0,windowBox.w,windowBox.h);
          const img=document.createElement("img");img.src=tile.toDataURL("image/png");
          if(img.decode)await img.decode();
          const scanned=await fallbackReader.decodeFromImageElement(img);
          const pos=barcodeFromZXing(scanned,windowBox.x,windowBox.y);
          if(pos&&core.validBarcode(pos.barcode))candidates.push(pos);
        }catch(_){}
      }
      try{fallbackReader.reset()}catch(_){}
    }catch(_){}
  }
  try{reader?.reset()}catch(_){}
  return uniquePositions(candidates).slice(0,MAX_LABELS);
}
function scaledImage(src){
  const dim=Math.max(src.width,src.height);
  const factor=Math.min(1,MAX_DIM/dim);
  const width=Math.max(1,Math.round(src.width*factor));
  const height=Math.max(1,Math.round(src.height*factor));
  const canvas=document.createElement("canvas");
  canvas.width=width;canvas.height=height;
  canvas.getContext("2d").drawImage(src,0,0,width,height);
  return canvas;
}
/* BarcodeDetector and ZXing can return a vertical barcode rectangle.
   The sticker content is then to its SIDE, not above it. Normalize candidate
   image rotations first so the old upright crop geometry works again. */
function rotateCanvas(source,turns){
  const t=((Number(turns)%4)+4)%4;
  if(!t)return source;
  const target=document.createElement("canvas");
  target.width=t%2?source.height:source.width;
  target.height=t%2?source.width:source.height;
  const ctx=target.getContext("2d");
  if(t===1){ctx.translate(source.height,0);ctx.rotate(Math.PI/2)}
  if(t===2){ctx.translate(source.width,source.height);ctx.rotate(Math.PI)}
  if(t===3){ctx.translate(0,source.width);ctx.rotate(-Math.PI/2)}
  ctx.drawImage(source,0,0);
  return target;
}
function rotatedBox(box,sourceW,sourceH,turns){
  const t=((Number(turns)%4)+4)%4;
  const {x,y,w,h}=box;
  if(t===1)return {...box,x:sourceH-y-h,y:x,w:h,h:w};
  if(t===2)return {...box,x:sourceW-x-w,y:sourceH-y-h};
  if(t===3)return {...box,x:y,y:sourceW-x-w,w:h,h:w};
  return {...box};
}
function candidateAngles(box){
  if(!box)return [0];
  // Vertical barcodes require a 90/270 rotation before using a
  // sticker-above-barcode crop. Do not force the wrong orientation.
  return box.h>box.w*1.18?[1,3]:[0,2];
}
function rotatedLabelCrop(source,box,others,parser,turns=0,cache=null){
  const rotated=cache?.get(turns)||rotateCanvas(source,turns);
  cache?.set(turns,rotated);
  const oriented=rotatedBox(box,source.width,source.height,turns);
  const neighbors=others.map(b=>b===box?oriented:rotatedBox(b,source.width,source.height,turns));
  const region=cropCanvas(rotated,oriented,neighbors,parser);
  return {...region,turns,sourceWidth:rotated.width,sourceHeight:rotated.height};
}
function labelRecognitionScore(result,parser,expectedPrice=null){
  const data=result?.data||result||{};
  const text=String(data.text||"").toUpperCase();
  const printed=parser.detectPrinted(result);
  let score=0;
  if(/\bWEIGHT\b|\bUNIT\s*PRICE\b/.test(text))score+=3;
  if(/\bTOTAL\b/.test(text))score+=2;
  if(/\bSALMON\b|\bBEEF\b|\bCHEES\b|\bFISH\b/.test(text))score+=5;
  if(printed.product_code)score+=4;
  if(Number.isInteger(printed.weight_grams))score+=2;
  if(Number.isInteger(printed.unit_price_fils))score+=2;
  if(Number.isInteger(printed.total_price_fils)){
    score+=2;
    if(Number.isInteger(expectedPrice)&&printed.total_price_fils===expectedPrice)score+=4;
  }
  // Do not reward arbitrary date digits as evidence of a correct crop.
  return {score,fields:printed};
}
async function chooseOrientedCrop(source,box,others,parser,worker,cache,expectedPrice=null){
  const angles=candidateAngles(box);
  let chosen=null;
  for(const turns of angles){
    const crop=rotatedLabelCrop(source,box,others,parser,turns,cache);
    if(!worker){
      if(!chosen)chosen={...crop,fields:null,score:0};
      continue;
    }
    let result=null;
    try{result=await worker.recognize(crop.canvas)}catch(_){}
    const scored=labelRecognitionScore(result,parser,expectedPrice);
    if(!chosen||scored.score>chosen.score)
      chosen={...crop,fields:scored.fields,score:scored.score};
    // A confident upright OCR read eliminates the cost of another pass.
    if(scored.score>=16)break;
  }
  return chosen;
}

function cropCanvas(canvas,region,regions,parser){
  const box=parser.labelCropRegion(canvas.width,canvas.height,region,regions);
  const cropped=document.createElement("canvas");
  cropped.width=box.w;cropped.height=box.h;
  cropped.getContext("2d").drawImage(canvas,box.x,box.y,box.w,box.h,0,0,box.w,box.h);
  return {canvas:cropped,barcodeBox:box.barcodeBox};
}
function makeBlob(canvas){
  return new Promise(resolve=>{
    if(typeof canvas.toBlob==="function")canvas.toBlob(blob=>resolve(blob),"image/jpeg",.88);
    else resolve(null);
  });
}
function enhanceNumberRegion(canvas,mode="gray"){
  const scale=Math.max(2,Math.min(4,Math.ceil(380/Math.max(1,canvas.width))));
  const out=document.createElement("canvas");
  out.width=Math.max(1,Math.round(canvas.width*scale));
  out.height=Math.max(1,Math.round(canvas.height*scale));
  const ctx=out.getContext("2d",{willReadFrequently:true});
  ctx.imageSmoothingEnabled=true;
  ctx.drawImage(canvas,0,0,out.width,out.height);
  const img=ctx.getImageData(0,0,out.width,out.height);
  for(let i=0;i<img.data.length;i+=4){
    const r=img.data[i],g=img.data[i+1],b=img.data[i+2];
    const light=Math.round(.299*r+.587*g+.114*b);
    let value=mode==="threshold"?(light>133?255:0):
      mode==="bright"?Math.max(0,Math.min(255,(light-100)*2.15+110)):
      Math.max(0,Math.min(255,(light-128)*1.65+150));
    img.data[i]=img.data[i+1]=img.data[i+2]=value;
  }
  ctx.putImageData(img,0,0);
  return out;
}
async function readNumberBoxes(worker,canvas,barcodeBox,parser,progress,already={},core=null,options={}){
  const got={},notes=[],rawCandidates={};
  // Unit price is never OCR scanned here. Use the selected item's saved rate.
  const kinds=[["weight","weight_grams"],["total","total_price_fils"]];
  const rate=Number.isInteger(options.unit_price_fils)?
    options.unit_price_fils:already.unit_price_fils;
  const total=Number.isInteger(already.total_price_fils)?
    already.total_price_fils:options.expected_total_fils;
  const rounding=Number(options.rounding_fils)||5;
  const step=Number(options.weight_step_grams)||1;
  const hasPriceCheck=core&&Number.isInteger(rate)&&Number.isInteger(total);
  const matchesPrice=grams=>!hasPriceCheck||
    (grams>0&&grams%step===0&&core.roundedPrice(grams,rate,rounding)===total);
  for(const [key,property] of kinds){
    // Even when generic OCR found weight, verify the actual green-table cell.
    if(key!=="weight"&&Number.isInteger(already[property]))continue;
    const windows=typeof parser.numericWindows==="function"?
      parser.numericWindows(key,barcodeBox,canvas.width,canvas.height):
      [parser.numericWindow(key,barcodeBox,canvas.width,canvas.height)].filter(Boolean);
    if(!windows.length)continue;
    const seen=[];
    try{
      for(let wi=0;wi<windows.length;wi++){
        const rect=windows[wi];
        const source=document.createElement("canvas");
        source.width=rect.w;source.height=rect.h;
        source.getContext("2d").drawImage(canvas,rect.x,rect.y,rect.w,rect.h,
          0,0,rect.w,rect.h);
        for(const mode of ["gray","threshold","bright"]){
          await worker.setParameters({tessedit_pageseg_mode:mode==="gray"?"7":"13",
            tessedit_char_whitelist:"0123456789.,",
            preserve_interword_spaces:"1"});
          const image=enhanceNumberRegion(source,mode);
          const result=await worker.recognize(image);
          const candidates=parser.numericCandidates(result?.data?.text||"",{
            allowCompactWeight:key==="weight"&&!!hasPriceCheck
          });
          if(candidates.length===1)seen.push(candidates[0]);
          // Confirmed by two independent image treatments from the strict
          // weight field. Avoid reading arbitrary nearby sticker numbers.
          if(seen.length>=2&&seen.at(-1)===seen.at(-2)&&
            (key!=="weight"||matchesPrice(seen.at(-1))))break;
        }
        if(seen.length>=2&&seen.at(-1)===seen.at(-2)&&
          (key!=="weight"||matchesPrice(seen.at(-1))))break;
      }
    }catch(err){notes.push("Could not re-read "+key+" field: "+(err?.message||"OCR failed"))}
    finally{
      try{await worker.setParameters({tessedit_pageseg_mode:"3",
        tessedit_char_whitelist:""})}catch(_){}
    }
    rawCandidates[key]=seen;
    const unique=[...new Set(seen)];
    if(unique.length===1){
      if(key!=="weight"||matchesPrice(unique[0]))got[key]=unique[0];
      else notes.push("Focused weight OCR conflicts with saved rate and label total. Verify printed weight.");
    }
    else if(unique.length>1){
      // Different guesses from the same printed field are not silently
      // accepted. Price arithmetic may reject some guesses, but a 5-fil
      // rounded price cannot justify inventing a printed weight.
      if(key==="weight"&&core){
        const finalTotal=Number.isInteger(total)?total:got.total;
        if(Number.isInteger(finalTotal)&&Number.isInteger(rate)){
          const consistent=unique.filter(x=>x>0&&x%step===0&&
            core.roundedPrice(x,rate,rounding)===finalTotal);
          if(consistent.length===1)got[key]=consistent[0];
        }
      }
      if(!Number.isInteger(got[key]))
        notes.push("Multiple readings disagree about "+key+". Check the printed sticker.");
    }
    progress?.("Checking printed "+key+"…");
  }
  if(!Number.isInteger(got.weight)&&core){
    const finalTotal=Number.isInteger(total)?total:got.total;
    if(Number.isInteger(rate)&&Number.isInteger(finalTotal)){
      const guesses=[...new Set(rawCandidates.weight||[])];
      const matched=guesses.filter(n=>n>0&&n%step===0&&
        core.roundedPrice(n,rate,rounding)===finalTotal);
      if(matched.length===1){
        got.weight=matched[0];
        // It remains an OCR value: one localized print reading matches the
        // unit rate and total, not a barcode-inferred fabricated weight.
        const idx=notes.findIndex(x=>x.includes("Multiple readings disagree about weight"));
        if(idx>=0)notes.splice(idx,1);
        notes.push("Weight readings differed. The printed number matching the unit price and total was selected for review.");
      }
    }
  }
  const weightEvidence=(rawCandidates.weight||[]).filter(x=>x===got.weight).length;
  return {values:got,notes,candidates:rawCandidates,
    strongWeightEvidence:Number.isInteger(got.weight)&&weightEvidence>=2};
}
async function fromCanvas(canvas,core,parser,progress,profileForBarcode){
  const regions=await detectRegions(canvas,core,progress);
  let worker=null,ocrError="";
  try{worker=await(await ocrLibrary()).createWorker("eng")}
  catch(err){ocrError=err.message||"OCR engine unavailable";}
  const results=[];
  const canvasCache=new Map([[0,canvas]]);
  const sheetBlob=await makeBlob(canvas);
  const sheetPhotoUrl=sheetBlob?URL.createObjectURL(sheetBlob):"";
  const tasks=regions.length?regions:[{barcode:"",x:canvas.width*.2,y:canvas.height*.73,
    w:canvas.width*.46,h:canvas.height*.06,precision:0,noBarcode:true}];
  // If no barcode, inspect the whole image as ONE label; sheet geometry is
  // unknown, so the user must type the 13-digit barcode manually.
  for(const [i,region] of tasks.entries()){
    progress?.("Reading printed label "+(i+1)+"/"+tasks.length);
    const profile=typeof profileForBarcode==="function"?
      profileForBarcode(region.barcode)||{}:{};
    const expectedPrice=region.barcode?Number(region.barcode.slice(7,12)):null;
    const verifiedTotal=parser.derivePriceFromBarcode(
      region.barcode,core,profile.verified_price_prefix||"");
    const context={...profile,expected_total_fils:verifiedTotal};
    const candidate=region.noBarcode?null:await chooseOrientedCrop(
      canvas,region,regions,parser,worker,canvasCache,expectedPrice);
    const cropped=candidate?.canvas||canvas;
    const localBox=candidate?.barcodeBox||null;
    let fields={weight_grams:null,unit_price_fils:null,total_price_fils:null,
      product_code:null,read_from_photo:{weight:false,unit:false,total:false}};
    let note=ocrError;
    if(worker){
      try{
        const recognized=await worker.recognize(cropped);
        fields=parser.detectPrinted(recognized,{barcodeBox:localBox});
        if(!region.noBarcode&&localBox){
          const targeted=await readNumberBoxes(worker,cropped,localBox,parser,
            progress,fields,core,context);
          fields=parser.supplementPrinted(fields,targeted.values,{
            core,rate:context.unit_price_fils,rounding_fils:context.rounding_fils,
            strongWeightEvidence:targeted.strongWeightEvidence
          });
          if(targeted.notes.length)note=[note,...targeted.notes].filter(Boolean).join(" ");
        }
      }catch(err){note=err.message||"Could not read printed values";}
    }
    if(candidate?.score<3&&region.barcode)
      note=[note,"Crop may be incomplete. Use View original sheet to check the sticker."]
        .filter(Boolean).join(" ");
    const blob=await makeBlob(cropped);
    results.push({barcode:region.barcode,fields,
      photoUrl:blob?URL.createObjectURL(blob):"",
      sheetPhotoUrl,rotation:(candidate?.turns||0)*90,
      cropScore:candidate?.score??0,
      notes:note,needsBarcode:!!region.noBarcode});
  }
  try{await worker?.terminate()}catch(_){}
  return {labels:results,count:regions.length,warning:ocrError,
    fallback:!regions.length};
}
async function readFile(file,core,parser,progress,profileForBarcode){
  let image=null,imgUrl="";
  try{
    if(typeof createImageBitmap==="function"){
      image=await createImageBitmap(file);
    }else{
      imgUrl=URL.createObjectURL(file);
      image=document.createElement("img");image.src=imgUrl;
      await image.decode();
    }
    const canvas=scaledImage(image);
    return await fromCanvas(canvas,core,parser,progress,profileForBarcode);
  }finally{
    try{image?.close?.()}catch(_){}
    if(imgUrl)URL.revokeObjectURL(imgUrl);
  }
}
async function readCameraFrame(video,barcode,region,core,parser,progress,profileForBarcode){
  const frame=document.createElement("canvas");
  frame.width=video.videoWidth||1280;frame.height=video.videoHeight||720;
  // Take the snapshot before the live camera stream is stopped.
  frame.getContext("2d").drawImage(video,0,0,frame.width,frame.height);
  let boxes=[];
  if(region?.width>0){
    boxes=[{barcode,x:region.x,y:region.y,w:region.width,h:region.height,precision:3}];
  }
  if(!boxes.length)boxes=await detectRegions(frame,core,progress);
  const target=boxes.find(x=>x.barcode===barcode);
  if(!target){
    const full=await fromCanvas(frame,core,parser,progress,profileForBarcode);
    const matched=full.labels.find(x=>x.barcode===barcode);
    if(matched)return matched;
    const other=full.labels[0];
    return other?{...other,barcode,notes:"Check this full image and all printed values."}:
      {barcode,photoUrl:"",fields:{},notes:"Barcode captured. Check printed values manually."};
  }
  progress?.("Reading printed weight and total using the saved profile rate…");
  let fields={weight_grams:null,unit_price_fils:null,total_price_fils:null,
    product_code:null,read_from_photo:{weight:false,unit:false,total:false}};
  let notes="",worker=null,crop=null;
  try{
    worker=await(await ocrLibrary()).createWorker("eng");
    const cache=new Map([[0,frame]]);
    crop=await chooseOrientedCrop(frame,target,boxes,parser,worker,cache,
      Number(barcode.slice(7,12)));
    const recognized=await worker.recognize(crop.canvas);
    fields=parser.detectPrinted(recognized,{barcodeBox:crop.barcodeBox});
    const profile=typeof profileForBarcode==="function"?
      profileForBarcode(barcode)||{}:{};
    const verifiedTotal=parser.derivePriceFromBarcode(
      barcode,core,profile.verified_price_prefix||"");
    const targeted=await readNumberBoxes(worker,crop.canvas,crop.barcodeBox,
      parser,progress,fields,core,{...profile,expected_total_fils:verifiedTotal});
    fields=parser.supplementPrinted(fields,targeted.values,{
      core,rate:profile.unit_price_fils,rounding_fils:profile.rounding_fils,
      strongWeightEvidence:targeted.strongWeightEvidence
    });
    if(targeted.notes.length)notes=targeted.notes.join(" ");
  }catch(err){notes="Printed values need manual review: "+(err.message||"OCR unavailable")}
  finally{try{await worker?.terminate()}catch(_){}}
  crop||=rotatedLabelCrop(frame,target,boxes,parser,candidateAngles(target)[0]);
  const blob=await makeBlob(crop.canvas);
  const full=await makeBlob(frame);
  return {barcode,photoUrl:blob?URL.createObjectURL(blob):"",
    sheetPhotoUrl:full?URL.createObjectURL(full):"",rotation:crop.turns*90,
    fields,notes};
}

async function readWeightAtPoint(photoUrl,relativeX,relativeY,parser,core,context={}){
  if(typeof document==="undefined"||!photoUrl)throw new Error("A cropped label photo is required.");
  if(!Number.isFinite(relativeX)||!Number.isFinite(relativeY)||
      relativeX<0||relativeX>1||relativeY<0||relativeY>1)
    throw new Error("Tap inside the label photo.");
  const image=document.createElement("img");
  image.src=photoUrl;
  if(image.decode)await image.decode();
  else await new Promise((resolve,reject)=>{
    image.onload=resolve;image.onerror=()=>reject(new Error("Could not open crop"));
  });
  const iw=image.naturalWidth||image.width,ih=image.naturalHeight||image.height;
  if(!iw||!ih)throw new Error("No visible label image.");
  const centerX=relativeX*iw,centerY=relativeY*ih;
  // Let the employee select the number, rather than relying on an uncertain
  // barcode-relative ROI. Keep the box small enough to exclude nearby dates.
  const width=Math.min(iw,Math.max(45,iw*.30));
  const height=Math.min(ih,Math.max(20,ih*.15));
  const x=Math.min(iw-width,Math.max(0,centerX-width/2));
  const y=Math.min(ih-height,Math.max(0,centerY-height/2));
  const source=document.createElement("canvas");
  source.width=Math.ceil(width);source.height=Math.ceil(height);
  source.getContext("2d").drawImage(image,x,y,width,height,0,0,source.width,source.height);
  let worker=null,reads=[];
  try{
    worker=await(await ocrLibrary()).createWorker("eng");
    for(const mode of ["gray","threshold"]){
      await worker.setParameters({tessedit_pageseg_mode:mode==="gray"?"7":"13",
        tessedit_char_whitelist:"0123456789.,",
        preserve_interword_spaces:"1"});
      const recognized=await worker.recognize(enhanceNumberRegion(source,mode));
      const candidates=parser.numericCandidates(recognized?.data?.text||"",{
        allowCompactWeight:Number.isInteger(context.unit_price_fils)&&
          Number.isInteger(context.total_price_fils)
      });
      if(candidates.length===1)reads.push(candidates[0]);
    }
  }finally{try{await worker?.terminate()}catch(_){}}
  let candidates=[...new Set(reads)];
  const step=Number(context.step||1);
  candidates=candidates.filter(n=>n>0&&n<=100000&&n%step===0);
  if(candidates.length>1&&core&&
      Number.isInteger(context.unit_price_fils)&&Number.isInteger(context.total_price_fils)){
    const matched=candidates.filter(n=>
      core.roundedPrice(n,context.unit_price_fils,context.rounding_fils||5)===
        context.total_price_fils);
    if(matched.length===1)candidates=matched;
  }
  if(candidates.length!==1)return {ok:false,
    error:"Could not confidently read one weight. Tap the center of the printed number, or enter it manually.",
    candidates};
  const grams=candidates[0];
  if(core&&Number.isInteger(context.unit_price_fils)&&
      Number.isInteger(context.total_price_fils)&&
      core.roundedPrice(grams,context.unit_price_fils,context.rounding_fils||5)!==
        context.total_price_fils)
    return {ok:false,error:"The tapped number doesn't agree with the label's price. Recheck the weight.",
      candidates};
  return {ok:true,weight_grams:grams,source:"Focused OCR of the printed number you tapped"};
}

return {MAX_LABELS,uniquePositions,barcodeFromZXing,scaledImage,detectRegions,
  rotateCanvas,rotatedBox,candidateAngles,rotatedLabelCrop,labelRecognitionScore,
  chooseOrientedCrop,enhanceNumberRegion,readNumberBoxes,readWeightAtPoint,cropCanvas,fromCanvas,readFile,readCameraFrame};
});