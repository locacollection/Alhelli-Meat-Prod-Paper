/* Barcode Learning page. Training data stays in owner-scoped Supabase tables.
   Live scans capture numbers only; printed weights/prices require explicit review. */
(()=>{
"use strict";
const core=window.BarcodeLearningCore;
const $=id=>document.getElementById(id);
const URL_PROJECT="https://tvaqcbzmzpyltbbelwbw.supabase.co";
const PUBLIC_KEY="sb_publishable_yqrAl20jwQlW4J8furYn3Q_kjQFIFrr";
const PROFILES="barcode_learning_profiles",EXAMPLES="barcode_learning_examples";
let client=null,user=null,profiles=[],active=null,samples=[],analysis=null,busy=false;
let profileToken=0,sampleToken=0,pendingCodes=[];
let camStream=null,camReader=null,camDetector=null,camToken=0,camTimer=null,camActive=false,ZXingLoader=null;
function msg(id,text,error=false){
  const node=$(id);node.textContent=text||"";node.hidden=!text;
  node.classList.toggle("is-error",error);
}
function make(tag,cls,text){
  const node=document.createElement(tag);if(cls)node.className=cls;
  if(text!==undefined)node.textContent=String(text);
  return node;
}
function updateControls(){
  $("learnAddSample").disabled=!user||!active||busy;
  $("learnCreate").disabled=!user||busy;
  $("learnDeleteProfile").hidden=!user||!active;
  $("learnProfiles").disabled=!user||busy;
}
function configFromForm(){
  const unit_price_fils=core.parseAmount($("learnRate").value);
  return core.profileConfig({
    item_code:$("learnItemCode").value,
    product_name:$("learnName").value,
    weight_step_grams:Number($("learnStep").value),
    unit_price_fils,rounding_fils:Number($("learnRounding").value)
  });
}
function displayProfileList(){
  const select=$("learnProfiles"),selected=active?.id||"";
  select.replaceChildren();
  select.append(make("option","","Create or select an item"));
  select.children[0].value="";
  for(const p of profiles){
    const opt=make("option","",p.item_code+" · "+p.product_name+" · "+core.formatAmount(p.unit_price_fils)+" BD/kg");
    opt.value=p.id;select.append(opt);
  }
  select.value=selected;
}
async function loadProfiles(preferred=null){
  if(!client||!user)return;
  const token=++profileToken;
  try{
    const {data,error}=await client.from(PROFILES).select("*")
      .eq("owner_id",user.id).order("updated_at",{ascending:false}).limit(100);
    if(error)throw error;
    if(token!==profileToken)return;
    profiles=data||[];
    let desired=preferred||active?.id||"";
    if(!profiles.some(p=>p.id===desired))desired="";
    active=profiles.find(p=>p.id===desired)||null;
    displayProfileList();updateControls();
    await loadSamples();
  }catch(error){if(token===profileToken)msg("learnProfileInfo","Cannot load profiles: "+error.message,true)}
}
function setUser(next){
  user=next||null;
  $("learnLoginForm").hidden=!!user;
  $("learnSignedIn").hidden=!user;
  $("learnUsername").textContent=user?.email||"";
  if(!user){
    profileToken++;sampleToken++;
    profiles=[];active=null;samples=[];analysis=null;pendingCodes=[];
    displayProfileList();renderPending();renderSamples();renderAnalysis();
    msg("learnProfileInfo","Sign in to save and reuse your learning examples.");
  }else{
    msg("learnProfileInfo","");
    void loadProfiles();
  }
  updateControls();
}
async function init(){
  if(!window.supabase?.createClient){
    msg("learnAuthMessage","Database connection unavailable. Check your internet connection.",true);
    return;
  }
  client=window.supabase.createClient(URL_PROJECT,PUBLIC_KEY);
  const {data,error}=await client.auth.getSession();
  if(error)msg("learnAuthMessage",error.message,true);
  setUser(data?.session?.user||null);
  client.auth.onAuthStateChange((event,session)=>{
    if(session?.user?.id!==user?.id){
      if(!session?.user)stopCamera();
      setUser(session?.user||null);
    }
  });
}
async function login(e){
  e.preventDefault();
  if(!client){msg("learnAuthMessage","Database library unavailable.",true);return}
  msg("learnAuthMessage","Signing in…");
  const {data,error}=await client.auth.signInWithPassword({
    email:$("learnEmail").value.trim(),password:$("learnPassword").value
  });
  $("learnPassword").value="";
  if(error){msg("learnAuthMessage",error.message,true);return}
  setUser(data.user);
  msg("learnAuthMessage","Signed in. Your training examples are private.");
}
async function createProfile(e){
  e.preventDefault();
  if(!client||!user)return msg("learnProfileInfo","Sign in first.",true);
  let config;
  try{config=configFromForm()}catch(err){return msg("learnProfileInfo",err.message,true)}
  busy=true;updateControls();
  try{
    const {data,error}=await client.from(PROFILES)
      .insert({...config,owner_id:user.id}).select("*").single();
    if(error)throw error;
    await loadProfiles(data.id);
    $("learnNewProfile").open=false;
    msg("learnProfileInfo","Created "+data.item_code+". Add at least 4 confirmed labels.");
  }catch(err){msg("learnProfileInfo","Could not create: "+err.message,true)}
  finally{busy=false;updateControls()}
}
async function chooseProfile(id){
  active=profiles.find(p=>p.id===id)||null;
  samples=[];analysis=null;pendingCodes=[];renderPending();renderSamples();renderAnalysis();
  updateControls();
  await loadSamples();
}
async function deleteProfile(){
  if(!user||!active)return;
  if(!confirm("Delete this learning profile AND all its saved training examples?"))return;
  const id=active.id;
  const {error}=await client.from(PROFILES).delete().eq("id",id).eq("owner_id",user.id);
  if(error)return msg("learnProfileInfo","Could not delete profile: "+error.message,true);
  active=null;samples=[];analysis=null;pendingCodes=[];
  await loadProfiles();
  msg("learnProfileInfo","Learning profile deleted.");
}
async function loadSamples(){
  const token=++sampleToken;
  if(!client||!user||!active){
    samples=[];analysis=null;renderSamples();renderAnalysis();return;
  }
  const id=active.id;
  try{
    const {data,error}=await client.from(EXAMPLES).select("*")
      .eq("owner_id",user.id).eq("profile_id",id)
      .order("created_at",{ascending:true}).limit(500);
    if(error)throw error;
    if(token!==sampleToken||active?.id!==id)return;
    samples=data||[];
    renderSamples();
    await refreshAnalysis();
  }catch(err){if(token===sampleToken)msg("learnSampleMessage","Could not load samples: "+err.message,true)}
}
function renderSamples(){
  $("learnCount").textContent=String(samples.length);
  const holder=$("learnSamples");holder.replaceChildren();
  if(!samples.length){
    holder.append(make("p","fineprint",active?
      "No examples yet. Scan labels and enter printed values.":
      "Select or create an item to start training."));return;
  }
  for(const sample of samples){
    const row=make("div","learn-sample"),desc=make("div");
    desc.append(make("strong","",sample.barcode));
    desc.append(make("small","",core.formatAmount(sample.weight_grams)+" kg · "+
      core.formatAmount(sample.total_price_fils)+" BD"));
    const remove=make("button","mini","Remove");remove.type="button";
    remove.addEventListener("click",()=>void deleteSample(sample));
    row.append(desc,remove);holder.append(row);
  }
}
function previewAnalysis(){
  const result=analysis;
  const state=$("learnStatus");
  state.textContent=result?{
    collecting:"Collecting",proposed:"Proposal only",validated:"Validated on samples",
    ambiguous:"Needs review"}[result.status]||"Collecting":"Not trained";
  state.className="learn-state"+(result?" is-"+result.status:"");
  $("learnCoverage").textContent=(result?.sample_count||0)+" label"+(result?.sample_count===1?"":"s");
  $("learnPattern").textContent=result?.mode&&result.mode!=="unknown"?
    core.MODES[result.mode]:"No reliable pattern yet";
  $("learnExplanation").textContent=result?.error||(
    result?.status==="validated"?
    "Barcode prefix and pattern passed "+result.holdout_count+
    " extra sample check(s). Always cross-check the printed label.":
    "Add confirmed labels to check barcode patterns.");
  $("learnPrefix").hidden=!result?.barcode_prefix;
  $("learnPrefix").textContent=result?.barcode_prefix?"First 6 digits: "+result.barcode_prefix:"";
  const container=$("learnCandidates");container.replaceChildren();
  if(result?.candidates?.length){
    for(const mode of result.candidates.slice(0,5))
      container.append(make("div","learn-candidate","Possible: "+(core.MODES[mode]||mode)));
  }
}
function renderAnalysis(){previewAnalysis()}
async function refreshAnalysis(){
  if(!active){analysis=null;renderAnalysis();return}
  try{
    analysis=core.analyze(samples,active);
  }catch(err){
    analysis={status:"ambiguous",error:err.message,sample_count:samples.length};
  }
  renderAnalysis();
  if(!user)return;
  // The learned rule remains a hypothesis in private user data. Never
  // publish it to the production barcode catalogs.
  const id=active.id;
  const changes={
    barcode_prefix:analysis.barcode_prefix||"",
    pattern_mode:analysis.mode||"unknown",
    review_status:analysis.status||"collecting",
    sample_count:samples.length,
    updated_at:new Date().toISOString()
  };
  try{
    const {error}=await client.from(PROFILES).update(changes)
      .eq("id",id).eq("owner_id",user.id);
    if(error)throw error;
    if(active?.id===id)Object.assign(active,changes);
  }catch(err){
    msg("learnProfileInfo","Learning result was not saved: "+err.message,true);
  }
}
async function saveExample(e){
  e.preventDefault();
  if(!client||!user||!active)return msg("learnSampleMessage","Choose a signed-in profile first.",true);
  let sample;
  try{
    const checked=core.sampleCheck({
      barcode:$("learnBarcode").value,
      weight_grams:core.parseAmount($("learnWeight").value),
      total_price_fils:core.parseAmount($("learnTotal").value)
    },active);
    if(!checked.ok)throw new Error(checked.reason);
    if(samples.some(x=>x.barcode===checked.barcode&&x.weight_grams===checked.weight&&
      x.total_price_fils===checked.price))throw new Error("This exact example is already saved.");
    sample={owner_id:user.id,profile_id:active.id,barcode:checked.barcode,
      weight_grams:checked.weight,total_price_fils:checked.price,verified_from_label:true};
  }catch(err){return msg("learnSampleMessage",err.message,true)}
  busy=true;updateControls();msg("learnSampleMessage","Saving example…");
  try{
    const {error}=await client.from(EXAMPLES).insert(sample);
    if(error)throw error;
    $("learnSampleForm").reset();
    msg("learnSampleMessage","Example saved. Pattern checked against "+(samples.length+1)+" label(s).");
    await loadSamples();
  }catch(err){msg("learnSampleMessage","Could not save: "+err.message,true)}
  finally{busy=false;updateControls()}
}
async function deleteSample(sample){
  if(!user||!active||!confirm("Remove training example "+sample.barcode+"?"))return;
  const {error}=await client.from(EXAMPLES).delete().eq("id",sample.id)
    .eq("owner_id",user.id).eq("profile_id",active.id);
  if(error)return msg("learnSampleMessage","Remove failed: "+error.message,true);
  await loadSamples();
  msg("learnSampleMessage","Example removed. Pattern recalculated.");
}
function model(){
  if(!active||analysis?.status!=="validated"||active.review_status!=="validated")
    return null;
  return {...active,barcode_prefix:analysis.barcode_prefix,pattern_mode:analysis.mode,
    review_status:analysis.status};
}
function testBarcode(e){
  e.preventDefault();
  const profile=model();
  const result=profile?core.decodeLearned($("learnTestBarcode").value,profile):
    {ok:false,error:"Save at least 4 varied examples to validate one pattern first."};
  const container=$("learnTestResult");container.hidden=false;
  container.className="learn-test-result"+(result.ok?"":" is-error");
  container.replaceChildren();
  if(result.ok){
    container.append(make("strong","",core.formatAmount(result.weight_grams)+" kg"));
    container.append(make("div","",result.product_name+" · "+core.formatAmount(result.price_fils)+" BD"));
    container.append(make("small","","Learned pattern only. Verify the printed sticker."));
  }else{
    container.textContent=result.error;
    if(result.ambiguous)container.append(make("div","","Do not guess the weight."));
  }
}
function predictBarcode(e){
  e.preventDefault();
  const profile=model();
  const grams=core.parseAmount($("learnPredictWeight").value);
  const result=profile?core.suggestBarcode(grams,profile):
    {ok:false,error:"A validated profile is required to predict a barcode."};
  const container=$("learnPredictResult");container.hidden=false;
  container.className="learn-test-result"+(result.ok?"":" is-error");
  container.replaceChildren();
  if(result.ok){
    container.append(make("strong","",result.barcode));
    container.append(make("div","",core.formatAmount(result.weight_grams)+" kg · "+
      core.formatAmount(result.total_price_fils)+" BD"));
    container.append(make("small","",result.warning));
  }else container.textContent=result.error;
}
function renderPending(){
  const panel=$("learnPending");panel.replaceChildren();panel.hidden=!pendingCodes.length;
  if(!pendingCodes.length)return;
  panel.append(make("h3","","Detected "+pendingCodes.length+" barcodes · select each to confirm"));
  for(const barcode of pendingCodes){
    const row=make("div","learn-pending-item");
    row.append(make("code","",barcode));
    const pick=make("button","mini","Use label");pick.type="button";
    pick.addEventListener("click",()=>{
      $("learnBarcode").value=barcode;
      pendingCodes=pendingCodes.filter(v=>v!==barcode);
      renderPending();
      $("learnWeight").focus();
      msg("learnSampleMessage","Read the weight and total from this label, then confirm.");
    });
    row.append(pick);panel.append(row);
  }
}
async function scanPhotos(files){
  const images=[...(files||[])].filter(f=>f.type.startsWith("image/"));
  if(!images.length)return;
  if(typeof window.BarcodeDetector!=="function"){
    msg("learnSampleMessage","Multi-label photo detection is unavailable in this browser. Use Scan 1 barcode.",true);return;
  }
  const detector=new window.BarcodeDetector({formats:["ean_13"]});
  const found=new Set(pendingCodes);
  for(const file of images){
    let bitmap=null;
    try{
      bitmap=await createImageBitmap(file);
      const scale=Math.min(1,2200/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement("canvas");
      canvas.width=Math.ceil(bitmap.width*scale);canvas.height=Math.ceil(bitmap.height*scale);
      canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);
      // Scaled/tiled passes help recognize multiple small barcodes on one sheet.
      async function sweep(x,y,w,h){
        const tile=document.createElement("canvas");tile.width=w;tile.height=h;
        tile.getContext("2d").drawImage(canvas,x,y,w,h,0,0,w,h);
        const results=await detector.detect(tile);
        for(const q of results){
          const b=core.cleanBarcode(q.rawValue);
          if(core.validBarcode(b))found.add(b);
        }
      }
      await sweep(0,0,canvas.width,canvas.height);
      for(const n of [2,3]){
        const starts=n===2?[0,.38]:[0,.28,.56];
        const w=Math.ceil(canvas.width*(n===2?.63:.45));
        const h=Math.ceil(canvas.height*(n===2?.63:.45));
        for(const fx of starts)for(const fy of starts){
          const x=Math.floor(canvas.width*fx),y=Math.floor(canvas.height*fy);
          try{await sweep(x,y,Math.min(w,canvas.width-x),Math.min(h,canvas.height-y))}catch(_){}
        }
      }
    }catch(err){
      msg("learnSampleMessage","Could not read "+file.name+": "+err.message,true);
    }finally{bitmap?.close?.()}
  }
  pendingCodes=[...found].slice(0,100);renderPending();
  msg("learnSampleMessage",pendingCodes.length?
    "Found "+pendingCodes.length+" unique barcode(s). Confirm printed weight and total for each.":
    "No valid EAN-13 barcodes found. Use the live camera or clearer photos.",!pendingCodes.length);
}
const dialog=$("learnCameraDialog"),video=$("learnVideo");
function stopCamera(){
  camToken++;camActive=false;
  if(camTimer!==null){clearTimeout(camTimer);camTimer=null}
  if(camReader){try{camReader.reset()}catch(_){}camReader=null}
  if(camStream){camStream.getTracks().forEach(t=>{try{t.stop()}catch(_){}});camStream=null}
  try{video.pause()}catch(_){}
  video.srcObject=null;
  if(dialog.open)dialog.close();
}
function capturedBarcode(raw){
  if(!camActive)return false;
  const barcode=core.cleanBarcode(raw);
  if(!core.validBarcode(barcode))return false;
  stopCamera();
  $("learnBarcode").value=barcode;
  $("learnWeight").focus();
  msg("learnSampleMessage","Captured "+barcode+". Confirm the printed weight and total.");
  return true;
}
async function zxing(){
  if(window.ZXing?.BrowserMultiFormatReader)return window.ZXing;
  if(!ZXingLoader){
    ZXingLoader=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
      script.onload=()=>window.ZXing?.BrowserMultiFormatReader?resolve(window.ZXing):
        reject(new Error("Barcode reader unavailable"));
      script.onerror=()=>reject(new Error("Could not download the fallback reader"));
      document.head.append(script);
    }).catch(err=>{ZXingLoader=null;throw err});
  }
  return ZXingLoader;
}
async function nativeLoop(token){
  if(!camActive||camToken!==token)return;
  try{
    if(video.readyState>=2){
      const results=await camDetector.detect(video);
      if(!camActive||camToken!==token)return;
      for(const q of results)if(capturedBarcode(q.rawValue))return;
    }
  }catch(_){}
  if(camActive&&camToken===token)camTimer=setTimeout(()=>void nativeLoop(token),170);
}
async function startCamera(){
  if(camActive)return;
  if(!navigator.mediaDevices?.getUserMedia||!window.isSecureContext){
    msg("learnSampleMessage","Camera scanning requires HTTPS and permission.",true);return;
  }
  camActive=true;const token=++camToken;
  if(dialog.showModal)dialog.showModal();else dialog.setAttribute("open","");
  $("learnCameraMessage").textContent="Opening rear camera…";
  try{
    const stream=await navigator.mediaDevices.getUserMedia({
      audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}
    });
    if(!camActive||token!==camToken){stream.getTracks().forEach(t=>t.stop());return}
    camStream=stream;video.srcObject=stream;
    await video.play();
    if(!camActive||token!==camToken)return;
    if(typeof window.BarcodeDetector==="function"){
      try{
        const available=await window.BarcodeDetector.getSupportedFormats?.();
        if(!available||available.includes("ean_13")){
          camDetector=new window.BarcodeDetector({formats:["ean_13"]});
          $("learnCameraMessage").textContent="Point at one barcode.";
          void nativeLoop(token);return;
        }
      }catch(_){}
    }
    $("learnCameraMessage").textContent="Starting compatible barcode reader…";
    const ZXing=await zxing();
    if(!camActive||token!==camToken)return;
    const hints=new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS,[ZXing.BarcodeFormat.EAN_13]]]);
    camReader=new ZXing.BrowserMultiFormatReader(hints,180);
    await camReader.decodeFromVideoElementContinuously(video,result=>{
      if(camActive&&token===camToken&&result)capturedBarcode(result.getText());
    });
  }catch(err){
    if(!camActive||token!==camToken)return;
    stopCamera();
    msg("learnSampleMessage","Camera unavailable: "+(err?.message||"Use manual entry."),true);
  }
}
$("learnLoginForm").addEventListener("submit",e=>void login(e));
$("learnSignOut").addEventListener("click",async()=>{
  stopCamera();if(client)await client.auth.signOut();setUser(null);
});
$("learnProfileForm").addEventListener("submit",e=>void createProfile(e));
$("learnProfiles").addEventListener("change",e=>void chooseProfile(e.target.value));
$("learnDeleteProfile").addEventListener("click",()=>void deleteProfile());
$("learnSampleForm").addEventListener("submit",e=>void saveExample(e));
$("learnTestForm").addEventListener("submit",testBarcode);
$("learnPredictForm").addEventListener("submit",predictBarcode);
$("learnLiveScan").addEventListener("click",()=>void startCamera());
$("learnCameraStop").addEventListener("click",stopCamera);
dialog.addEventListener("cancel",e=>{e.preventDefault();stopCamera()});
$("learnPhoto").addEventListener("change",e=>{void scanPhotos(e.target.files);e.target.value=""});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&camActive)stopCamera()});
window.addEventListener("pagehide",stopCamera);
updateControls();renderSamples();renderAnalysis();void init();
window.BarcodeLearningChecks={capturedBarcode,stopCamera,scanPhotos,model,
  getSamples:()=>samples,getActive:()=>active,getAnalysis:()=>analysis};
})();