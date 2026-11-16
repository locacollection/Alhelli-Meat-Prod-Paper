/* Standalone, read-only barcode prediction from a selected private learning profile.
   Uses the same conservative BarcodeLearningCore as the training screen. */
(()=>{
"use strict";
const PROJECT_URL="https://tvaqcbzmzpyltbbelwbw.supabase.co";
const PUBLIC_KEY="sb_publishable_yqrAl20jwQlW4J8furYn3Q_kjQFIFrr";
const TABLE="barcode_learning_profiles";
const core=window.BarcodeLearningCore;
const $=id=>document.getElementById(id);
let client=null,user=null,profiles=[],profilesRequest=0;
let currentPrediction=null,scannedActualBarcode=null;
let cameraActive=false,cameraToken=0,cameraStream=null,cameraDetector=null;
let cameraTimer=null,cameraReader=null,zxingLoader=null;
const cameraDialog=$("predictorCameraDialog"),cameraVideo=$("predictorCameraVideo");

function message(id,content,isError=false){
  const node=$(id);node.textContent=content||"";
  node.hidden=!content;
  node.classList.toggle("is-error",!!isError);
}
function option(value,text){
  const el=document.createElement("option");
  el.value=value;el.textContent=text;return el;
}
function money(fils){
  return Number.isInteger(fils)?(fils/1000).toFixed(3)+" BD":"Unavailable";
}
function formatWeight(grams){
  return Number.isInteger(grams)?(grams/1000).toFixed(3)+" kg":"Unavailable";
}
function selectedProfile(){
  const id=$("predictorProfile").value;
  return profiles.find(p=>p.id===id)||null;
}
function clearVerificationResult(){
  $("predictorVerificationResult").hidden=true;
  $("predictorVerificationResult").classList.remove("is-mismatch");
  $("predictorVerificationTitle").textContent="";
  $("predictorVerificationDetails").textContent="";
}
function resetVerification(){
  stopCamera();
  scannedActualBarcode=null;
  for(const id of ["predictorActualBarcode","predictorActualWeight","predictorActualTotal"])
    $(id).value="";
  $("predictorVerifyPanel").hidden=true;
  clearVerificationResult();
  message("predictorCameraFeedback","");
}
function clearResult(){
  currentPrediction=null;
  resetVerification();
  $("predictorResult").hidden=true;
  $("predictorResult").classList.remove("is-unavailable");
  $("predictorBarcodeBlock").hidden=true;
  $("predictorResultBarcode").textContent="";
  message("predictorMessage","");
}
function profileLabel(p){
  return p.item_code+" · "+p.product_name+" · "+money(p.unit_price_fils)+"/kg";
}
function renderProfileSummary(){
  const p=selectedProfile(),box=$("predictorProfileSummary");
  box.replaceChildren();
  if(!p){
    box.textContent="Select an item to view its saved unit price and barcode training status.";
    return;
  }
  const heading=document.createElement("strong");
  heading.textContent=p.item_code+" · "+p.product_name;
  const meta=document.createElement("span");
  meta.textContent="Saved rate: "+money(p.unit_price_fils)+"/kg · Weight increments: "+
    p.weight_step_grams+" g · Rounding: "+p.rounding_fils+" fils";
  const state=document.createElement("span");
  state.textContent=p.review_status==="validated"?
    "Training status: Validated on saved label samples · "+(p.sample_count||0)+" samples.":
    "Training status: "+(p.review_status||"Collecting")+
      ". Predicting requires a validated pattern from confirmed samples.";
  box.append(heading,meta,state);
}
function renderProfiles(preferred=""){
  const select=$("predictorProfile");
  select.replaceChildren(option("","Select a saved item profile"));
  for(const p of profiles){
    const status=p.review_status==="validated"?"Validated":"Needs training";
    select.append(option(p.id,profileLabel(p)+" · "+status));
  }
  if(profiles.some(p=>p.id===preferred))select.value=preferred;
  select.disabled=!user||!profiles.length;
  $("predictorSubmit").disabled=!user||!profiles.length;
  renderProfileSummary();
}
async function loadProfiles(){
  if(!client||!user)return;
  const ticket=++profilesRequest,owner=user.id,preferred=$("predictorProfile").value;
  message("predictorMessage","Loading saved profiles…");
  try{
    const {data,error}=await client.from(TABLE)
      .select("id,owner_id,item_code,product_name,unit_price_fils,weight_step_grams,rounding_fils,barcode_prefix,pattern_mode,review_status,sample_count")
      .eq("owner_id",owner)
      .order("product_name",{ascending:true}).limit(500);
    if(error)throw error;
    if(ticket!==profilesRequest||user?.id!==owner)return;
    profiles=data||[];
    renderProfiles(preferred);
    message("predictorMessage",profiles.length?"":"No saved profiles yet. Create one in Barcode Learning.",!profiles.length);
  }catch(err){
    if(ticket!==profilesRequest)return;
    profiles=[];renderProfiles();
    message("predictorMessage","Could not load saved profiles: "+(err.message||err),true);
  }
}
function setUser(next){
  const oldId=user?.id;
  user=next||null;
  $("predictorAuth").hidden=!!user;
  $("predictorWorkspace").hidden=!user;
  $("predictorUsername").textContent=user?.email||"";
  if(!user){
    profilesRequest++;
    profiles=[];renderProfiles();
    clearResult();
    $("predictorWeight").value="";
  }else if(oldId!==user.id){
    clearResult();
    void loadProfiles();
  }
}
async function initialize(){
  if(!core||!window.supabase?.createClient){
    message("predictorAuthMessage","Could not load the barcode decoder or Supabase connection. Check your internet connection.",true);
    return;
  }
  client=window.supabase.createClient(PROJECT_URL,PUBLIC_KEY);
  try{
    const {data,error}=await client.auth.getSession();
    if(error)throw error;
    setUser(data?.session?.user||null);
    client.auth.onAuthStateChange((_event,session)=>{
      if(session?.user?.id!==user?.id)setUser(session?.user||null);
    });
  }catch(err){
    message("predictorAuthMessage","Unable to load session: "+err.message,true);
    setUser(null);
  }
}
async function login(e){
  e.preventDefault();
  if(!client)return message("predictorAuthMessage","Database is unavailable.",true);
  $("predictorLogin").disabled=true;
  message("predictorAuthMessage","Signing in…");
  try{
    const {data,error}=await client.auth.signInWithPassword({
      email:$("predictorEmail").value.trim(),password:$("predictorPassword").value
    });
    if(error)throw error;
    $("predictorPassword").value="";
    setUser(data?.user||null);
    message("predictorAuthMessage","");
  }catch(err){message("predictorAuthMessage","Sign in failed: "+err.message,true)}
  finally{$("predictorLogin").disabled=false}
}
function showPrediction(p,grams,result){
  const total=core.roundedPrice(grams,Number(p.unit_price_fils),Number(p.rounding_fils));
  const available=!!result.ok;
  const ambiguous=available&&result.ambiguous===true;
  const box=$("predictorResult");
  box.hidden=false;
  box.classList.toggle("is-unavailable",!available||ambiguous);
  $("predictorResultTitle").textContent=p.item_code+" · "+p.product_name;
  $("predictorResultState").textContent=ambiguous?
    "Price-coded candidate · weight ambiguous":available?"Unique pattern match":"Prediction not confirmed";
  $("predictorResultWeight").textContent=formatWeight(grams);
  $("predictorResultRate").textContent=money(p.unit_price_fils);
  $("predictorResultPrice").textContent=money(total);
  $("predictorBarcodeBlock").hidden=!available;
  $("predictorBarcodeLabel").textContent=ambiguous?
    "Calculated EAN-13 candidate (weight not verified)":"Predicted EAN-13 barcode";
  $("predictorResultBarcode").textContent=available?result.barcode:"";
  currentPrediction=available?{profileId:p.id,barcode:result.barcode,grams}:null;
  $("predictorResultExplanation").textContent=available?
    (result.warning||"Calculated from your saved profile. Compare with the actual sticker. Not authorized for store checkout or production records."):
    (result.error||"This profile cannot generate a barcode for this weight.")+
      " The displayed total comes from the saved rate, not a verified label price.";
}
function predict(e){
  e.preventDefault();
  clearResult();
  if(!user||!core)return message("predictorMessage","Sign in to access saved learning profiles.",true);
  const profile=selectedProfile();
  if(!profile)return message("predictorMessage","Select a saved item profile first.",true);
  const grams=core.parseAmount($("predictorWeight").value);
  if(!Number.isInteger(grams)||grams<1||grams>100000){
    return message("predictorMessage","Enter a weight from 0.001 to 100.000 kg using up to three decimal places.",true);
  }
  if(grams%Number(profile.weight_step_grams)!==0){
    return message("predictorMessage","This item's weights must be in "+
      profile.weight_step_grams+" g increments. Check your entered weight.",true);
  }
  const unique=core.suggestBarcode(grams,profile);
  // A price-encoded format may produce one EAN for multiple possible weights.
  // Display it as a clearly marked unverified candidate, never as a unique weight.
  const candidate=!unique.ok&&typeof core.suggestBarcodeCandidate==="function"?
    core.suggestBarcodeCandidate(grams,profile):null;
  showPrediction(profile,grams,candidate?.ok?candidate:unique);
}
async function copyPrediction(){
  const code=$("predictorResultBarcode").textContent;
  if(!core.validBarcode(code))return;
  try{
    await navigator.clipboard.writeText(code);
    message("predictorMessage","Calculated barcode copied. Compare it with an actual printed sticker; this does not verify the weight.");
  }catch(_){
    message("predictorMessage","Copy unavailable. Select the displayed number and copy it manually.",true);
  }
}

function openVerification(){
  if(!user||!currentPrediction)return;
  $("predictorVerifyPanel").hidden=false;
  clearVerificationResult();
  message("predictorCameraFeedback","");
  $("predictorVerifyPanel").scrollIntoView?.({behavior:"smooth",block:"nearest"});
}
function verifyAgainstPrintedLabel(e){
  e.preventDefault();
  clearVerificationResult();
  if(!user||!currentPrediction)
    return message("predictorCameraFeedback","Predict a barcode first, then compare it with a real sticker.",true);
  const profile=selectedProfile();
  if(!profile||profile.id!==currentPrediction.profileId)
    return message("predictorCameraFeedback","The selected item changed. Predict again before verifying.",true);
  const printedCode=core.cleanBarcode($("predictorActualBarcode").value);
  const printedWeight=core.parseAmount($("predictorActualWeight").value);
  const printedTotal=core.parseAmount($("predictorActualTotal").value);
  if(printedWeight===null||printedTotal===null)
    return message("predictorCameraFeedback","Enter the weight and total price exactly as printed on the sticker.",true);
  const checked=core.verifyPredictedAgainstLabel({
    profile,predicted_barcode:currentPrediction.barcode,
    requested_weight_grams:currentPrediction.grams,
    printed_barcode:printedCode,
    printed_weight_grams:printedWeight,printed_total_fils:printedTotal
  });
  const fromCamera=scannedActualBarcode===printedCode;
  const result=$("predictorVerificationResult");
  result.hidden=false;
  result.classList.toggle("is-mismatch",!checked.ok||!fromCamera);
  if(!checked.ok){
    $("predictorVerificationTitle").textContent="Does not match the prediction";
    $("predictorVerificationDetails").textContent=checked.errors.join("\n")+
      "\nRecheck the physical sticker and try again.";
  }else if(fromCamera){
    $("predictorVerificationTitle").textContent="Matches scanned barcode and entered label values";
    $("predictorVerificationDetails").textContent="The scanned EAN-13, printed "+
      core.formatAmount(printedWeight)+" kg, and printed "+core.formatAmount(printedTotal)+
      " BD agree with this prediction."+(checked.ambiguous_weight?
      " The barcode encodes a price that may correspond to other weights; the printed weight must still be checked independently.":"")+
      " This is a label comparison only, not checkout authorization.";
  }else{
    $("predictorVerificationTitle").textContent="Manually entered details match";
    $("predictorVerificationDetails").textContent="The entered barcode, weight and price agree with the prediction. This is not an independent scan or proof of a physical sticker. Use Scan real barcode for stronger comparison. It does not authorize checkout.";
  }
  message("predictorCameraFeedback","");
}
function stopCamera(){
  cameraToken++;cameraActive=false;
  if(cameraTimer!==null){clearTimeout(cameraTimer);cameraTimer=null}
  if(cameraReader){try{cameraReader.reset()}catch(_){}cameraReader=null}
  if(cameraStream){for(const track of cameraStream.getTracks())try{track.stop()}catch(_){}cameraStream=null}
  try{cameraVideo.pause()}catch(_){}
  cameraVideo.srcObject=null;
  if(cameraDialog.open){
    if(cameraDialog.close)cameraDialog.close();
    else cameraDialog.removeAttribute("open");
  }
}
function capturePrintedBarcode(raw){
  if(!cameraActive||!currentPrediction)return false;
  const code=core.cleanBarcode(raw);
  if(!core.validBarcode(code)){
    $("predictorCameraStatus").textContent="Read incomplete. Aim at the full 13-digit barcode.";
    return false;
  }
  stopCamera();
  $("predictorActualBarcode").value=code;
  scannedActualBarcode=code;
  clearVerificationResult();
  message("predictorCameraFeedback","Real sticker barcode scanned. Enter the weight and total printed on that sticker before comparing.");
  return true;
}
async function cameraLoop(token){
  if(!cameraActive||token!==cameraToken)return;
  try{
    if(cameraVideo.readyState>=2){
      const results=await cameraDetector.detect(cameraVideo);
      if(!cameraActive||token!==cameraToken)return;
      for(const found of results)if(capturePrintedBarcode(found.rawValue))return;
    }
  }catch(_){}
  if(cameraActive&&token===cameraToken)
    cameraTimer=setTimeout(()=>void cameraLoop(token),170);
}
async function loadZxing(){
  if(window.ZXing?.BrowserMultiFormatReader)return window.ZXing;
  if(!zxingLoader){
    zxingLoader=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
      script.onload=()=>window.ZXing?.BrowserMultiFormatReader?resolve(window.ZXing):
        reject(Error("Could not initialize fallback barcode scanner."));
      script.onerror=()=>reject(Error("Cannot download fallback barcode scanner."));
      document.head.append(script);
    }).catch(err=>{zxingLoader=null;throw err});
  }
  return zxingLoader;
}
async function startCamera(){
  if(cameraActive)return;
  if(!user||!currentPrediction)
    return message("predictorCameraFeedback","Predict a barcode before scanning a real label.",true);
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)
    return message("predictorCameraFeedback","Live scanning needs HTTPS and camera permission. You can enter the real barcode manually.",true);
  cameraActive=true;
  const token=++cameraToken;
  if(cameraDialog.showModal)cameraDialog.showModal();
  else cameraDialog.setAttribute("open","");
  $("predictorCameraStatus").textContent="Opening the rear camera…";
  try{
    const stream=await navigator.mediaDevices.getUserMedia({
      audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}
    });
    if(!cameraActive||token!==cameraToken){stream.getTracks().forEach(t=>t.stop());return}
    cameraStream=stream;cameraVideo.srcObject=stream;
    await cameraVideo.play();
    if(!cameraActive||token!==cameraToken)return;
    if(typeof window.BarcodeDetector==="function"){
      try{
        const formats=await window.BarcodeDetector.getSupportedFormats?.();
        if(!formats||formats.includes("ean_13")){
          cameraDetector=new window.BarcodeDetector({formats:["ean_13"]});
          $("predictorCameraStatus").textContent="Hold the printed barcode inside the green frame.";
          void cameraLoop(token);return;
        }
      }catch(_){}
    }
    $("predictorCameraStatus").textContent="Starting compatible barcode reader…";
    const ZXing=await loadZxing();
    if(!cameraActive||token!==cameraToken)return;
    const hints=new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS,[ZXing.BarcodeFormat.EAN_13]]]);
    cameraReader=new ZXing.BrowserMultiFormatReader(hints,180);
    await cameraReader.decodeFromVideoElementContinuously(cameraVideo,result=>{
      if(cameraActive&&token===cameraToken&&result)capturePrintedBarcode(result.getText());
    });
  }catch(err){
    if(!cameraActive||token!==cameraToken)return;
    stopCamera();
    message("predictorCameraFeedback",
      "Camera unavailable: "+(err?.message||"Check browser permission and enter the barcode manually."),true);
  }
}
$("predictorLoginForm").addEventListener("submit",e=>void login(e));
$("predictorSignOut").addEventListener("click",async()=>{
  if(client)await client.auth.signOut();
  setUser(null);
});
$("predictorProfile").addEventListener("change",()=>{clearResult();renderProfileSummary()});
$("predictorWeight").addEventListener("input",clearResult);
$("predictorForm").addEventListener("submit",predict);
$("predictorCopy").addEventListener("click",()=>void copyPrediction());
$("predictorOpenVerify").addEventListener("click",openVerification);
$("predictorVerifyForm").addEventListener("submit",verifyAgainstPrintedLabel);
$("predictorScanActual").addEventListener("click",()=>void startCamera());
$("predictorCameraClose").addEventListener("click",stopCamera);
$("predictorCameraDialog").addEventListener("cancel",e=>{e.preventDefault();stopCamera()});
$("predictorActualBarcode").addEventListener("input",()=>{
  scannedActualBarcode=null;
  clearVerificationResult();
});
for(const id of ["predictorActualWeight","predictorActualTotal"])
  $(id).addEventListener("input",clearVerificationResult);
document.addEventListener?.("visibilitychange",()=>{if(document.hidden&&cameraActive)stopCamera()});
window.addEventListener?.("pagehide",stopCamera);
renderProfiles();
void initialize();
})();
