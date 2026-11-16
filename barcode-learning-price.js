/* Versioned unit prices for Barcode Learning.
   Each new price creates an independent profile; old examples remain untouched. */
(()=>{
"use strict";
const $=id=>document.getElementById(id);
const api=window.BarcodeLearningChecks;
const core=window.BarcodeLearningCore;
if(!api||!core)return;
let changing=false,historyToken=0,deepLinkHandled=false;
const route=String(window.location?.search||"");
const requestedProfile=route.match(/[?&]profile=([a-f0-9-]{36})(?:&|$)/i)?.[1]||"";
const openOnLoad=/(?:[?&])change-price=1(?:&|$)/.test(route);
const node=(tag,cls,value)=>{
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(value!==undefined)el.textContent=String(value);
  return el;
};
function message(id,value,error=false){
  const el=$(id);
  el.textContent=value||"";
  el.hidden=!value;
  el.classList.toggle("is-error",!!error);
}
function openDialog(el){
  if(el.open)return;
  if(typeof el.showModal==="function")el.showModal();
  else el.setAttribute("open","");
}
function closeDialog(el){
  if(el.open&&typeof el.close==="function")el.close();
  else if(typeof el.removeAttribute==="function")el.removeAttribute("open");
}
function closeChange(){closeDialog($("learnChangePriceDialog"))}
function closeHistory(){
  historyToken++;
  closeDialog($("learnPriceHistoryDialog"));
  $("learnPriceHistorySamples").hidden=true;
}
function refresh(){
  const profile=api.getActive(),user=api.getUser();
  $("learnChangePriceOpen").disabled=!user||!profile||changing;
  $("learnPriceHistoryOpen").disabled=!user||!profile||changing;
  $("learnCurrentPrice").textContent=profile?
    "Current: "+core.formatAmount(profile.unit_price_fils)+" BD/kg · Version "+
      (profile.price_version||1)+" · "+(profile.sample_count||0)+
      " confirmed label(s) for this price.":
    "Select an item to see its active price and training version.";
  if(!user){closeChange();closeHistory()}
}
function openChange(){
  const profile=api.getActive();
  if(changing||!api.getUser()||!profile)return;
  $("learnChangePriceAbout").textContent=profile.item_code+" · "+profile.product_name+
    " · Current price: "+core.formatAmount(profile.unit_price_fils)+
    " BD/kg (version "+(profile.price_version||1)+")";
  $("learnNewPrice").value="";
  message("learnChangePriceFeedback","");
  openDialog($("learnChangePriceDialog"));
}
function checkDeepLink(){
  if(deepLinkHandled||!openOnLoad||!api.getActive())return;
  if(requestedProfile&&api.getActive().id!==requestedProfile)return;
  deepLinkHandled=true;
  openChange();
}
async function changePrice(event){
  event.preventDefault();
  if(changing||!api.getClient()||!api.getUser()||!api.getActive())return;
  const profile=api.getActive();
  const price=core.parseAmount($("learnNewPrice").value);
  if(!Number.isInteger(price)||price<1||price>999999)
    return message("learnChangePriceFeedback","Enter a price from 0.001 to 999.999 BD/kg.",true);
  if(price===profile.unit_price_fils)
    return message("learnChangePriceFeedback","The new price must be different from the current price.",true);
  if(!window.confirm("Change "+profile.item_code+" · "+profile.product_name+
    " from "+core.formatAmount(profile.unit_price_fils)+" to "+core.formatAmount(price)+
    " BD/kg?\n\nYour old price, learned pattern and all its labels will remain in Price History. "+
    "The new price needs at least 4 different confirmed labels (3 different weights and totals) before predictions are validated."))return;

  changing=true;refresh();
  $("learnChangePriceSubmit").disabled=true;
  message("learnChangePriceFeedback","Creating a new price version…");
  let newId=null;
  try{
    const {data,error}=await api.getClient().rpc("start_barcode_learning_price_version",{
      p_profile_id:profile.id,
      p_new_unit_price_fils:price,
      p_expected_unit_price_fils:profile.unit_price_fils
    });
    if(error)throw error;
    if(!data)throw Error("Database did not return the new profile ID. Check Price History.");
    newId=data;
    api.stopCamera();
    api.clearPendingLabels();
    closeChange();closeHistory();
    await api.refreshProfiles(newId);
    message("learnProfileInfo","Price updated to "+core.formatAmount(price)+
      " BD/kg. Version "+(api.getActive()?.price_version||"new")+
      " starts with no confirmed labels. Add at least 4 varied REAL labels to revalidate the barcode pattern. "+
      "All older prices and labels remain in View price history.");
  }catch(err){
    message("learnChangePriceFeedback",
      "Could not complete the price change: "+(err?.message||err)+
      (newId?" A new price version may have been created. Check the active profile and price history before retrying.":""),true);
  }finally{
    changing=false;$("learnChangePriceSubmit").disabled=false;refresh();
  }
}
async function showHistoricalLabels(version,series){
  const current=api.getActive(),user=api.getUser();
  if(!current||!user||series!==current.price_series_id)return;
  const token=historyToken,owner=user.id;
  const holder=$("learnPriceHistorySamplesList");
  $("learnPriceHistorySamples").hidden=false;
  $("learnPriceHistorySamplesTitle").textContent="Version "+version.price_version+
    " · "+core.formatAmount(version.unit_price_fils)+" BD/kg · Saved labels";
  holder.replaceChildren(node("p","fineprint","Loading labels…"));
  try{
    const {data,error}=await api.getClient().from("barcode_learning_examples")
      .select("barcode,weight_grams,total_price_fils,created_at")
      .eq("owner_id",owner).eq("profile_id",version.id)
      .order("created_at",{ascending:true}).limit(500);
    if(error)throw error;
    if(token!==historyToken||api.getUser()?.id!==owner||api.getActive()?.price_series_id!==series)return;
    holder.replaceChildren();
    if(!data?.length)return holder.append(node("p","fineprint","No saved labels for this price."));
    for(const row of data){
      const card=node("div","learn-sample"),desc=node("div","");
      desc.append(node("strong","",row.barcode));
      desc.append(node("small","",core.formatAmount(row.weight_grams)+
        " kg · "+core.formatAmount(row.total_price_fils)+" BD"));
      card.append(desc);holder.append(card);
    }
  }catch(err){
    if(token===historyToken)holder.replaceChildren(node("p","fineprint","Cannot load labels: "+err.message));
  }
}
async function openHistory(){
  const current=api.getActive(),user=api.getUser();
  if(!current||!user||changing)return;
  const dialog=$("learnPriceHistoryDialog");
  openDialog(dialog);
  $("learnPriceHistorySamples").hidden=true;
  message("learnPriceHistoryFeedback","");
  const token=++historyToken,owner=user.id,series=current.price_series_id;
  const holder=$("learnPriceHistoryList");
  holder.replaceChildren(node("p","fineprint","Loading prices…"));
  try{
    const {data,error}=await api.getClient().from("barcode_learning_profiles")
      .select("id,price_series_id,price_version,unit_price_fils,archived_at,sample_count,review_status,barcode_prefix,pattern_mode")
      .eq("owner_id",owner).eq("price_series_id",series)
      .order("price_version",{ascending:false}).limit(50);
    if(error)throw error;
    if(token!==historyToken||api.getUser()?.id!==owner||api.getActive()?.price_series_id!==series)return;
    holder.replaceChildren();
    for(const version of data||[]){
      const card=node("article","learn-price-history-row"),details=node("div","");
      details.append(node("strong","",core.formatAmount(version.unit_price_fils)+
        " BD/kg · Version "+version.price_version+(version.archived_at?" · Previous":" · Active")));
      details.append(node("small","",(version.sample_count||0)+
        " label(s) · "+(version.review_status==="validated"?"Pattern validated":"Pattern "+version.review_status)+
        (version.barcode_prefix?" · Prefix "+version.barcode_prefix:"")));
      const button=node("button","mini","View labels");
      button.type="button";
      button.addEventListener("click",()=>void showHistoricalLabels(version,series));
      card.append(details,button);holder.append(card);
    }
    if(!data?.length)holder.append(node("p","fineprint","No price versions found."));
  }catch(err){if(token===historyToken)message("learnPriceHistoryFeedback","Cannot load price history: "+err.message,true)}
}
$("learnChangePriceOpen").addEventListener("click",openChange);
$("learnChangePriceClose").addEventListener("click",closeChange);
$("learnChangePriceForm").addEventListener("submit",e=>void changePrice(e));
$("learnChangePriceDialog").addEventListener("cancel",e=>{e.preventDefault();closeChange()});
$("learnPriceHistoryOpen").addEventListener("click",()=>void openHistory());
$("learnPriceHistoryClose").addEventListener("click",closeHistory);
$("learnPriceHistoryDialog").addEventListener("cancel",e=>{e.preventDefault();closeHistory()});
window.BarcodeLearningPriceUI={refresh,checkDeepLink};
refresh();
checkDeepLink();
})();