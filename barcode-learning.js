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
let profileToken=0,sampleToken=0,pendingCodes=[],pendingLabels=[],readingPhotos=false,pendingId=0;
let camStream=null,camReader=null,camDetector=null,camToken=0,camTimer=null,camActive=false,ZXingLoader=null;
let camMode="label";
function msg(id,text,error=false){
  const node=$(id);node.textContent=text||"";node.hidden=!text;
  node.classList.toggle("is-error",error);
}
function make(tag,cls,text){
  const node=document.createElement(tag);if(cls)node.className=cls;
  if(text!==undefined)node.textContent=String(text);
  return node;
}
/* A label can only be confirmed when every entered value agrees. Reuse
   this exact rule on the button and immediately before the database insert. */
function scannedAgreement(p){
  const profile=profiles.find(x=>x.id===p.profileId);
  const barcode=core.cleanBarcode(p.barcode||"");
  const fish=Object.values(window.SalmonBarcodeSamples?.PRODUCTS||{})
    .find(x=>barcode.startsWith(x.barcode_prefix));
  const result=core.labelAgreement({
    barcode,weight_grams:core.parseAmount(p.weight),
    unit_price_fils:profile?.unit_price_fils??null,
    total_price_fils:core.parseAmount(p.total)
  },profile,{
    expected_product_code:fish?.item_code||"",
    printed_product_code:p.fields?.product_code||"",
    verified_price_prefix:labelPrefix(p,profile)
  });
  if(result.ok&&p.weightConflict&&
    core.parseAmount(p.weight)===p.weightConflict.ocr_weight_grams)
    return {ok:false,state:"mismatch",message:
      "OCR weight conflicts with the printed total. Correct the weight after checking the sticker."};
  return result;
}
function syncConfirmation(p){
  const result=scannedAgreement(p);
  const enabled=!!user&&!busy&&result.ok;
  if(p.saveControl){
    p.saveControl.disabled=!enabled;
    p.saveControl.classList.toggle("is-ready",enabled);
    p.saveControl.classList.toggle("is-not-ready",!enabled);
  }
  if(p.readyNode){
    p.readyNode.textContent=!user?"Sign in to confirm this label.":result.message;
    p.readyNode.className="learn-confirm-status"+(result.ok?" is-ready":
      result.state==="mismatch"?" is-mismatch":" is-incomplete");
  }
  if(p.cardNode)p.cardNode.classList.toggle("learn-card-ready",enabled);
  if(p.conflictNode&&p.weightConflict){
    const incorrect=core.parseAmount(p.weight)===p.weightConflict.ocr_weight_grams;
    p.conflictNode.className=incorrect?"learn-review-alert":"learn-review-corrected";
    if(p.conflictHeading)p.conflictHeading.textContent=incorrect?
      "Weight mismatch detected":"Weight corrected · verify sticker";
  }
  return result;
}
function manualAgreement(){
  const profile=active;
  const barcode=core.cleanBarcode($("learnBarcode").value||"");
  const known=Object.values(window.SalmonBarcodeSamples?.PRODUCTS||{})
    .find(x=>barcode.startsWith(x.barcode_prefix));
  const verifiedPrefix=known?.barcode_prefix||
    (profile?.review_status==="validated"&&barcode.startsWith(profile.barcode_prefix||"")?
      profile.barcode_prefix:"");
  return core.labelAgreement({
    barcode,weight_grams:core.parseAmount($("learnWeight").value),
    unit_price_fils:profile?.unit_price_fils??null,
    total_price_fils:core.parseAmount($("learnTotal").value)
  },profile,{expected_product_code:known?.item_code||"",
    verified_price_prefix:verifiedPrefix});
}

