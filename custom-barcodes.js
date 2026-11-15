/* Private custom barcode catalog. EAN-13 product labels are recorded exactly.
   Original 6777/6780/6781 recipe barcodes are never edited here. */
(()=>{
"use strict";
const PROJECT_URL="https://tvaqcbzmzpyltbbelwbw.supabase.co";
const PUBLIC_KEY="sb_publishable_yqrAl20jwQlW4J8furYn3Q_kjQFIFrr";
const TABLE="custom_barcode_items";
const PAGE_SIZE=50;
const $=id=>document.getElementById(id);
const RESTRICTED=["966777","966780","966781"];
let client=null,user=null,working=false,editingId=null,records=[],page=0,hasMore=false;
let loadingToken=0,searchTimer=null;
let videoStream=null,detector=null,legacyReader=null,cameraToken=0,cameraTimer=null,cameraActive=false,legacyLoader=null;

function barcodeDigits(raw){return String(raw??"").replace(/[\s-]/g,"")}
function isValidEAN13(code){
  if(!/^\d{13}$/.test(code))return false;
  let sum=0;
  for(let i=0;i<12;i++)sum+=Number(code[i])*(i%2?3:1);
  return (10-sum%10)%10===Number(code[12]);
}
function isReserved(code){return RESTRICTED.some(prefix=>code.startsWith(prefix))}
function optionalFils(input,label){
  const value=String(input??"").trim();
  if(!value)return null;
  if(!/^\d{1,3}(?:\.\d{1,3})?$/.test(value))
    throw new Error(label+" must be a valid BD amount with up to 3 decimal places.");
  const [major,minor=""]=value.split(".");
  const fils=Number(major)*1000+Number(minor.padEnd(3,"0"));
  if(fils>999999)throw new Error(label+" is too large.");
  return fils;
}
function filsText(n){return Number.isInteger(n)?(n/1000).toFixed(3):"Not entered"}
function validateInput(data){
  const barcode=barcodeDigits(data.barcode);
  if(!isValidEAN13(barcode))throw new Error("Enter or scan a valid 13-digit EAN-13 barcode (correct check digit required).");
  if(isReserved(barcode))throw new Error("This barcode belongs to the protected 6777, 6780 or 6781 meat catalog. Use the Production Scanner instead.");
  const product_name=String(data.product_name??"").trim();
  if(!product_name||product_name.length>120)throw new Error("Enter a product name (maximum 120 characters).");
  const item_code=String(data.item_code??"").trim();
  if(item_code.length>32)throw new Error("Item code is too long.");
  const unit_type=String(data.unit_type);
  if(unit_type!=="kg"&&unit_type!=="pcs")throw new Error("Select kilogram or per piece.");
  let weight_grams=null,quantity_pieces=null;
  if(unit_type==="kg"){
    const raw=String(data.weight??"").trim();
    if(!/^\d{1,3}(?:\.\d{1,3})?$/.test(raw))throw new Error("Enter the printed weight in kilograms.");
    const [whole,decimal=""]=raw.split(".");
    weight_grams=Number(whole)*1000+Number(decimal.padEnd(3,"0"));
    if(!Number.isInteger(weight_grams)||weight_grams<5||weight_grams>100000||weight_grams%5!==0)
      throw new Error("Weight must be between 0.005 and 100.000 kg in 0.005 kg (5 g) steps.");
  }else{
    const raw=String(data.pieces??"").trim();
    if(!/^\d+$/.test(raw))throw new Error("Enter the number of pieces.");
    quantity_pieces=Number(raw);
    if(!Number.isSafeInteger(quantity_pieces)||quantity_pieces<1||quantity_pieces>10000)
      throw new Error("Piece quantity must be a whole number from 1 to 10,000.");
  }
  const unit_price_fils=optionalFils(data.unit_price,"Unit price");
  const total_price_fils=optionalFils(data.total_price,"Printed total");
  const notes=String(data.notes??"").trim();
  if(notes.length>450)throw new Error("Notes cannot exceed 450 characters.");
  return {barcode,product_name,item_code,unit_type,weight_grams,quantity_pieces,
    unit_price_fils,total_price_fils,notes};
}
function estimatedTotal(row){
  if(!Number.isInteger(row.unit_price_fils))return null;
  if(row.unit_type==="kg"&&Number.isInteger(row.weight_grams))
    return Math.round(row.unit_price_fils*row.weight_grams/1000/5)*5;
  if(row.unit_type==="pcs"&&Number.isInteger(row.quantity_pieces))
    return row.unit_price_fils*row.quantity_pieces;
  return null;
}
function itemQuantity(row){
  return row.unit_type==="kg"?(row.weight_grams/1000).toFixed(3)+" kg":row.quantity_pieces+" PC"+(row.quantity_pieces===1?"":"s");
}
function status(id,message,isError=false){
  const el=$(id);el.hidden=!message;el.textContent=message||"";
  el.classList.toggle("error",isError);
}
function setBusy(yes){
  working=yes;
  $("customSave").disabled=yes||!user;
  $("customRefresh").disabled=yes;
}
function create(tag,cls,text){
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(text!==undefined)el.textContent=String(text);
  return el;
}
function getFormData(){
  return {barcode:$("customBarcode").value,item_code:$("customItemCode").value,
    product_name:$("customProductName").value,unit_type:$("customUnitType").value,
    weight:$("customWeight").value,pieces:$("customPieces").value,
    unit_price:$("customUnitPrice").value,total_price:$("customTotalPrice").value,
    notes:$("customNotes").value};
}
function toggleUnit(){
  const pcs=$("customUnitType").value==="pcs";
  $("customKgField").hidden=pcs;$("customPiecesField").hidden=!pcs;
  updateEstimated();
}
function updateEstimated(){
  const unit=$("customUnitType").value;
  let est=null;
  try{
    const price=optionalFils($("customUnitPrice").value,"Unit price");
    if(price!==null){
      const count=unit==="kg"?Number($("customWeight").value)*1000:Number($("customPieces").value);
      if(Number.isInteger(count)&&count>0){
        est=unit==="kg"?Math.round(price*count/1000/5)*5:price*count;
      }
    }
  }catch(_){}
  const v=$("customCalculatedTotal");
  v.textContent=est===null?"Estimated total: not available":
    "Estimated total: "+filsText(est)+" BD · not a confirmed printed amount";
  if($("customTotalPrice").value.trim())v.textContent+=" (printed total entered separately)";
}
function resetForm(){
  editingId=null;
  $("customBarcodeForm").reset();
  $("customUnitType").value="kg";
  $("managerFormTitle").textContent="Add new barcode";
  $("customSave").textContent="Save barcode to database";
  $("managerEditFlag").hidden=true;
  $("customBarcodeLookup").hidden=true;
  $("customBarcodeLookup").textContent="";
  toggleUnit();status("customFormStatus","");
}
function fillForm(row){
  editingId=row.id;
  $("customBarcode").value=row.barcode;
  $("customItemCode").value=row.item_code||"";
  $("customProductName").value=row.product_name;
  $("customUnitType").value=row.unit_type;
  $("customWeight").value=row.unit_type==="kg"?(row.weight_grams/1000).toFixed(3):"";
  $("customPieces").value=row.unit_type==="pcs"?row.quantity_pieces:"";
  $("customUnitPrice").value=filsText(row.unit_price_fils)==="Not entered"?"":filsText(row.unit_price_fils);
  $("customTotalPrice").value=filsText(row.total_price_fils)==="Not entered"?"":filsText(row.total_price_fils);
  $("customNotes").value=row.notes||"";
  $("managerFormTitle").textContent="Edit saved barcode";
  $("customSave").textContent="Update barcode";
  $("managerEditFlag").hidden=false;
  toggleUnit();status("customFormStatus","Editing "+row.barcode+". Changes are saved only when you tap Update.");
  $("managerEditor").scrollIntoView({behavior:"smooth",block:"start"});
}
function safeSearch(raw){
  return String(raw||"").normalize("NFKC").replace(/[^\p{L}\p{N}\s_-]/gu,"").trim().slice(0,65);
}
function buildRecordCard(row){
  const card=create("article","manager-record");
  card.append(create("strong","",row.product_name));
  card.append(create("code","",row.barcode));
  const desc=[row.item_code?"PLU "+row.item_code:null,
    itemQuantity(row),row.unit_price_fils!==null?"Unit "+filsText(row.unit_price_fils)+" BD":null,
    row.total_price_fils!==null?"Total "+filsText(row.total_price_fils)+" BD":null].filter(Boolean);
  card.append(create("p","",desc.join(" · ")));
  if(row.notes)card.append(create("p","",row.notes));
  const actions=create("div","manager-record-buttons");
  const edit=create("button","mini","Edit");edit.type="button";
  edit.addEventListener("click",()=>fillForm(row));
  const remove=create("button","mini is-danger","Delete");remove.type="button";
  remove.addEventListener("click",()=>void deleteRecord(row));
  actions.append(edit,remove);card.append(actions);
  return card;
}
function drawRecords(){
  const list=$("customRecords");list.replaceChildren();
  if(!user){list.append(create("div","manager-empty","Sign in to see your own saved barcodes."));return}
  if(!records.length){list.append(create("div","manager-empty","No saved barcodes found. Scan one and add its details."));return}
  for(const row of records)list.append(buildRecordCard(row));
}
async function loadRecords(reset=true){
  if(!client||!user)return;
  const ticket=++loadingToken;
  const nextPage=reset?0:page+1;
  const query=safeSearch($("customSearch").value);
  status("managerAuthStatus","");
  try{
    let q=client.from(TABLE).select("*",{count:"exact"})
      .eq("owner_id",user.id)
      .order("updated_at",{ascending:false})
      .range(nextPage*PAGE_SIZE,(nextPage+1)*PAGE_SIZE-1);
    if(query){
      // Avoid raw PostgREST filter injection by stripping punctuation.
      q=q.or("product_name.ilike.%"+query+"%,item_code.ilike.%"+query+"%,barcode.ilike.%"+query+"%");
    }
    const {data,error,count}=await q;
    if(error)throw error;
    if(ticket!==loadingToken)return;
    records=reset?(data||[]):records.concat(data||[]);
    page=nextPage;
    hasMore=records.length<(count??records.length);
    $("customMore").hidden=!hasMore;
    $("customStats").textContent=(count??records.length)+" matching barcode"+((count??records.length)===1?"":"s")+
      (hasMore?" · showing "+records.length:"");
    drawRecords();
  }catch(err){if(ticket===loadingToken)status("managerAuthStatus","Could not load barcodes: "+err.message,true)}
}
async function lookupSaved(code){
  if(!client||!user)return;
  const barcode=barcodeDigits(code);
  if(!isValidEAN13(barcode))return;
  const {data,error}=await client.from(TABLE).select("*")
    .eq("owner_id",user.id).eq("barcode",barcode).maybeSingle();
  if(error){status("customFormStatus",error.message,true);return}
  if(data){
    $("customBarcodeLookup").textContent="This barcode is already saved as "+data.product_name+". Loading it for editing.";
    $("customBarcodeLookup").hidden=false;
    fillForm(data);
  }else{
    editingId=null;
    $("managerFormTitle").textContent="Add new barcode";
    $("customSave").textContent="Save barcode to database";
    $("managerEditFlag").hidden=true;
    $("customBarcodeLookup").textContent="Valid barcode, not yet saved in your catalog. Enter item details to add it.";
    $("customBarcodeLookup").hidden=false;
  }
}
async function saveRecord(event){
  event.preventDefault();
  if(!client||!user){status("customFormStatus","Sign in first to save a barcode.",true);return}
  let details;
  try{details=validateInput(getFormData())}
  catch(err){status("customFormStatus",err.message,true);return}
  setBusy(true);
  status("customFormStatus","Saving barcode…");
  const payload={...details,updated_at:new Date().toISOString()};
  let response;
  try{
    if(editingId){
      response=await client.from(TABLE).update(payload)
        .eq("id",editingId).eq("owner_id",user.id).select("id").single();
    }else{
      response=await client.from(TABLE).insert({...payload,owner_id:user.id})
        .select("id").single();
    }
    if(response.error)throw response.error;
    const savedCode=details.barcode;
    resetForm();status("customFormStatus","Saved "+savedCode+" to your private barcode database.");
    await loadRecords(true);
  }catch(err){
    const message=err.code==="23505"?"This barcode is already saved. Select Edit from your saved list.":
      (err.message||"Unknown database error.");
    status("customFormStatus","Could not save: "+message,true);
  }finally{setBusy(false)}
}
async function deleteRecord(row){
  if(!client||!user)return;
  if(!confirm('Delete barcode '+row.barcode+" ("+row.product_name+") from your custom catalog?"))return;
  const {error}=await client.from(TABLE).delete()
    .eq("id",row.id).eq("owner_id",user.id);
  if(error){status("managerAuthStatus","Delete failed: "+error.message,true);return}
  if(editingId===row.id)resetForm();
  status("managerAuthStatus","Barcode "+row.barcode+" deleted.");
  await loadRecords(true);
}
function setUser(next){
  user=next||null;
  $("managerSignedOut").hidden=!!user;
  $("managerSignedIn").hidden=!user;
  $("managerUsername").textContent=user?.email||"";
  $("customSave").disabled=!user||working;
  if(user){
    $("customStats").textContent="Loading your private catalog…";
    void loadRecords(true);
  }else{
    loadingToken++;
    records=[];page=0;hasMore=false;
    $("customMore").hidden=true;
    $("customStats").textContent="Sign in to manage saved barcodes.";
    drawRecords();
  }
}
async function login(event){
  event.preventDefault();
  if(!client){status("managerAuthStatus","Database connection unavailable.",true);return}
  status("managerAuthStatus","Signing in…");
  const email=$("managerEmail").value.trim(),password=$("managerPassword").value;
  const {data,error}=await client.auth.signInWithPassword({email,password});
  $("managerPassword").value="";
  if(error){status("managerAuthStatus",error.message,true);return}
  setUser(data.user);status("managerAuthStatus","Signed in. You can now scan and save barcodes.");
}
async function createAccount(){
  if(!client){status("managerAuthStatus","Database connection unavailable.",true);return}
  const email=$("managerEmail").value.trim(),password=$("managerPassword").value;
  if(!email||password.length<6){status("managerAuthStatus","Enter an email and password of at least 6 characters.",true);return}
  status("managerAuthStatus","Creating account…");
  const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:location.href.split("?")[0]}});
  $("managerPassword").value="";
  if(error){status("managerAuthStatus",error.message,true);return}
  if(data?.session){setUser(data.session.user);status("managerAuthStatus","Account created and signed in.");}
  else status("managerAuthStatus","Check your email to confirm the account, then return and sign in.");
}
async function initAuth(){
  if(!window.supabase?.createClient){
    status("managerAuthStatus","Database library unavailable. Check your internet connection.",true);
    setUser(null);return;
  }
  client=window.supabase.createClient(PROJECT_URL,PUBLIC_KEY);
  const {data,error}=await client.auth.getSession();
  if(error)status("managerAuthStatus",error.message,true);
  setUser(data?.session?.user||null);
  client.auth.onAuthStateChange((_event,session)=>{
    if(session?.user?.id!==user?.id)setUser(session?.user||null);
  });
}

