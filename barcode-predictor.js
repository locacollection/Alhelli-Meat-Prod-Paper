/* Standalone barcode prediction with user-confirmed saved examples.
   Never treats predictions as label evidence without the user's explicit confirmation. */
(()=>{
"use strict";
const PROJECT_URL="https://tvaqcbzmzpyltbbelwbw.supabase.co";
const PUBLIC_KEY="sb_publishable_yqrAl20jwQlW4J8furYn3Q_kjQFIFrr";
const TABLE="barcode_learning_profiles";
const EXAMPLES="barcode_learning_examples";
const core=window.BarcodeLearningCore;
const $=id=>document.getElementById(id);
let client=null,user=null,profiles=[],profilesRequest=0;
let currentPrediction=null,savingExample=false;
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
function clearResult(){
  currentPrediction=null;
  $("predictorAddLearning").disabled=false;
  $("predictorAddLearning").textContent="Add to Barcode Learning";
  message("predictorLearningFeedback","");
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
  currentPrediction=available?{profileId:p.id,barcode:result.barcode,grams,total,ownerId:user?.id}:null;
  $("predictorAddLearning").disabled=false;
  $("predictorAddLearning").textContent="Add to Barcode Learning";
  message("predictorLearningFeedback","");
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

/* User independently compares the predicted barcode, weight and price to a
   real sticker. Only then is it stored as a confirmed learning example. */
async function savePredictedAsExample(){
  if(savingExample)return;
  if(!client||!user||!currentPrediction)
    return message("predictorLearningFeedback","Predict a barcode while signed in before saving.",true);
  const profile=selectedProfile();
  const prediction={...currentPrediction};
  if(!profile||profile.id!==prediction.profileId||prediction.ownerId!==user.id)
    return message("predictorLearningFeedback","The selected profile has changed. Predict again.",true);
  const computedStrict=core.suggestBarcode(prediction.grams,profile);
  const computedCandidate=!computedStrict.ok?core.suggestBarcodeCandidate(prediction.grams,profile):null;
  const calculated=computedStrict.ok?computedStrict:computedCandidate;
  if(!calculated?.ok||calculated.barcode!==prediction.barcode||
    calculated.total_price_fils!==prediction.total)
    return message("predictorLearningFeedback","The prediction is no longer consistent with the saved item profile. Predict again.",true);
  const checked=core.sampleCheck({
    barcode:prediction.barcode,weight_grams:prediction.grams,
    total_price_fils:prediction.total
  },profile);
  if(!checked.ok)
    return message("predictorLearningFeedback","Cannot save: "+checked.reason,true);
  const agreed=window.confirm(
    "Have you personally checked a REAL printed sticker and confirmed ALL three details match?\n\n"+
    "Item: "+profile.item_code+" · "+profile.product_name+"\n"+
    "Barcode: "+prediction.barcode+"\n"+
    "Weight: "+core.formatAmount(prediction.grams)+" kg\n"+
    "Total: "+core.formatAmount(prediction.total)+" BD\n\n"+
    "Only choose OK if the barcode, printed weight and printed total match. "+
    "This will save a confirmed example in Barcode Learning, not authorize store checkout."
  );
  if(!agreed)return;
  savingExample=true;
  $("predictorAddLearning").disabled=true;
  const owner=prediction.ownerId;
  const stillCurrent=()=>user?.id===owner&&currentPrediction?.profileId===profile.id&&
    currentPrediction?.barcode===prediction.barcode&&
    currentPrediction?.grams===prediction.grams;
  message("predictorLearningFeedback","Checking existing learning examples…");
  try{
    const {data:existing,error:existingError}=await client.from(EXAMPLES)
      .select("id,barcode,weight_grams,total_price_fils")
      .eq("owner_id",owner).eq("profile_id",profile.id)
      .eq("barcode",prediction.barcode).limit(5);
    if(existingError)throw existingError;
    if(!stillCurrent())return;
    if(existing?.length){
      if(existing.some(x=>x.weight_grams!==prediction.grams||
          x.total_price_fils!==prediction.total)){
        message("predictorLearningFeedback",
          "This barcode is already saved with a different weight or total. Review it in Barcode Learning; it cannot be stored with conflicting values.",true);
      }else{
        message("predictorLearningFeedback","This exact barcode, weight and price are already saved in Barcode Learning.");
        $("predictorAddLearning").textContent="Already in Barcode Learning";
      }
      return;
    }
    const record={owner_id:owner,profile_id:profile.id,barcode:prediction.barcode,
      weight_grams:prediction.grams,total_price_fils:prediction.total,
      verified_from_label:true};
    const {error:insertError}=await client.from(EXAMPLES).insert(record);
    if(insertError)throw insertError;
    if(!stillCurrent())return;
    message("predictorLearningFeedback","Saved as a confirmed label in Barcode Learning. Updating its learning result…");
    $("predictorAddLearning").textContent="Added to Barcode Learning";
    const {data:rows,error:listError}=await client.from(EXAMPLES)
      .select("barcode,weight_grams,total_price_fils")
      .eq("owner_id",owner).eq("profile_id",profile.id)
      .order("created_at",{ascending:true}).limit(500);
    if(listError)throw listError;
    const analyzed=core.analyze(rows||[],profile);
    const changes={barcode_prefix:analyzed.barcode_prefix||"",
      pattern_mode:analyzed.mode||"unknown",
      review_status:analyzed.status||"collecting",
      sample_count:(rows||[]).length,updated_at:new Date().toISOString()};
    const {error:updateError}=await client.from(TABLE)
      .update(changes).eq("id",profile.id).eq("owner_id",owner);
    if(updateError)throw updateError;
    Object.assign(profile,changes);
    if(stillCurrent()){
      renderProfileSummary();
      message("predictorLearningFeedback",
        "Saved to Barcode Learning. "+changes.sample_count+
        " confirmed example(s) are now included in the selected profile. You can review them under Saved Training Labels.");
    }
  }catch(err){
    message("predictorLearningFeedback",
      "Could not finish saving or refreshing the learning result: "+(err?.message||err)+
      ". Check Saved Training Labels before trying again, to avoid duplicate examples.",true);
  }finally{
    savingExample=false;
    $("predictorAddLearning").disabled=false;
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
$("predictorAddLearning").addEventListener("click",()=>void savePredictedAsExample());
renderProfiles();
void initialize();
})();
