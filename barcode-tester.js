/* Barcode Tester: read-only, no selected learning profile, no writes. */
(()=>{
"use strict";
const PROJECT_URL="https://tvaqcbzmzpyltbbelwbw.supabase.co";
const PUBLIC_KEY="sb_publishable_yqrAl20jwQlW4J8furYn3Q_kjQFIFrr";
const core=window.BarcodeLearningCore,tester=window.BarcodeTesterCore;
const $=id=>document.getElementById(id);
let client=null,user=null,profiles=[],profilesLoaded=false;
let profileToken=0,lookupToken=0,checking=false,zxingLoader=null;
let cameraActive=false,cameraToken=0,cameraTimer=null,cameraStream=null,
    cameraDetector=null,cameraReader=null;
const dialog=$("testerCameraDialog"),video=$("testerVideo");
function message(id,value,isError=false){
  const el=$(id);el.textContent=value||"";el.hidden=!value;
  el.classList.toggle("is-error",!!isError);
}
function node(tag,cls,value){
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(value!==undefined)el.textContent=String(value);
  return el;
}
function money(num){return Number.isInteger(num)?(num/1000).toFixed(3)+" BD":"Not saved"}
function weight(num){return Number.isInteger(num)?(num/1000).toFixed(3)+" kg":"Not confirmed"}
function renderMatch(item){
  const estimated=item.source==="pattern"||item.source==="ambiguous"||
    (item.source==="catalog"&&!item.verified);
  const disputed=item.source==="ambiguous"||(item.exact&&!item.verified&&item.source==="learning");
  const card=node("article","tester-match"+(estimated?" is-estimate":"")+
    (disputed?" is-disputed":""));
  const head=node("div","tester-match-head");
  const titleWrap=node("div");
  titleWrap.append(node("h4","",item.itemCode?item.itemCode+" · "+item.title:item.title));
  let label="Saved barcode";
  if(item.source==="learning")label=item.verified?"Confirmed training label":"Saved example · review";
  if(item.source==="custom")label="Exact saved barcode";
  if(item.source==="catalog")label=item.verified?"Verified catalog label":"Unverified catalog record";
  if(item.source==="pattern")label="Learned pattern estimate";
  if(item.source==="ambiguous")label="Weight ambiguous";
  const tag=node("span","tester-match-label",label);
  head.append(titleWrap,tag);card.append(head);
  if(item.profileId)card.append(node("p","tester-match-meta",
    "Price version "+item.priceVersion+(item.archived?" · Previous price":" · Current price")));
  const values=node("div","tester-numbers");
  const pairs=[
    ["Weight / quantity",Number.isInteger(item.pieces)?item.pieces+" pcs":weight(item.weightGrams)],
    ["Unit price",money(item.unitRate)+(Number.isInteger(item.unitRate)&&!Number.isInteger(item.pieces)?"/kg":"")],
    ["Total",money(item.totalFils)]
  ];
  for(const [name,value] of pairs){
    const cell=node("div");
    cell.append(node("span","",name),node("strong","",value));
    values.append(cell);
  }
  card.append(values);
  if(item.ambiguous&&item.possibleWeights?.length)
    card.append(node("p","tester-match-meta",
      "Possible weights (examples, not a verified reading): "+
      item.possibleWeights.map(v=>weight(v)).join(", ")));
  card.append(node("p","tester-match-note",item.note||"Check the printed sticker."));
  if(item.otherSources?.length)
    card.append(node("p","tester-match-sources",
      "Also found in: "+item.otherSources.join(", ")+". Matching readings are grouped together."));
  return card;
}
function renderResults(result){
  $("testerResults").hidden=false;
  $("testerResultsTitle").textContent="Results for "+result.barcode;
  $("testerMatches").replaceChildren();
  $("testerNotes").replaceChildren();
  $("testerResultsIntro").textContent=result.results.length?
    "Found "+result.results.length+" record or learned-pattern match"+
    (result.results.length===1?"":"es")+". Exact saved labels appear before calculated pattern results.":
    "No matching saved label or usable learned pattern.";
  for(const note of result.notes)$("testerNotes").append(node("p","tester-warning",note));
  for(const item of result.results)$("testerMatches").append(renderMatch(item));
}
function clearResult(){
  $("testerResults").hidden=true;
  $("testerMatches").replaceChildren();$("testerNotes").replaceChildren();
  message("testerMessage","");
}
async function loadProfiles(){
  if(!client||!user)return;
  const owner=user.id,ticket=++profileToken;
  profilesLoaded=false;
  $("testerProfileCount").textContent="Loading saved profiles and price history…";
  try{
    const all=[];
    for(let offset=0;offset<5000;offset+=500){
      const {data,error}=await client.from("barcode_learning_profiles")
        .select("id,owner_id,item_code,product_name,unit_price_fils,weight_step_grams,rounding_fils,barcode_prefix,pattern_mode,review_status,sample_count,price_version,archived_at")
        .eq("owner_id",owner).order("created_at",{ascending:true}).range(offset,offset+499);
      if(error)throw error;
      if(ticket!==profileToken||user?.id!==owner)return;
      all.push(...(data||[]));
      if(!data||data.length<500)break;
      if(offset===4500)throw Error("Too many price versions to check at once. Contact the database administrator.");
    }
    if(ticket!==profileToken||user?.id!==owner)return;
    profiles=all;profilesLoaded=true;
    const current=profiles.filter(p=>!p.archived_at).length;
    $("testerProfileCount").textContent="Searching "+current+" active profile(s) and "+
      (profiles.length-current)+" earlier price version(s), plus exact saved barcode records.";
  }catch(err){
    if(ticket!==profileToken)return;
    profiles=[];profilesLoaded=false;
    $("testerProfileCount").textContent="Saved profiles could not be loaded.";
    message("testerMessage","Cannot read learning profiles: "+(err?.message||err),true);
  }
}
function setUser(next){
  const changed=next?.id!==user?.id;
  user=next||null;
  $("testerAuth").hidden=!!user;
  $("testerWorkspace").hidden=!user;
  $("testerUsername").textContent=user?.email||"";
  if(!user){
    profileToken++;lookupToken++;profiles=[];profilesLoaded=false;
    $("testerBarcode").value="";clearResult();stopCamera();
  }else if(changed){
    clearResult();void loadProfiles();
  }
}
async function init(){
  if(!core||!tester||!window.supabase?.createClient){
    message("testerAuthMessage","Barcode decoder or Supabase connection unavailable. Check your internet connection.",true);
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
  }catch(err){message("testerAuthMessage","Cannot read login session: "+err.message,true)}
}
async function signIn(event){
  event.preventDefault();
  if(!client)return;
  $("testerLoginButton").disabled=true;
  message("testerAuthMessage","Signing in…");
  try{
    const {data,error}=await client.auth.signInWithPassword({
      email:$("testerEmail").value.trim(),password:$("testerPassword").value
    });
    if(error)throw error;
    $("testerPassword").value="";
    setUser(data?.user||null);message("testerAuthMessage","");
  }catch(err){message("testerAuthMessage","Sign in failed: "+err.message,true)}
  finally{$("testerLoginButton").disabled=false}
}
async function lookUp(event){
  event?.preventDefault?.();
  if(!user||!client)return message("testerMessage","Sign in to test saved barcodes.",true);
  const barcode=core.cleanBarcode($("testerBarcode").value);
  clearResult();
  if(!core.validBarcode(barcode))
    return message("testerMessage","Enter a valid 13-digit EAN-13 barcode with the correct check digit.",true);
  if(checking)return;
  const ticket=++lookupToken,owner=user.id;
  checking=true;$("testerCheck").disabled=true;
  message("testerMessage","Checking saved labels, price history and learned patterns…");
  try{
    if(!profilesLoaded)await loadProfiles();
    if(ticket!==lookupToken||user?.id!==owner)return;
    if(!profilesLoaded)throw Error("Saved learning profiles are unavailable. Refresh and sign in again.");
    const [examples,custom,catalog]=await Promise.all([
      client.from("barcode_learning_examples")
        .select("profile_id,barcode,weight_grams,total_price_fils,verified_from_label")
        .eq("owner_id",owner).eq("barcode",barcode).limit(100),
      client.from("custom_barcode_items")
        .select("barcode,item_code,product_name,unit_type,weight_grams,quantity_pieces,unit_price_fils,total_price_fils")
        .eq("owner_id",owner).eq("barcode",barcode).limit(100),
      client.from("meat_barcode_catalog")
        .select("ean13,item_code,product_name,weight_grams,unit_price_fils_per_kg,total_price_fils,label_verified")
        .eq("ean13",barcode).limit(100)
    ]);
    for(const [label,response] of [["Training examples",examples],["Saved Barcodes",custom],["Meat catalog",catalog]])
      if(response.error)throw Error(label+": "+response.error.message);
    if(ticket!==lookupToken||user?.id!==owner)return;
    const found=tester.evaluate(barcode,{
      profiles,examples:examples.data||[],custom:custom.data||[],catalog:catalog.data||[]
    },core);
    if(ticket!==lookupToken||user?.id!==owner)return;
    renderResults(found);message("testerMessage","");
  }catch(err){
    if(ticket===lookupToken){
      clearResult();
      message("testerMessage","Cannot complete barcode lookup: "+(err?.message||err),true);
    }
  }finally{
    checking=false;
    $("testerCheck").disabled=false;
  }
}
function stopCamera(){
  cameraToken++;cameraActive=false;
  if(cameraTimer!==null){clearTimeout(cameraTimer);cameraTimer=null}
  if(cameraReader){try{cameraReader.reset()}catch(_){}cameraReader=null}
  if(cameraStream){for(const track of cameraStream.getTracks())try{track.stop()}catch(_){}cameraStream=null}
  try{video.pause()}catch(_){}
  video.srcObject=null;
  if(dialog.open){if(dialog.close)dialog.close();else dialog.removeAttribute("open")}
}
function captureBarcode(raw){
  if(!cameraActive)return false;
  const barcode=core.cleanBarcode(raw);
  if(!core.validBarcode(barcode)){
    $("testerCameraStatus").textContent="Incomplete EAN-13 reading. Align the full barcode.";
    return false;
  }
  stopCamera();
  $("testerBarcode").value=barcode;
  void lookUp();
  return true;
}
async function nativeLoop(token){
  if(!cameraActive||cameraToken!==token)return;
  try{
    if(video.readyState>=2){
      const found=await cameraDetector.detect(video);
      if(!cameraActive||cameraToken!==token)return;
      for(const barcode of found)if(captureBarcode(barcode.rawValue))return;
    }
  }catch(_){}
  if(cameraActive&&cameraToken===token)
    cameraTimer=setTimeout(()=>void nativeLoop(token),170);
}
async function loadZXing(){
  if(window.ZXing?.BrowserMultiFormatReader)return window.ZXing;
  if(!zxingLoader){
    zxingLoader=new Promise((resolve,reject)=>{
      const el=document.createElement("script");
      el.src="https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
      el.onload=()=>window.ZXing?.BrowserMultiFormatReader?resolve(window.ZXing):
        reject(Error("Cannot initialize the compatible barcode reader."));
      el.onerror=()=>reject(Error("Cannot download the compatible barcode reader."));
      document.head.append(el);
    }).catch(err=>{zxingLoader=null;throw err});
  }
  return zxingLoader;
}
async function startCamera(){
  if(cameraActive)return;
  if(!user)return message("testerMessage","Sign in first to scan barcodes.",true);
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)
    return message("testerMessage","Camera scanning requires HTTPS and camera permission. Manual entry is available.",true);
  cameraActive=true;const token=++cameraToken;
  if(dialog.showModal)dialog.showModal();else dialog.setAttribute("open","");
  $("testerCameraStatus").textContent="Opening rear camera…";
  try{
    const stream=await navigator.mediaDevices.getUserMedia({
      audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}
    });
    if(!cameraActive||token!==cameraToken){
      stream.getTracks().forEach(t=>t.stop());return;
    }
    cameraStream=stream;video.srcObject=stream;
    await video.play();
    if(!cameraActive||token!==cameraToken)return;
    if(typeof window.BarcodeDetector==="function"){
      try{
        const formats=await window.BarcodeDetector.getSupportedFormats?.();
        if(!formats||formats.includes("ean_13")){
          cameraDetector=new window.BarcodeDetector({formats:["ean_13"]});
          $("testerCameraStatus").textContent="Align the printed barcode within the green guide.";
          void nativeLoop(token);return;
        }
      }catch(_){}
    }
    $("testerCameraStatus").textContent="Starting a compatible barcode reader…";
    const ZXing=await loadZXing();
    if(!cameraActive||token!==cameraToken)return;
    const hints=new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS,[ZXing.BarcodeFormat.EAN_13]]]);
    cameraReader=new ZXing.BrowserMultiFormatReader(hints,180);
    await cameraReader.decodeFromVideoElementContinuously(video,result=>{
      if(cameraActive&&token===cameraToken&&result)captureBarcode(result.getText());
    });
  }catch(err){
    if(!cameraActive||token!==cameraToken)return;
    stopCamera();
    message("testerMessage","Camera unavailable: "+(err?.message||"Enter the barcode manually."),true);
  }
}
$("testerLoginForm").addEventListener("submit",e=>void signIn(e));
$("testerSignOut").addEventListener("click",async()=>{
  stopCamera();if(client)await client.auth.signOut();setUser(null);
});
$("testerForm").addEventListener("submit",e=>void lookUp(e));
$("testerBarcode").addEventListener("input",()=>{lookupToken++;clearResult()});
$("testerScan").addEventListener("click",()=>void startCamera());
$("testerCameraClose").addEventListener("click",stopCamera);
dialog.addEventListener("cancel",e=>{e.preventDefault();stopCamera()});
document.addEventListener?.("visibilitychange",()=>{if(document.hidden&&cameraActive)stopCamera()});
window.addEventListener?.("pagehide",stopCamera);
void init();
})();