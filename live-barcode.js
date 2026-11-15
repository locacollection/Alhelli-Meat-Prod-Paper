/* Live one-label camera scanner. Camera frames stay in this browser.
   The existing manual-source and 5 g barcode catalog rules remain authoritative. */
(()=>{
"use strict";
const $=id=>document.getElementById(id);
const dialog=$("singleBarcodeDialog");
const video=$("singleBarcodeVideo");
const startButton=$("startSingleScan");
const closeButton=$("closeSingleScan");
const torchButton=$("singleBarcodeTorch");
const status=$("singleBarcodeStatus");
const feedback=$("singleBarcodeFeedback");
let stream=null,reader=null,detector=null,active=false,accepted=false,token=0,timer=null,torchOn=false;
let zxingLibraryPromise=null;
function announce(message,isError=false){
  status.textContent=message;
  status.classList.toggle("scan-error",isError);
}
function cleanup(){
  token++;
  active=false;
  if(timer!==null){clearTimeout(timer);timer=null}
  if(reader){try{reader.reset()}catch(_){}reader=null}
  if(stream){for(const track of stream.getTracks())try{track.stop()}catch(_){}stream=null}
  try{video.pause()}catch(_){}
  video.srcObject=null;
  torchOn=false;
  torchButton.hidden=true;
  torchButton.textContent="Turn flashlight on";
}
function closeScanner(){
  cleanup();
  if(dialog.open){
    if(typeof dialog.close==="function")dialog.close();
    else dialog.removeAttribute("open");
  }
}
function normalizeBarcode(value){
  const code=String(value??"").trim();
  return /^\d{13}$/.test(code)?code:null;
}
function captureLabelFrame(found){
  if(!video.videoWidth||!video.videoHeight)return null;
  try{
    const scale=Math.min(1,1200/Math.max(video.videoWidth,video.videoHeight));
    const frame=document.createElement("canvas");
    frame.width=Math.max(1,Math.round(video.videoWidth*scale));
    frame.height=Math.max(1,Math.round(video.videoHeight*scale));
    frame.getContext("2d").drawImage(video,0,0,frame.width,frame.height);
    let region;
    if(found?.boundingBox){
      const rect=found.boundingBox;
      const bounds=window.MeatProductionChecks.labelCropBounds(frame,{
        x:rect.x*scale,y:rect.y*scale,w:rect.width*scale,h:rect.height*scale
      });
      region=bounds;
    }else{
      region={x:Math.floor(frame.width*.1),y:Math.floor(frame.height*.13),
        w:Math.floor(frame.width*.8),h:Math.floor(frame.height*.74)};
    }
    const out=document.createElement("canvas");
    out.width=Math.max(1,Math.ceil(region.w));out.height=Math.max(1,Math.ceil(region.h));
    out.getContext("2d").drawImage(frame,region.x,region.y,region.w,region.h,0,0,out.width,out.height);
    return out;
  }catch(_){return null}
}
async function attachPreview(entry,frame){
  if(!frame||!entry)return;
  try{
    const blob=await new Promise(resolve=>frame.toBlob(resolve,"image/jpeg",.86));
    if(blob)await window.MeatProductionChecks.keepLabelCrop(entry,blob,"live camera");
  }catch(_){}
}
function acceptSingleBarcode(raw,found){
  if(!active||accepted)return false;
  const barcode=normalizeBarcode(raw);
  if(!barcode)return false;
  const app=window.MeatProductionChecks;
  const lookup=app.catalogFromBarcode(barcode);
  if(!lookup.ok){
    announce(lookup.reason||"Barcode is not in the supported catalog. Try another label.",true);
    return false;
  }
  // Existing insertion ensures 6777 starts a bone-in sheet and preserves
  // insertion order for 6780/6781 in previously selected bone-in groups.
  accepted=true;
  const result=app.insertManualEntry(barcode);
  if(result.error){
    accepted=false;
    announce(result.error,true);
    return false;
  }
  const frame=captureLabelFrame(found);
  closeScanner(); // Switch off the camera immediately after exactly one label.
  $("manualBarcode").value="";
  $("manualBarcodeError").textContent="";
  const summary="Added "+lookup.info.code+" · "+(lookup.grams/1000).toFixed(3)+" kg · "+(lookup.price/1000).toFixed(3)+" BD";
  feedback.textContent=summary;
  feedback.hidden=false;
  void attachPreview(result.entry,frame);
  return true;
}
async function nativeLoop(currentToken){
  if(!active||currentToken!==token)return;
  try{
    if(video.readyState>=2){
      const found=await detector.detect(video);
      if(!active||currentToken!==token)return;
      for(const match of found){
        if(acceptSingleBarcode(match.rawValue,match))return;
      }
    }
  }catch(error){
    if(active&&currentToken===token){
      announce("Camera is running, but barcode reading failed. Hold the label steady or enter its number.",true);
    }
  }
  if(active&&currentToken===token)timer=setTimeout(()=>void nativeLoop(currentToken),150);
}
async function loadZxing(){
  if(window.ZXing?.BrowserMultiFormatReader)return window.ZXing;
  if(!zxingLibraryPromise){
    zxingLibraryPromise=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
      script.async=true;
      script.onload=()=>window.ZXing?.BrowserMultiFormatReader?resolve(window.ZXing):
        reject(new Error("Barcode reader failed to initialize."));
      script.onerror=()=>reject(new Error("The fallback scanner could not load. Check your connection."));
      document.head.append(script);
    }).catch(error=>{zxingLibraryPromise=null;throw error});
  }
  return zxingLibraryPromise;
}
async function startReader(currentToken){
  if(typeof window.BarcodeDetector==="function"){
    try{
      const supported=await window.BarcodeDetector.getSupportedFormats?.();
      if(!supported||supported.includes("ean_13")){
        detector=new window.BarcodeDetector({formats:["ean_13"]});
        if(active&&currentToken===token){
          announce("Point the camera at one EAN-13 barcode. It will be added automatically.");
          void nativeLoop(currentToken);
        }
        return;
      }
    }catch(_){}
  }
  announce("Starting the compatible barcode reader…");
  const ZXing=await loadZxing();
  if(!active||currentToken!==token)return;
  const hints=new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS,[ZXing.BarcodeFormat.EAN_13]]]);
  reader=new ZXing.BrowserMultiFormatReader(hints,180);
  announce("Point the camera at one barcode. Hold the label steady.");
  await reader.decodeFromVideoElementContinuously(video,(result)=>{
    if(active&&currentToken===token&&result)acceptSingleBarcode(result.getText());
  });
}
async function openScanner(){
  if(active)return;
  feedback.hidden=true;feedback.textContent="";
  if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia){
    feedback.hidden=false;
    feedback.textContent="Live scanning requires HTTPS and camera access. You can still type the barcode.";
    return;
  }
  accepted=false;active=true;
  const currentToken=++token;
  torchButton.hidden=true;
  if(typeof dialog.showModal==="function")dialog.showModal();
  else dialog.setAttribute("open","");
  announce("Requesting rear camera access…");
  try{
    const acquired=await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}
    });
    if(!active||token!==currentToken){
      acquired.getTracks().forEach(track=>track.stop());return;
    }
    stream=acquired;
    video.srcObject=acquired;
    await video.play();
    if(!active||token!==currentToken)return;
    const track=acquired.getVideoTracks()[0];
    if(track&&track.getCapabilities?.().torch&&typeof track.applyConstraints==="function"){
      torchButton.hidden=false;
    }
    await startReader(currentToken);
  }catch(error){
    if(!active||token!==currentToken)return;
    const reason=error?.name==="NotAllowedError"?"Camera permission was denied. Allow camera access in your browser.":
      error?.name==="NotFoundError"?"No camera was found. Use manual barcode entry.":
      "Cannot start camera: "+(error?.message||"Unknown error")+". Use manual barcode entry.";
    cleanup();
    announce(reason,true);
  }
}
async function toggleTorch(){
  const track=stream?.getVideoTracks?.()[0];
  if(!track||!track.getCapabilities?.().torch)return;
  try{
    torchOn=!torchOn;
    await track.applyConstraints({advanced:[{torch:torchOn}]});
    torchButton.textContent=torchOn?"Turn flashlight off":"Turn flashlight on";
  }catch(_){
    torchOn=false;
    torchButton.hidden=true;
    announce("The flashlight is unavailable on this camera.");
  }
}
startButton.addEventListener("click",()=>void openScanner());
closeButton.addEventListener("click",closeScanner);
torchButton.addEventListener("click",()=>void toggleTorch());
dialog.addEventListener("cancel",event=>{event.preventDefault();closeScanner()});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&active)closeScanner()});
window.addEventListener("pagehide",cleanup);
window.MeatLiveBarcodeChecks={normalizeBarcode,acceptSingleBarcode,closeScanner,isActive:()=>active};
})();