function updateControls(){
  $("learnImportSalmon").disabled=!user||busy;
  const manual=manualAgreement();
  $("learnAddSample").disabled=!user||busy||!manual.ok;
  $("learnAddSample").classList.toggle("is-ready",!!user&&!busy&&manual.ok);
  for(const pending of pendingLabels)syncConfirmation(pending);
  $("learnCreate").disabled=!user||busy;
  $("learnDeleteProfile").hidden=!user||!active;
  $("learnProfiles").disabled=!user||busy;
  window.BarcodeLearningPriceUI?.refresh?.();
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
    const opt=make("option","",p.item_code+" · "+p.product_name+" · "+core.formatAmount(p.unit_price_fils)+" BD/kg · v"+(p.price_version||1));
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
    profiles=(data||[]).filter(p=>!p.archived_at);
    let desired=preferred||active?.id||"";
    if(!profiles.some(p=>p.id===desired))desired="";
    active=profiles.find(p=>p.id===desired)||null;
    displayProfileList();updateControls();
    renderPending();
    await loadSamples();
    window.BarcodeLearningPriceUI?.refresh?.();
    window.BarcodeLearningPriceUI?.checkDeepLink?.();
  }catch(error){if(token===profileToken)msg("learnProfileInfo","Cannot load profiles: "+error.message,true)}
}
function setUser(next){
  user=next||null;
  if(!user)closeSavedSamples();
  $("learnLoginForm").hidden=!!user;
  $("learnSignedIn").hidden=!user;
  $("learnUsername").textContent=user?.email||"";
  if(!user){
    profileToken++;sampleToken++;
    profiles=[];active=null;samples=[];analysis=null;pendingCodes=[];
    const urls=new Set();
    for(const p of pendingLabels)for(const url of [p.photoUrl,p.sheetPhotoUrl]){
      if(url)urls.add(url);
    }
    for(const url of urls)URL.revokeObjectURL(url);
    pendingLabels=[];
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
async function importSalmonExamples(){
  if(busy)return;
  if(!client||!user)return msg("learnImportStatus","Sign in first to save the sample labels.",true);
  const catalog=window.SalmonBarcodeSamples;
  if(!catalog||!catalog.checkExamples(core))
    return msg("learnImportStatus","Salmon example library is unavailable.",true);
  if(!confirm("Import 11 label examples and create up to 3 salmon learning profiles in your private Supabase account? Existing examples will be kept."))return;
  busy=true;updateControls();
  const owner=user.id;
  let saved=0,created=0,firstProfile=null;
  msg("learnImportStatus","Importing photo-verified salmon examples…");
  try{
    for(const code of ["6376","6668","7144"]){
      const def=catalog.PRODUCTS[code];
      if(!def)throw new Error("Unknown sample product "+code);
      let profile=profiles.find(p=>p.item_code===code &&
        p.unit_price_fils===def.unit_price_fils &&
        p.weight_step_grams===def.weight_step_grams &&
        p.rounding_fils===def.rounding_fils);
      if(!profile){
        const {data,error}=await client.from(PROFILES).insert({
          owner_id:owner,item_code:code,product_name:def.product_name,
          weight_step_grams:def.weight_step_grams,unit_price_fils:def.unit_price_fils,
          rounding_fils:def.rounding_fils
        }).select("*").single();
        if(error)throw error;
        profile=data;profiles.push(profile);created++;
      }
      firstProfile ||= profile.id;
      const {data:existing,error:queryError}=await client.from(EXAMPLES)
        .select("barcode,weight_grams,total_price_fils").eq("owner_id",owner).eq("profile_id",profile.id);
      if(queryError)throw queryError;
      const have=new Set((existing||[]).map(e=>e.barcode+"|"+e.weight_grams+"|"+e.total_price_fils));
      const missing=catalog.examplesFor(code).filter(e=>
        !have.has(e.barcode+"|"+e.weight_grams+"|"+e.total_price_fils));
      if(missing.length){
        const records=missing.map(e=>({
          owner_id:owner,profile_id:profile.id,barcode:e.barcode,
          weight_grams:e.weight_grams,total_price_fils:e.total_price_fils,
          verified_from_label:true
        }));
        const {error}=await client.from(EXAMPLES).insert(records);
        if(error)throw error;
        saved+=records.length;
      }
      const all=[...(existing||[]),...missing];
      const result=core.analyze(all,profile);
      const changes={
        barcode_prefix:result.barcode_prefix||"",
        pattern_mode:result.mode||"unknown",
        review_status:result.status||"collecting",
        sample_count:all.length,updated_at:new Date().toISOString()
      };
      const {error:updateError}=await client.from(PROFILES).update(changes)
        .eq("id",profile.id).eq("owner_id",owner);
      if(updateError)throw updateError;
    }
    await loadProfiles(firstProfile);
    msg("learnImportStatus","Imported "+saved+" new label examples. "+
      "Created "+created+" profiles. 6376 and 6668 have 4 examples each; 7144 needs one more independent bone label.");
  }catch(err){
    await loadProfiles(firstProfile);
    msg("learnImportStatus","Import incomplete: "+err.message+". Any successful rows remain saved.",true);
  }finally{busy=false;updateControls()}
}

async function chooseProfile(id){
  closeSavedSamples();
  active=profiles.find(p=>p.id===id)||null;
  samples=[];analysis=null;renderPending();renderSamples();renderAnalysis();
  updateControls();
  await loadSamples();
}
async function deleteProfile(){
  if(!user||!active)return;
  if(!confirm("Delete this learning profile AND all its saved training examples?"))return;
  closeSavedSamples();
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
function openSavedSamples(){
  if(!user||!active)return;
  renderSamples();
  const windowNode=$("learnSavedSamplesDialog");
  if(windowNode.open)return;
  if(typeof windowNode.showModal==="function")windowNode.showModal();
  else windowNode.setAttribute("open","");
}
function closeSavedSamples(){
  const windowNode=$("learnSavedSamplesDialog");
  if(windowNode.open&&typeof windowNode.close==="function")windowNode.close();
  else windowNode.removeAttribute("open");
}
function renderSamples(){
  $("learnCount").textContent=String(samples.length);
  $("learnViewSamples").disabled=!user||!active;
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
  const agreement=manualAgreement();
  if(!agreement.ok)return msg("learnSampleMessage",agreement.message,true);
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

/* Label OCR review: separate cropped images prevent numbers crossing between
   stickers. These suggestions NEVER get saved without explicit confirmation. */
const ocrParser=window.BarcodeLabelOCR,photoEngine=window.LearningPhotoScanner;
function chosenProfile(p){
  const fish=Object.values(window.SalmonBarcodeSamples?.PRODUCTS||{})
    .find(x=>p.barcode.startsWith(x.barcode_prefix));
  const code=fish?.item_code||p.fields?.product_code||"";
  const matches=profiles.filter(x=>code&&x.item_code===code);
  if(matches.length===1)return matches[0];
  if(active&&(!code||active.item_code===code))return active;
  return null;
}
function labelPrefix(p,profile){
  const fish=Object.values(window.SalmonBarcodeSamples?.PRODUCTS||{})
    .find(x=>p.barcode.startsWith(x.barcode_prefix));
  if(fish)return fish.barcode_prefix;
  if(profile?.review_status==="validated"&&p.barcode.startsWith(profile.barcode_prefix))
    return profile.barcode_prefix;
  return "";
}
function scanProfileForBarcode(barcode){
  const profile=chosenProfile({barcode,fields:{}});
  if(!profile)return null;
  return {
    unit_price_fils:Number(profile.unit_price_fils),
    rounding_fils:Number(profile.rounding_fils),
    weight_step_grams:Number(profile.weight_step_grams),
    verified_price_prefix:labelPrefix({barcode},profile)
  };
}
function prefill(p,profile,keep=false){
  const prefix=labelPrefix(p,profile);
  p.review=ocrParser.review(p.fields,profile,p.barcode,core,prefix);
  p.weightConflict=ocrParser.weightPriceConflict(p.review,profile,p.barcode,core,prefix);
  if(p.weightConflict){
    p.review.complete=false;
    p.review.warnings.push("WEIGHT MISMATCH: "+p.weightConflict.message);
  }
  const estimate=profile?ocrParser.inferUniqueWeight(p.barcode,profile,core):null;
  if(estimate){
    const originalTotal=p.review.total_price_fils;
    if(Number.isInteger(originalTotal)&&originalTotal!==estimate.price_fils){
      p.review.warnings.push("The saved rate and encoded price disagree with the sticker. Check both.");
    }else{
      if(!Number.isInteger(originalTotal)){
        p.review.total_price_fils=estimate.price_fils;
        p.review.source_total="barcode_estimate";
        p.review.warnings=p.review.warnings.filter(x=>!x.startsWith("Total price unreadable"));
        p.review.warnings.push("Total price estimated from barcode format. Confirm on label.");
      }
      if(estimate.unique&&!Number.isInteger(p.review.weight_grams)){
        p.review.weight_grams=estimate.weight_grams;
        p.review.source_weight="barcode_estimate";
        p.review.warnings=p.review.warnings.filter(x=>!x.startsWith("Printed weight unreadable"));
        p.review.warnings.push("Weight inferred from barcode total, saved item rate and allowed gram step. Check printed weight.");
        p.review.complete=false;
      }else if(!estimate.unique&&!Number.isInteger(p.review.weight_grams)){
        p.review.warnings.push("Barcode cannot determine one exact weight. Check printed weight.");
      }else if(estimate.unique&&Number.isInteger(p.review.weight_grams)&&
          p.review.weight_grams!==estimate.weight_grams){
        p.review.warnings.push("OCR weight differs from barcode estimate. Verify the original label.");
        p.review.complete=false;
      }
    }
  }
  for(const [key,value] of [["weight",p.review.weight_grams],
    ["unit",p.review.unit_price_fils],["total",p.review.total_price_fils]]){
    // Never preserve an old OCR / previous-profile unit price.
    if(key==="unit"||!keep||!p[key])
      p[key]=Number.isInteger(value)?core.formatAmount(value):"";
  }
}
function queueLabel(raw){
  const p={...raw,id:++pendingId,barcode:core.cleanBarcode(raw.barcode||""),
    fields:raw.fields||{},photoUrl:raw.photoUrl||"",
    sheetPhotoUrl:raw.sheetPhotoUrl||"",
    status:"",weight:"",unit:"",total:"",profileId:""};
  const profile=chosenProfile(p);
  p.profileId=profile?.id||"";
  prefill(p,profile);
  pendingLabels.push(p);
  renderPending();return p;
}
function discardLabel(p){
  pendingLabels=pendingLabels.filter(x=>x!==p);
  if(p.photoUrl)try{URL.revokeObjectURL(p.photoUrl)}catch(_){}
  if(p.sheetPhotoUrl&&!pendingLabels.some(x=>x.sheetPhotoUrl===p.sheetPhotoUrl)){
    try{URL.revokeObjectURL(p.sheetPhotoUrl)}catch(_){}
  }
  renderPending();
}
function showOriginalPhoto(label){
  const source=label.sheetPhotoUrl||label.photoUrl;
  if(!source)return;
  const dialog=$("learnOriginalPhotoDialog");
  $("learnOriginalTitle").textContent="Original photo · "+(label.barcode||"label");
  $("learnOriginalImage").src=source;
  if(!dialog.open){
    if(dialog.showModal)dialog.showModal();
    else dialog.setAttribute("open","");
  }
}
function closeOriginalPhoto(){
  const dialog=$("learnOriginalPhotoDialog");
  if(dialog.open){
    if(dialog.close)dialog.close();
    else dialog.removeAttribute("open");
  }
  $("learnOriginalImage").removeAttribute("src");
}
function imageTapPoint(event,img){
  const rect=img.getBoundingClientRect();
  const iw=img.naturalWidth,ih=img.naturalHeight;
  if(!iw||!ih||rect.width<=0||rect.height<=0)return null;
  const scale=Math.min(rect.width/iw,rect.height/ih);
  const displayedW=iw*scale,displayedH=ih*scale;
  const x=(event.clientX-rect.left-(rect.width-displayedW)/2)/displayedW;
  const y=(event.clientY-rect.top-(rect.height-displayedH)/2)/displayedH;
  if(x<0||x>1||y<0||y>1)return null;
  return {x,y};
}
async function readTappedWeight(p,img,event){
  const point=imageTapPoint(event,img);
  if(!point)return;
  p.picking=false;
  p.status="";
  p.weightReadNote="Reading the number you tapped…";
  renderPending();
  try{
    const profile=profiles.find(x=>x.id===p.profileId)||null;
    const context={step:Number(profile?.weight_step_grams)||1,
      unit_price_fils:profile?.unit_price_fils??null,
      total_price_fils:core.parseAmount(p.total),
      rounding_fils:Number(profile?.rounding_fils)||5};
    const found=await photoEngine.readWeightAtPoint(
      p.photoUrl,point.x,point.y,ocrParser,core,context);
    if(!pendingLabels.includes(p))return;
    if(!found.ok)throw new Error(found.error);
    p.fields={...p.fields,weight_grams:found.weight_grams,
      read_from_photo:{...p.fields?.read_from_photo,weight:true}};
    p.weight=core.formatAmount(found.weight_grams);
    prefill(p,profile,true);
    p.status="";
    p.weightReadNote="Weight read as "+p.weight+" kg. Verify the printed sticker.";
  }catch(err){
    p.status="Weight read unsuccessful: "+(err?.message||"Try tapping the center of the number.");
    p.weightReadNote="";
  }
  renderPending();
}

function editableField(label,p,key,value,placeholder){
  const wrapper=make("label","learn-field",label);
  const input=make("input");
  input.value=value||"";
  input.placeholder=placeholder||"";
  if(!value)input.classList.add("learn-missing-reading");
  if(key==="barcode"){input.inputMode="numeric";input.maxLength=13}
  else{input.type="number";input.inputMode="decimal";input.min="0";input.step=".001"}
  input.addEventListener("input",e=>{
    p[key]=key==="barcode"?core.cleanBarcode(e.target.value):e.target.value;
    input.classList.toggle("learn-missing-reading",!p[key]);
    p.status="";
    if(p.errorNode){p.errorNode.hidden=true;p.errorNode.textContent=""}
    syncConfirmation(p);
  });
  wrapper.append(input);return wrapper;
}
async function saveScannedLabel(p){
  if(!client||!user)return showError(p,"Sign in to save examples.");
  if(busy)return;
  const agreement=scannedAgreement(p);
  if(!agreement.ok)return showError(p,agreement.message);
  const profile=profiles.find(x=>x.id===p.profileId);
  const fish=Object.values(window.SalmonBarcodeSamples?.PRODUCTS||{})
    .find(x=>p.barcode.startsWith(x.barcode_prefix));
  if(fish?.item_code!==undefined&&fish.item_code!==profile.item_code)
    return showError(p,"Barcode belongs to "+fish.item_code+". Select that product.");
  if(p.fields.product_code&&p.fields.product_code!==profile.item_code)
    return showError(p,"Printed product looks like "+p.fields.product_code+
      ". Check the item before saving.");
  if(p.weightConflict&&core.parseAmount(p.weight)===p.weightConflict.ocr_weight_grams)
    return showError(p,"Incorrect weight blocked: "+p.weightConflict.message+
      " Use the suggested weight after verifying the sticker, or enter the correct weight yourself.");
  const unit=Number(profile.unit_price_fils);
  if(!Number.isInteger(unit)||unit<=0)
    return showError(p,"Select an item profile with a valid saved unit price.");
  const check=core.sampleCheck({
    barcode:p.barcode,weight_grams:core.parseAmount(p.weight),
    total_price_fils:core.parseAmount(p.total)
  },profile);
  if(!check.ok)return showError(p,check.reason);
  const encoded=ocrParser.derivePriceFromBarcode(p.barcode,core,labelPrefix(p,profile));
  if(encoded!==null&&encoded!==check.price)
    return showError(p,"Barcode price "+core.formatAmount(encoded)+
      " BD differs from entered total. Recheck this sticker.");
  if(samples.some(x=>x.barcode===check.barcode&&
    (x.weight_grams!==check.weight||x.total_price_fils!==check.price))&&
    !confirm("This barcode already appears with a different printed weight or total. "+
      "That may mean a price barcode cannot identify an exact weight. Save anyway?"))return;
  busy=true;updateControls();
  try{
    const record={owner_id:user.id,profile_id:profile.id,barcode:check.barcode,
      weight_grams:check.weight,total_price_fils:check.price,verified_from_label:true};
    const {error}=await client.from(EXAMPLES).insert(record);
    if(error)throw error;
    discardLabel(p);
    if(active?.id!==profile.id)await chooseProfile(profile.id);
    else await loadSamples();
    msg("learnSampleMessage","Saved "+check.barcode+" · "+
      core.formatAmount(check.weight)+" kg · "+core.formatAmount(check.price)+" BD.");
  }catch(err){showError(p,err.code==="23505"?"Already saved.":err.message)}
  finally{busy=false;updateControls();renderPending()}
}
function showError(p,text){p.status=text;renderPending()}
renderPending=function(){
  const panel=$("learnPending");
  panel.replaceChildren();panel.hidden=!pendingLabels.length;
  if(!pendingLabels.length)return;
  panel.append(make("h3","","Review "+pendingLabels.length+" scanned label(s)"));
  for(const [idx,p] of pendingLabels.entries()){
    const card=make("article","learn-review-card");
    p.cardNode=card;
    const title=make("strong","", "Label "+(idx+1)+" · "+(p.barcode||"Barcode unreadable"));
    card.append(title);
    if(p.photoUrl){
      const img=make("img","learn-review-photo"+(p.picking?" is-picking-weight":""));
      img.src=p.photoUrl;img.alt="Cropped sticker for label "+(idx+1);
      img.loading="lazy";
      if(p.picking)img.addEventListener("click",event=>void readTappedWeight(p,img,event));
      card.append(img);
      const pick=make("button","mini learn-read-weight",
        p.picking?"Tap the weight number in the photo":"Tap photo to read weight");
      pick.type="button";
      pick.addEventListener("click",()=>{
        p.picking=!p.picking;
        p.weightReadNote=p.picking?"Tap the center of the weight printed in the green box.":"";
        renderPending();
      });
      card.append(pick);
      if(p.weightReadNote)
        card.append(make("p","learn-weight-read-note",p.weightReadNote));
    }
    if(p.sheetPhotoUrl){
      const full=make("button","mini learn-view-original","View original sheet");
      full.type="button";
      full.addEventListener("click",()=>showOriginalPhoto(p));
      card.append(full);
    }
    const profileLabel=make("label","learn-field","Product profile");
    const select=make("select");
    const empty=make("option","","Select correct item");empty.value="";select.append(empty);
    for(const x of profiles){
      const option=make("option","",x.item_code+" · "+x.product_name+
        " · "+core.formatAmount(x.unit_price_fils)+" BD/kg");
      option.value=x.id;select.append(option);
    }
    select.value=p.profileId;select.addEventListener("change",()=>{
      p.profileId=select.value;
      prefill(p,profiles.find(x=>x.id===p.profileId)||null,true);renderPending();
    });
    profileLabel.append(select);card.append(profileLabel);
    card.append(editableField("13-digit barcode",p,"barcode",p.barcode,"Scan or type EAN-13"));
    const pair=make("div","learn-review-pair");
    pair.append(editableField("Weight (kg)",p,"weight",p.weight,"Not detected"));
    const unitLabel=make("label","learn-field","Unit price (BD/kg) · From saved profile");
    const unitInput=make("input");
    unitInput.type="text";
    unitInput.value=p.unit||"Select an item profile";
    unitInput.readOnly=true;unitInput.disabled=true;
    unitInput.setAttribute("aria-label","Saved item unit price, not editable");
    unitLabel.append(unitInput);pair.append(unitLabel);
    card.append(pair);
    card.append(editableField("Total (BD)",p,"total",p.total,"Not detected"));
    if(p.weightConflict){
      const conflict=p.weightConflict;
      const stillWrong=core.parseAmount(p.weight)===conflict.ocr_weight_grams;
      const notice=make("div",stillWrong?"learn-review-alert":"learn-review-corrected");
      const heading=make("strong","",stillWrong?"Weight mismatch detected":"Weight corrected · verify sticker");
      const explanation=make("p","",conflict.message);
      notice.append(heading,explanation);
      p.conflictNode=notice;p.conflictHeading=heading;
      if(Number.isInteger(conflict.suggested_weight_grams)){
        const fix=make("button","mini","Use "+core.formatAmount(conflict.suggested_weight_grams)+" kg");
        fix.type="button";
        fix.addEventListener("click",()=>{
          p.weight=core.formatAmount(conflict.suggested_weight_grams);
          p.status="";
          renderPending();
        });
        notice.append(fix);
      }
      card.append(notice);
    }
    const sources=p.review?.read_from_photo||{};
    card.append(make("p","learn-review-source","Read from photo: "+
      (["weight","total"].filter(k=>sources[k]).join(", ")||"unclear")+
      (p.review?.source_weight==="barcode_estimate"?" · Weight estimated from barcode + rate":"")+
      (p.review?.source_total==="barcode"?" · Total from trained barcode":"")+
      (p.review?.source_total==="barcode_estimate"?" · Total estimated from barcode":"")+
      (p.review?.source_unit==="profile"?" · Rate from profile (fixed)":"")));
    const notes=[...p.review?.warnings||[]];
    if(p.notes)notes.push(p.notes);
    if(notes.length)card.append(make("p","learn-review-warning",notes.join(" ")));
    const error=make("p","learn-notice is-error",p.status||"");
    error.hidden=!p.status;p.errorNode=error;card.append(error);
    const readiness=make("p","learn-confirm-status");
    p.readyNode=readiness;card.append(readiness);
    const actions=make("div","learn-review-actions");
    const save=make("button","btn learn-confirm-button is-not-ready","Confirm & save label");
    save.type="button";p.saveControl=save;
    save.addEventListener("click",()=>void saveScannedLabel(p));
    const remove=make("button","mini","Remove");remove.type="button";
    remove.addEventListener("click",()=>discardLabel(p));
    actions.append(save,remove);card.append(actions);panel.append(card);
    syncConfirmation(p);
  }
};
scanPhotos=async function(files){
  if(readingPhotos)return;
  const images=[...(files||[])].filter(x=>x.type.startsWith("image/"));
  if(!images.length)return;
  if(!photoEngine||!ocrParser)return msg("learnSampleMessage","OCR library is unavailable.",true);
  readingPhotos=true;$("learnLiveScan").disabled=true;
  let added=0,missing=0;
  msg("learnScanProgress","Starting label scan…");
  try{
    for(let i=0;i<images.length;i++){
      if(pendingLabels.length>=50)break;
      try{
        const parsed=await photoEngine.readFile(images[i],core,ocrParser,
          t=>msg("learnScanProgress","Photo "+(i+1)+"/"+images.length+" · "+t),
          scanProfileForBarcode);
        for(const label of parsed.labels.slice(0,50-pendingLabels.length)){
          queueLabel(label);added++;if(!label.barcode)missing++;
        }
      }catch(err){msg("learnSampleMessage","Cannot read "+images[i].name+": "+err.message,true)}
    }
  }finally{
    readingPhotos=false;$("learnLiveScan").disabled=false;
    msg("learnScanProgress","");
    msg("learnSampleMessage",added?
      added+" label(s) ready. Review each printed weight and total; unit rate comes from the saved profile."+
      (missing?" "+missing+" barcode(s) need manual entry.":""):
      "No readable labels. Try a closer image.",!added);
  }
};

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
function capturedBarcode(raw,box=null){
  if(!camActive)return false;
  const barcode=core.cleanBarcode(raw);
  if(!core.validBarcode(barcode))return false;
  if(camMode==="test"){
    stopCamera();
    $("learnTestBarcode").value=barcode;
    msg("learnTestScanMessage","Scanned "+barcode+". Result shown below.");
    testBarcode({preventDefault(){}});
    return true;
  }
  const reading=photoEngine?.readCameraFrame?.(video,barcode,box,core,ocrParser,
    undefined,scanProfileForBarcode);
  stopCamera();
  msg("learnScanProgress","Reading the captured sticker…");
  void Promise.resolve(reading).then(data=>{
    queueLabel({...data,barcode});
    msg("learnScanProgress","");
    msg("learnSampleMessage","Label captured. Review the photo, weight, unit price and total.");
  }).catch(err=>{
    queueLabel({barcode,notes:"Printed fields unreadable: "+err.message});
    msg("learnScanProgress","");
  });
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
      for(const q of results)if(capturedBarcode(q.rawValue,q.boundingBox))return;
    }
  }catch(_){}
  if(camActive&&camToken===token)camTimer=setTimeout(()=>void nativeLoop(token),170);
}
async function startCamera(mode="label"){
  if(camActive)return;
  camMode=mode==="test"?"test":"label";
  const messageId=camMode==="test"?"learnTestScanMessage":"learnSampleMessage";
  if(camMode==="test"){
    msg(messageId,"");
    $("learnTestResult").hidden=true;
  }
  if(!navigator.mediaDevices?.getUserMedia||!window.isSecureContext){
    msg(messageId,"Camera scanning requires HTTPS and camera permission.",true);return;
  }
  camActive=true;const token=++camToken;
  $("learnCameraHeading").textContent=camMode==="test"?"Scan barcode to test":"Scan a full label";
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
    const messageId=camMode==="test"?"learnTestScanMessage":"learnSampleMessage";
    stopCamera();
    msg(messageId,"Camera unavailable: "+(err?.message||"Use manual entry."),true);
  }
}
$("learnLoginForm").addEventListener("submit",e=>void login(e));
$("learnSignOut").addEventListener("click",async()=>{
  stopCamera();if(client)await client.auth.signOut();setUser(null);
});
$("learnProfileForm").addEventListener("submit",e=>void createProfile(e));
$("learnImportSalmon").addEventListener("click",()=>void importSalmonExamples());
$("learnProfiles").addEventListener("change",e=>void chooseProfile(e.target.value));
$("learnDeleteProfile").addEventListener("click",()=>void deleteProfile());
$("learnSampleForm").addEventListener("submit",e=>void saveExample(e));
$("learnViewSamples").addEventListener("click",openSavedSamples);
$("learnSavedSamplesClose").addEventListener("click",closeSavedSamples);
$("learnSavedSamplesDialog").addEventListener("cancel",e=>{e.preventDefault();closeSavedSamples()});
for(const id of ["learnBarcode","learnWeight","learnTotal"]){
  $(id).addEventListener("input",updateControls);
}
$("learnTestForm").addEventListener("submit",testBarcode);
$("learnLiveScan").addEventListener("click",()=>void startCamera("label"));
$("learnTestScan").addEventListener("click",()=>void startCamera("test"));
$("learnCameraStop").addEventListener("click",stopCamera);
$("learnOriginalClose").addEventListener("click",closeOriginalPhoto);
$("learnOriginalPhotoDialog").addEventListener("cancel",e=>{
  e.preventDefault();closeOriginalPhoto();
});
dialog.addEventListener("cancel",e=>{e.preventDefault();stopCamera()});
$("learnPhoto").addEventListener("change",e=>{void scanPhotos(e.target.files);e.target.value=""});
$("learnSinglePhoto").addEventListener("change",e=>{void scanPhotos(e.target.files);e.target.value=""});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&camActive)stopCamera()});
window.addEventListener("pagehide",stopCamera);
updateControls();renderSamples();renderAnalysis();void init();
window.BarcodeLearningChecks={capturedBarcode,stopCamera,scanPhotos,model,
  getSamples:()=>samples,getActive:()=>active,getAnalysis:()=>analysis,getPending:()=>pendingLabels,
  getClient:()=>client,getUser:()=>user,refreshProfiles:loadProfiles,
  clearPendingLabels:()=>{for(const p of [...pendingLabels])discardLabel(p);pendingCodes=[];renderPending();}};
})();