// Camera uses EAN-13 detection without requiring a barcode to exist already.
// Unlike the production scanner, newly found numbers are NOT automatically
// inserted. The user must fill the item fields and explicitly save.
const cameraDialog=$("customCameraDialog"),video=$("customVideo");
function cameraMessage(message){$("customCameraStatus").textContent=message}
function stopCamera(){
  cameraToken++;cameraActive=false;
  if(cameraTimer!==null){clearTimeout(cameraTimer);cameraTimer=null}
  if(legacyReader){try{legacyReader.reset()}catch(_){}legacyReader=null}
  if(videoStream){for(const track of videoStream.getTracks())try{track.stop()}catch(_){}videoStream=null}
  try{video.pause()}catch(_){}
  video.srcObject=null;
}
function closeCamera(){
  stopCamera();
  if(cameraDialog.open){
    if(cameraDialog.close)cameraDialog.close();
    else cameraDialog.removeAttribute("open");
  }
}
function capturedBarcode(raw){
  if(!cameraActive)return false;
  const code=barcodeDigits(raw);
  if(!isValidEAN13(code)){cameraMessage("Barcode check digit could not be verified. Hold the camera steady.");return false}
  if(isReserved(code)){cameraMessage("This barcode belongs to the protected meat catalog. Use Production Scanner.");return false}
  $("customBarcode").value=code;
  closeCamera();
  status("customFormStatus","Captured "+code+". Enter the item details and save to the database.");
  void lookupSaved(code);
  $("customProductName").focus();
  return true;
}
async function nativeCameraLoop(id){
  if(!cameraActive||id!==cameraToken)return;
  try{
    if(video.readyState>=2){
      const results=await detector.detect(video);
      if(!cameraActive||id!==cameraToken)return;
      for(const result of results){if(capturedBarcode(result.rawValue))return}
    }
  }catch(_){cameraMessage("Trying to read the barcode. Hold the label steady.")}
  if(cameraActive&&id===cameraToken)cameraTimer=setTimeout(()=>void nativeCameraLoop(id),170);
}
async function loadZxing(){
  if(window.ZXing?.BrowserMultiFormatReader)return window.ZXing;
  if(!legacyLoader){
    legacyLoader=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
      script.onload=()=>window.ZXing?.BrowserMultiFormatReader?resolve(window.ZXing):
        reject(new Error("Fallback scanner failed to initialize"));
      script.onerror=()=>reject(new Error("Could not download the fallback scanner"));
      document.head.append(script);
    }).catch(error=>{legacyLoader=null;throw error});
  }
  return legacyLoader;
}
async function openCamera(){
  if(cameraActive)return;
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){
    status("customFormStatus","Live scanning needs HTTPS and camera permission. You can type the 13-digit barcode.",true);return;
  }
  cameraActive=true;
  const id=++cameraToken;
  if(cameraDialog.showModal)cameraDialog.showModal();else cameraDialog.setAttribute("open","");
  cameraMessage("Requesting rear-camera access…");
  try{
    const stream=await navigator.mediaDevices.getUserMedia({
      audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}
    });
    if(!cameraActive||id!==cameraToken){for(const track of stream.getTracks())track.stop();return}
    videoStream=stream;video.srcObject=stream;
    await video.play();
    if(!cameraActive||id!==cameraToken)return;
    if(typeof window.BarcodeDetector==="function"){
      try{
        const formats=await window.BarcodeDetector.getSupportedFormats?.();
        if(!formats||formats.includes("ean_13")){
          detector=new window.BarcodeDetector({formats:["ean_13"]});
          cameraMessage("Point at one barcode. It will fill the form when recognized.");
          void nativeCameraLoop(id);return;
        }
      }catch(_){}
    }
    cameraMessage("Starting compatible scanner…");
    const ZXing=await loadZxing();
    if(!cameraActive||id!==cameraToken)return;
    const hints=new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS,[ZXing.BarcodeFormat.EAN_13]]]);
    legacyReader=new ZXing.BrowserMultiFormatReader(hints,180);
    cameraMessage("Position one barcode in the green frame.");
    await legacyReader.decodeFromVideoElementContinuously(video,result=>{
      if(cameraActive&&id===cameraToken&&result)capturedBarcode(result.getText());
    });
  }catch(err){
    if(!cameraActive||id!==cameraToken)return;
    stopCamera();
    cameraMessage(err?.name==="NotAllowedError"?
      "Camera permission denied. Allow access in your browser or enter the barcode manually.":
      "Cannot start camera: "+(err.message||"Unknown error")+". Use manual entry.");
  }
}
$("customUnitType").addEventListener("change",toggleUnit);
for(const id of ["customWeight","customPieces","customUnitPrice","customTotalPrice"]){
  $(id).addEventListener("input",updateEstimated);
}
$("customBarcodeForm").addEventListener("submit",e=>void saveRecord(e));
$("customReset").addEventListener("click",resetForm);
$("lookupCustomBarcode").addEventListener("click",()=>void lookupSaved($("customBarcode").value));
$("managerLoginForm").addEventListener("submit",e=>void login(e));
$("managerCreateAccount").addEventListener("click",()=>void createAccount());
$("managerSignOut").addEventListener("click",async()=>{
  if(client)await client.auth.signOut();
  setUser(null);
});
$("customRefresh").addEventListener("click",()=>void loadRecords(true));
$("customMore").addEventListener("click",()=>void loadRecords(false));
$("customSearch").addEventListener("input",()=>{
  if(searchTimer!==null)clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>void loadRecords(true),350);
});
$("scanCustomBarcode").addEventListener("click",()=>void openCamera());
$("customCloseCamera").addEventListener("click",closeCamera);
cameraDialog.addEventListener("cancel",event=>{event.preventDefault();closeCamera()});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&cameraActive)closeCamera()});
window.addEventListener("pagehide",stopCamera);
toggleUnit();drawRecords();void initAuth();
window.CustomBarcodeChecks={isValidEAN13,barcodeDigits,isReserved,optionalFils,
  filsText,validateInput,estimatedTotal,itemQuantity,safeSearch,capturedBarcode,
  isCameraActive:()=>cameraActive};
})();