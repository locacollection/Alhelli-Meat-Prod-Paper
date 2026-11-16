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
    const other=out.find(q=>q.barcode===item.barcode&&
      Math.abs(q.x-item.x)<Math.max(q.w,item.w)*.75&&
      Math.abs(q.y-item.y)<Math.max(q.w,item.w)*.65);
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
async function fromCanvas(canvas,core,parser,progress){
  const regions=await detectRegions(canvas,core,progress);
  let worker=null,ocrError="";
  try{worker=await(await ocrLibrary()).createWorker("eng")}
  catch(err){ocrError=err.message||"OCR engine unavailable";}
  const results=[];
  const tasks=regions.length?regions:[{barcode:"",x:canvas.width*.2,y:canvas.height*.73,
    w:canvas.width*.46,h:canvas.height*.06,precision:0,noBarcode:true}];
  // If no barcode, inspect the whole image as ONE label; sheet geometry is
  // unknown, so the user must type the 13-digit barcode manually.
  for(const [i,region] of tasks.entries()){
    progress?.("Reading printed label "+(i+1)+"/"+tasks.length);
    const cropped=region.noBarcode?canvas:cropCanvas(canvas,region,regions,parser).canvas;
    const localBox=region.noBarcode?null:
      parser.labelCropRegion(canvas.width,canvas.height,region,regions).barcodeBox;
    let fields={weight_grams:null,unit_price_fils:null,total_price_fils:null,
      product_code:null,read_from_photo:{weight:false,unit:false,total:false}};
    let note=ocrError;
    if(worker){
      try{
        const recognized=await worker.recognize(cropped);
        fields=parser.detectPrinted(recognized,{barcodeBox:localBox});
      }catch(err){note=err.message||"Could not read printed values";}
    }
    const blob=await makeBlob(cropped);
    results.push({barcode:region.barcode,fields,
      photoUrl:blob?URL.createObjectURL(blob):"",
      notes:note,needsBarcode:!!region.noBarcode});
  }
  try{await worker?.terminate()}catch(_){}
  return {labels:results,count:regions.length,warning:ocrError,
    fallback:!regions.length};
}
async function readFile(file,core,parser,progress){
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
    return await fromCanvas(canvas,core,parser,progress);
  }finally{
    try{image?.close?.()}catch(_){}
    if(imgUrl)URL.revokeObjectURL(imgUrl);
  }
}
async function readCameraFrame(video,barcode,region,core,parser,progress){
  const frame=document.createElement("canvas");
  frame.width=video.videoWidth||1280;frame.height=video.videoHeight||720;
  frame.getContext("2d").drawImage(video,0,0,frame.width,frame.height);
  let boxes=[];
  if(region?.width>0){
    boxes=[{barcode,x:region.x,y:region.y,w:region.width,h:region.height,precision:3}];
  }
  if(!boxes.length)boxes=await detectRegions(frame,core,progress);
  const target=boxes.find(x=>x.barcode===barcode);
  const result=await fromCanvas(frame,core,parser,progress);
  const matched=result.labels.find(e=>e.barcode===barcode);
  if(matched)return matched;
  if(target){
    const crop=cropCanvas(frame,target,[target],parser);
    const blob=await makeBlob(crop.canvas);
    return {barcode,photoUrl:blob?URL.createObjectURL(blob):"",fields:{
      weight_grams:null,unit_price_fils:null,total_price_fils:null,
      product_code:null,read_from_photo:{weight:false,unit:false,total:false}},
      notes:"Barcode captured. Verify weight, unit price and total from the photo."};
  }
  return result.labels[0]?{...result.labels[0],barcode}:{barcode,photoUrl:"",fields:{}};
}
return {MAX_LABELS,uniquePositions,barcodeFromZXing,scaledImage,detectRegions,
  cropCanvas,fromCanvas,readFile,readCameraFrame};
});