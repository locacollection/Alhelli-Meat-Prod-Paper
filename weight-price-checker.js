/* Independent barcode price checker. Read-only lookup against existing private
   barcode tables. Never writes scanned codes to production papers or training. */
(()=>{
"use strict";
const PROJECT_URL="https://tvaqcbzmzpyltbbelwbw.supabase.co";
const PUBLIC_KEY="sb_publishable_yqrAl20jwQlW4J8furYn3Q_kjQFIFrr";
const PROFILES="barcode_learning_profiles";
const core=window.BarcodeLearningCore;
const $=id=>document.getElementById(id);
const protectedPrefixes=new Set(["966777","966780","966781"]);
let client=null,user=null,profiles=[],lookupTicket=0,profileTicket=0;
let creating=false,checking=false;
let cameraActive=false,cameraToken=0,cameraTimer=null,cameraStream=null,cameraDetector=null,cameraReader=null,zxingLoad=null;
const dialog=$("checkerCameraDialog"),video=$("checkerVideo");

function message(id,value,error=false){
  const node=$(id);
  node.textContent=value||"";
  node.hidden=!value;
  node.classList.toggle("is-error",!!error);
}
function money(value){return Number.isInteger(value)?(value/1000).toFixed(3)+" BD":"Not saved"}
function weight(value){return Number.isInteger(value)?(value/1000).toFixed(3)+" kg":"Not saved"}
function make(tag,cls,text){
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=String(text);
  return node;
}
function renderResult(data){
  $("checkerResult").hidden=false;
  $("checkerResultTitle").textContent=data.name;
  $("checkerResultSource").textContent=data.source;
  $("checkerResultCode").textContent=data.item_code?data.item_code+" · "+data.barcode:data.barcode;
  $("checkerQuantityLabel").textContent=data.pieces?"Quantity":"Weight";
  $("checkerQuantity").textContent=data.pieces?data.pieces+" pcs":weight(data.grams);
  $("checkerUnitLabel").textContent=data.pieces?"Price per piece":"Price per kg";
  $("checkerUnitPrice").textContent=money(data.rate);
  $("checkerTotalLabel").textContent=data.estimated?"Estimated total":"Total price";
  $("checkerTotal").textContent=money(data.total);
  $("checkerResultNote").textContent=data.note;
}
function unavailable(note){
  $("checkerResult").hidden=true;
  message("checkerLookupMessage",note,true);
}
function renderItems(){
  const list=$("checkerItemsList");
  list.replaceChildren();
  if(!user){list.append(make("p","fineprint","Sign in to see your registered products."));return}
  if(!profiles.length){list.append(make("p","fineprint","No products yet. Add a weight-based item above or visit Saved Barcodes to register a specific label."));return}
  for(const p of profiles){
    const card=make("article","checker-item");
    const left=make("div","");
    left.append(make("h3","",p.item_code+" · "+p.product_name));
    left.append(make("p","",money(p.unit_price_fils)+"/kg · "+p.weight_step_grams+" g increments · "+(p.sample_count||0)+" example(s)"));
    const ready=p.review_status==="validated"&&!!p.barcode_prefix&&p.pattern_mode!=="price5_unverified";
    const status=make("small",ready?"":"is-pending",ready?"Pattern validated":"Training needed");
    card.append(left,status);list.append(card);
  }
}
async function loadProfiles(){
  if(!client||!user)return;
  const ticket=++profileTicket,owner=user.id;
  try{
    const {data,error}=await client.from(PROFILES)
      .select("id,item_code,product_name,weight_step_grams,unit_price_fils,rounding_fils,barcode_prefix,pattern_mode,review_status,sample_count")
      .eq("owner_id",owner).order("product_name",{ascending:true}).limit(500);
    if(error)throw error;
    if(ticket!==profileTicket||user?.id!==owner)return;
    profiles=data||[];
    renderItems();
  }catch(err){if(ticket===profileTicket)message("checkerItemMessage","Cannot load registered items: "+err.message,true)}
}
function setUser(next){
  const changed=next?.id!==user?.id;
  user=next||null;
  $("checkerAuthCard").hidden=!!user;
  $("checkerWorkspace").hidden=!user;
  $("checkerUsername").textContent=user?.email||"";
  if(!user){
    profileTicket++;lookupTicket++;profiles=[];
    $("checkerResult").hidden=true;
    message("checkerLookupMessage","");
    renderItems();stopCamera();
  }else if(changed){void loadProfiles()}
}
async function init(){
  if(!core||!window.supabase?.createClient){
    message("checkerAuthMessage","Barcode decoder or database connection is unavailable. Refresh and check your internet connection.",true);
    return;
  }
  client=window.supabase.createClient(PROJECT_URL,PUBLIC_KEY);
  const {data,error}=await client.auth.getSession();
  if(error)message("checkerAuthMessage",error.message,true);
  setUser(data?.session?.user||null);
  client.auth.onAuthStateChange((_event,session)=>{
    if(session?.user?.id!==user?.id)setUser(session?.user||null);
  });
}
async function signIn(e){
  e.preventDefault();
  if(!client)return message("checkerAuthMessage","Database is not ready.",true);
  $("checkerLoginButton").disabled=true;
  message("checkerAuthMessage","Signing in…");
  try{
    const {data,error}=await client.auth.signInWithPassword({
      email:$("checkerEmail").value.trim(),password:$("checkerPassword").value
    });
    if(error)throw error;
    $("checkerPassword").value="";
    setUser(data.user);
    message("checkerAuthMessage","");
  }catch(err){message("checkerAuthMessage","Sign-in failed: "+err.message,true)}
  finally{$("checkerLoginButton").disabled=false}
}
async function addItem(e){
  e.preventDefault();
  if(!client||!user||creating)return;
  let config;
  try{
    config=core.profileConfig({
      item_code:$("checkerItemCode").value.trim(),
      product_name:$("checkerItemName").value.trim(),
      unit_price_fils:core.parseAmount($("checkerItemRate").value),
      weight_step_grams:Number($("checkerItemStep").value),
      rounding_fils:Number($("checkerItemRounding").value)
    });
    if(profiles.some(p=>p.item_code.toLowerCase()===config.item_code.toLowerCase()))
      throw Error("This item code already has a learning profile. Use Barcode Learning to review it.");
  }catch(err){return message("checkerItemMessage",err.message,true)}
  creating=true;$("checkerAddItem").disabled=true;
  message("checkerItemMessage","Saving product…");
  try{
    const owner=user.id;
    const {error}=await client.from(PROFILES).insert({...config,owner_id:owner,review_status:"collecting"});
    if(error)throw error;
    $("checkerItemForm").reset();
    message("checkerItemMessage","Item saved privately. Open Barcode Learning and confirm at least four varied labels to validate its barcode pattern. Individual labels can also be saved in Saved Barcodes.");
    await loadProfiles();
  }catch(err){message("checkerItemMessage","Could not save product: "+err.message,true)}
  finally{creating=false;$("checkerAddItem").disabled=false}
}
function resultFromExact(row,barcode){
  let total=Number.isInteger(row.total_price_fils)?row.total_price_fils:null;
  const rate=Number.isInteger(row.unit_price_fils)?row.unit_price_fils:null;
  let estimated=false;
  if(total===null&&rate!==null){
    if(row.unit_type==="kg"&&Number.isInteger(row.weight_grams)){
      total=core.roundedPrice(row.weight_grams,rate,5);estimated=true;
    }else if(row.unit_type==="pcs"&&Number.isInteger(row.quantity_pieces)){
      total=rate*row.quantity_pieces;estimated=true;
    }
  }
  const checks=[];
  if(rate!==null&&Number.isInteger(row.total_price_fils)){
    const calc=row.unit_type==="kg"&&Number.isInteger(row.weight_grams)?
      core.roundedPrice(row.weight_grams,rate,5):
      row.unit_type==="pcs"&&Number.isInteger(row.quantity_pieces)?rate*row.quantity_pieces:null;
    if(calc!==null&&calc!==row.total_price_fils)
      checks.push("The saved total differs from a calculation using the saved unit price; check the printed label and rounding.");
  }
  if(total===null)checks.push("The total price was not saved for this barcode.");
  if(estimated)checks.push("Total was calculated from your saved quantity and rate; check the printed price.");
  if(!checks.length)checks.push("Exact barcode saved in your private catalog. Verify that the printed sticker and current price still agree.");
  return {name:row.product_name,barcode,item_code:row.item_code,source:"Saved barcode",
    grams:row.weight_grams,pieces:row.unit_type==="pcs"?row.quantity_pieces:null,
    rate,total,estimated,note:checks.join(" ")};
}
async function findBarcode(barcode){
  const owner=user.id;
  const saved=await client.from("custom_barcode_items")
    .select("barcode,item_code,product_name,unit_type,weight_grams,quantity_pieces,unit_price_fils,total_price_fils")
    .eq("owner_id",owner).eq("barcode",barcode).maybeSingle();
  if(saved.error)throw saved.error;
  if(saved.data)return resultFromExact(saved.data,barcode);

  if(protectedPrefixes.has(barcode.slice(0,6))){
    const lookup=await client.from("meat_barcode_catalog")
      .select("item_code,product_name,weight_grams,unit_price_fils_per_kg,total_price_fils,label_verified")
      .eq("ean13",barcode).maybeSingle();
    if(lookup.error)throw lookup.error;
    if(lookup.data){
      const row=lookup.data;
      return {name:row.product_name,barcode,item_code:row.item_code,source:"Original meat catalog",
        grams:row.weight_grams,pieces:null,rate:row.unit_price_fils_per_kg,total:row.total_price_fils,
        estimated:!row.label_verified,note:row.label_verified?
          "This barcode was marked as verified against a printed label in the catalog. Check current sticker and price.":
          "Calculated catalog match, not verified against a physical label. Do not assume store checkout will accept it."};
    }
    throw Error("This barcode is not in the protected 6777/6780/6781 meat catalog. Check the printed label.");
  }
  const prefix=barcode.slice(0,6);
  const matches=profiles.filter(p=>p.barcode_prefix===prefix&&p.review_status==="validated"&&p.pattern_mode!=="price5_unverified");
  if(matches.length>1)throw Error("More than one validated item uses this barcode prefix. Choose a more specific pattern in Barcode Learning before decoding.");
  if(matches.length===1){
    const decoded=core.decodeLearned(barcode,matches[0]);
    if(!decoded.ok)throw Error(decoded.error);
    return {name:decoded.product_name,barcode,item_code:decoded.item_code,source:"Learned pattern",
      grams:decoded.weight_grams,pieces:null,rate:decoded.unit_price_fils,
      total:decoded.price_fils,estimated:false,
      note:"Calculated from a validated training pattern, not a physical weight reading. Compare weight, unit price and total with the printed label; not authorized for checkout."};
  }
  if(profiles.some(p=>p.barcode_prefix===prefix))
    throw Error("This barcode's item exists, but its weight/price pattern is not validated. Add and confirm more label examples in Barcode Learning.");
  throw Error("No saved barcode or validated item pattern matches this number. Register this exact label in Saved Barcodes, or add/train its product.");
}
async function checkBarcode(e){
  if(e?.preventDefault)e.preventDefault();
  if(!client||!user)return unavailable("Sign in first to check saved barcode information.");
  const barcode=core.cleanBarcode($("checkerBarcode").value);
  if(!core.validBarcode(barcode))return unavailable("Enter a valid 13-digit EAN-13 barcode with a correct check digit.");
  if(checking)return;
  checking=true;$("checkerCheckButton").disabled=true;
  const ticket=++lookupTicket,owner=user.id;
  $("checkerResult").hidden=true;
  message("checkerLookupMessage","Checking saved barcode records…");
  try{
    const result=await findBarcode(barcode);
    if(ticket!==lookupTicket||user?.id!==owner)return;
    renderResult(result);
    message("checkerLookupMessage","");
  }catch(err){
    if(ticket===lookupTicket)unavailable(err?.message||"Barcode lookup failed.");
  }finally{checking=false;$("checkerCheckButton").disabled=false}
}
function stopCamera(){
  cameraToken++;cameraActive=false;
  if(cameraTimer!==null){clearTimeout(cameraTimer);cameraTimer=null}
  if(cameraReader){try{cameraReader.reset()}catch(_){}cameraReader=null}
  if(cameraStream){cameraStream.getTracks().forEach(track=>{try{track.stop()}catch(_){}});cameraStream=null}
  try{video.pause()}catch(_){}
  video.srcObject=null;
  if(dialog.open)dialog.close();
}
function captured(raw){
  if(!cameraActive)return false;
  const code=core.cleanBarcode(raw);
  if(!core.validBarcode(code)){
    $("checkerCameraStatus").textContent="Barcode digits were incomplete. Hold the phone steady.";
    return false;
  }
  stopCamera();
  $("checkerBarcode").value=code;
  void checkBarcode();
  return true;
}
async function nativeLoop(token){
  if(!cameraActive||token!==cameraToken)return;
  try{
    if(video.readyState>=2){
      const found=await cameraDetector.detect(video);
      if(!cameraActive||token!==cameraToken)return;
      for(const entry of found)if(captured(entry.rawValue))return;
    }
  }catch(_){}
  if(cameraActive&&token===cameraToken)cameraTimer=setTimeout(()=>void nativeLoop(token),170);
}
async function loadZXing(){
  if(window.ZXing?.BrowserMultiFormatReader)return window.ZXing;
  if(!zxingLoad){
    zxingLoad=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
      script.onload=()=>window.ZXing?.BrowserMultiFormatReader?resolve(window.ZXing):
        reject(Error("Barcode library did not initialize."));
      script.onerror=()=>reject(Error("Could not download the camera scanner."));
      document.head.append(script);
    }).catch(err=>{zxingLoad=null;throw err});
  }
  return zxingLoad;
}
async function startCamera(){
  if(cameraActive)return;
  if(!user)return unavailable("Sign in to use the private barcode checker.");
  if(!navigator.mediaDevices?.getUserMedia||!window.isSecureContext)
    return message("checkerLookupMessage","Camera scanning needs HTTPS and camera permission. Manual barcode entry is also available.",true);
  cameraActive=true;
  const token=++cameraToken;
  if(dialog.showModal)dialog.showModal();else dialog.setAttribute("open","");
  $("checkerCameraStatus").textContent="Opening rear camera…";
  try{
    const stream=await navigator.mediaDevices.getUserMedia({
      audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}
    });
    if(!cameraActive||token!==cameraToken){stream.getTracks().forEach(track=>track.stop());return}
    cameraStream=stream;video.srcObject=stream;
    await video.play();
    if(!cameraActive||token!==cameraToken)return;
    if(typeof window.BarcodeDetector==="function"){
      try{
        const formats=await window.BarcodeDetector.getSupportedFormats?.();
        if(!formats||formats.includes("ean_13")){
          cameraDetector=new window.BarcodeDetector({formats:["ean_13"]});
          $("checkerCameraStatus").textContent="Align a barcode within the green frame.";
          void nativeLoop(token);return;
        }
      }catch(_){}
    }
    $("checkerCameraStatus").textContent="Starting compatible barcode scanner…";
    const ZXing=await loadZXing();
    if(!cameraActive||token!==cameraToken)return;
    const hints=new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS,[ZXing.BarcodeFormat.EAN_13]]]);
    cameraReader=new ZXing.BrowserMultiFormatReader(hints,180);
    await cameraReader.decodeFromVideoElementContinuously(video,result=>{
      if(cameraActive&&token===cameraToken&&result)captured(result.getText());
    });
  }catch(err){
    if(!cameraActive||token!==cameraToken)return;
    stopCamera();
    message("checkerLookupMessage","Camera unavailable: "+(err?.message||"Try entering the barcode manually."),true);
  }
}
$("checkerLoginForm").addEventListener("submit",e=>void signIn(e));
$("checkerSignOut").addEventListener("click",async()=>{stopCamera();if(client)await client.auth.signOut();setUser(null)});
$("checkerItemForm").addEventListener("submit",e=>void addItem(e));
$("checkerLookupForm").addEventListener("submit",e=>void checkBarcode(e));
$("checkerRefresh").addEventListener("click",()=>void loadProfiles());
$("checkerCameraButton").addEventListener("click",()=>void startCamera());
$("checkerCloseCamera").addEventListener("click",stopCamera);
dialog.addEventListener("cancel",e=>{e.preventDefault();stopCamera()});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&cameraActive)stopCamera()});
window.addEventListener("pagehide",stopCamera);
renderItems();void init();
})();
