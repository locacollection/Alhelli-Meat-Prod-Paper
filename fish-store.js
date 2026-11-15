/* Date-based private fish papers, preview, and optional A4 PDF.
   Fish uses 2 g increment validation; meat papers remain untouched. */
(()=>{
"use strict";
const core=window.FishProductionCore,$=id=>document.getElementById(id);
const PROJECT_URL="https://tvaqcbzmzpyltbbelwbw.supabase.co";
const PUBLIC_KEY="sb_publishable_yqrAl20jwQlW4J8furYn3Q_kjQFIFrr";
const TABLE="fish_production_papers";
let client=null,user=null,busy=false,preview=null,previewSaved=false,pdfPromise=null;
function status(id,message,error=false){
  const el=$(id);el.textContent=message||"";
  el.classList.toggle("is-warning",error);
}
function openDialog(el){if(el.showModal)el.showModal();else el.setAttribute("open","")}
function closeDialog(el){if(el.open){if(el.close)el.close();else el.removeAttribute("open")}}
function make(tag,cls,value){
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(value!==undefined)el.textContent=String(value);
  return el;
}
function dateText(s){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||"");
  return m?m[3]+"/"+m[2]+"/"+m[1]:(s||"");
}
function checkedSnapshot(){
  if(!window.FishProductionApp)throw new Error("Fish production scanner is not ready.");
  return window.FishProductionApp.createSnapshot();
}
function verifySnapshot(s){
  if(!s||!Array.isArray(s.label_details))throw new Error("Missing fish label details.");
  const restored=s.label_details.map(e=>({...e,confirmed:true}));
  const regenerated=core.snapshot(restored,s);
  for(const key of ["issue_weight_grams","fillet_weight_grams","bone_weight_grams",
    "wastage_weight_grams","output_value_fils","label_count"]){
    if(regenerated[key]!==s[key])throw new Error("The saved fish paper does not balance: "+key);
  }
  return s;
}
function paperTable(title,records,count){
  const block=make("section");block.append(make("h3","",title));
  const table=make("table","fish-table");
  const head=make("thead"),tr=make("tr");
  for(const word of ["Barcode","Item Name","UOM","QTY"])tr.append(make("th","",word));
  head.append(tr);table.append(head);
  const body=make("tbody");
  for(let i=0;i<count;i++){
    const data=records[i]||["","","",""];
    const row=make("tr");
    for(const text of data)row.append(make("td","",text));
    body.append(row);
  }
  table.append(body);block.append(table);return block;
}
function previewPaper(s,fromSaved=false){
  verifySnapshot(s);
  preview=s;previewSaved=fromSaved;
  const body=$("fishPreviewContent");body.replaceChildren();
  const page=make("div","fish-paper-sheet");
  const brand=make("div","fish-paper-head");
  brand.append(make("strong","","AlHelli"),make("strong","","الحلي"));
  page.append(brand,make("h2","","Production in store form"));
  const meta=make("div","fish-paper-meta");
  for(const v of [
    "Plant: "+(s.plant||""),
    "Section: Fish",
    "Date: "+dateText(s.production_date),
    "Staff: "+(s.staff_name||"")
  ])meta.append(make("span","",v));
  page.append(meta);
  page.append(paperTable("Recipe Issue (Subcontract PO)",[
    ["6376","Atlantic Salmon Fish","kg",core.fmtKg(s.issue_weight_grams)]
  ],9));
  const grn=[];
  if(s.fillet_weight_grams)grn.push(["6668","Salmon Fillet Fish (With Skin)","kg",core.fmtKg(s.fillet_weight_grams)]);
  if(s.bone_weight_grams)grn.push(["7144","Salmon Fish Bone","kg",core.fmtKg(s.bone_weight_grams)]);
  if(s.wastage_weight_grams)grn.push(["","Wastage For Fish","kg",core.fmtKg(s.wastage_weight_grams)]);
  page.append(paperTable("Recipe GRN (Bundling)",grn,9));
  const sign=make("div","fish-paper-sign");
  sign.append(make("span","","Supervisor name: _____________________   Sig: __________"));
  sign.append(make("span","","Purchasing employee: ________________   Sig: __________"));
  sign.append(make("span","","Document reference: "+(s.paper_reference||"")));
  page.append(sign);body.append(page);
  $("fishPreviewTitle").textContent=fromSaved?
    "Saved fish production · "+dateText(s.production_date):"Fish production paper preview";
  $("fishPreviewSave").hidden=fromSaved;
  openDialog($("fishPreviewDialog"));
}
function showCurrentPreview(){
  try{previewPaper(checkedSnapshot())}
  catch(err){status("fishPaperError",err.message,true)}
}
function updateAuth(userNext){
  user=userNext||null;
  $("fishLoginForm").hidden=!!user;
  $("fishLoggedIn").hidden=!user;
  $("fishSignedInAs").textContent=user?.email||"";
  $("fishSaveDatabase").disabled=!user||busy;
  if(user)void loadHistory();
  else{
    $("fishHistory").replaceChildren();
    status("fishHistoryStatus","Sign in to view your saved fish papers.");
  }
}
function openSave(){
  let s=null;
  try{s=checkedSnapshot()}catch(_){}
  $("fishSaveSummary").textContent=s?
    dateText(s.production_date)+" · 6376: "+core.fmtKg(s.issue_weight_grams)+" kg · Fillet: "+
    core.fmtKg(s.fillet_weight_grams)+" kg · Bones: "+core.fmtKg(s.bone_weight_grams)+
    " kg · Wastage: "+core.fmtKg(s.wastage_weight_grams)+" kg":
    "Sign in to view saved papers. Complete the fish labels before saving a new one.";
  $("fishSaveDatabase").disabled=!user||!s||busy;
  status("fishSaveStatus",client?"":"Database connection is unavailable.",!client);
  closeDialog($("fishPreviewDialog"));
  openDialog($("fishSaveDialog"));
}
async function login(e){
  e.preventDefault();
  if(!client){status("fishSaveStatus","Database connection unavailable.",true);return}
  $("fishSaveStatus").textContent="Signing in…";
  try{
    const {data,error}=await client.auth.signInWithPassword({
      email:$("fishEmail").value.trim(),password:$("fishPassword").value
    });
    if(error)throw error;
    $("fishPassword").value="";
    updateAuth(data.user);status("fishSaveStatus","Signed in.");
  }catch(err){status("fishSaveStatus",err.message,true)}
}
async function savePaper(){
  if(busy)return;
  if(!client||!user){status("fishSaveStatus","Sign in to save fish production papers.",true);return}
  let s;
  try{s=verifySnapshot(checkedSnapshot())}
  catch(err){status("fishSaveStatus",err.message,true);return}
  busy=true;$("fishSaveDatabase").disabled=true;
  status("fishSaveStatus","Saving to Supabase…");
  try{
    const {error}=await client.from(TABLE)
      .insert({...s,owner_id:user.id}).select("id").single();
    if(error)throw error;
    status("fishSaveStatus","Saved successfully for "+dateText(s.production_date)+".");
    await loadHistory();
    if($("fishAlsoPDF").checked){
      try{await savePDF(s)}
      catch(err){status("fishSaveStatus","Paper saved, but PDF failed: "+err.message,true)}
    }
  }catch(err){status("fishSaveStatus","Could not save: "+err.message,true)}
  finally{busy=false;$("fishSaveDatabase").disabled=!user}
}
function pdfName(s){return "Salmon-Fish-Production-"+s.production_date+".pdf"}
async function pdfCtor(){
  if(window.jspdf?.jsPDF)return window.jspdf.jsPDF;
  if(!pdfPromise){
    pdfPromise=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js";
      script.onload=()=>window.jspdf?.jsPDF?resolve(window.jspdf.jsPDF):reject(new Error("PDF library unavailable"));
      script.onerror=()=>reject(new Error("PDF library could not load. Check internet access."));
      document.head.append(script);
    }).catch(err=>{pdfPromise=null;throw err});
  }
  return pdfPromise;
}
function pdfTable(doc,y,rows,minimum=9){
  const left=13,columns=[39,97,19,29],rowH=8.0;
  doc.setFont("helvetica","bold");doc.setFontSize(9);
  let x=left;
  ["Barcode","Item Name","UOM","QTY"].forEach((value,i)=>{
    doc.text(value,x+3,y+5.2);x+=columns[i];
  });
  for(let i=0;i<=minimum+1;i++)doc.line(left,y+rowH*i,left+184,y+rowH*i);
  x=left;
  for(let i=0;i<=columns.length;i++){doc.line(x,y,x+0,y+(minimum+1)*rowH);x+=columns[i]||0}
  doc.setFont("helvetica","normal");doc.setFontSize(9);
  for(let i=0;i<Math.min(rows.length,minimum);i++){
    let xx=left;
    for(let k=0;k<4;k++){
      doc.text(String(rows[i][k]||"").slice(0,k===1?43:25),xx+3,y+rowH*(i+1)+5.4);
      xx+=columns[k];
    }
  }
}
async function savePDF(s){
  verifySnapshot(s);
  const JsPdf=await pdfCtor();
  const doc=new JsPdf({unit:"mm",format:"a4"});
  doc.setTextColor(44,44,44);doc.setFont("helvetica","bold");doc.setFontSize(22);
  doc.text("AlHelli",13,22);
  doc.setFont("helvetica","normal");doc.setFontSize(10);
  doc.text("Mirza AlHelli and Sons B.S.C. (C)",13,29);
  doc.setFont("helvetica","bold");doc.setFontSize(15);
  doc.text("Production in store form",105,41,{align:"center"});
  doc.setFont("helvetica","normal");doc.setFontSize(10);
  doc.text("Plant: "+String(s.plant||"").slice(0,37),13,50);
  doc.text("Date: "+dateText(s.production_date),155,50);
  doc.text("Section: Fish",13,57);
  doc.text("Staff: "+String(s.staff_name||"").slice(0,40),70,57);
  doc.setFont("helvetica","bold");doc.setFontSize(12);
  doc.text("Recipe Issue (Subcontract PO)",105,67,{align:"center"});
  pdfTable(doc,71,[["6376","Atlantic Salmon Fish","kg",core.fmtKg(s.issue_weight_grams)]],10);
  doc.text("Recipe GRN (Bundling)",105,173,{align:"center"});
  const grn=[];
  if(s.fillet_weight_grams)grn.push(["6668","Salmon Fillet Fish (With Skin)","kg",core.fmtKg(s.fillet_weight_grams)]);
  if(s.bone_weight_grams)grn.push(["7144","Salmon Fish Bone","kg",core.fmtKg(s.bone_weight_grams)]);
  if(s.wastage_weight_grams)grn.push(["","Wastage For Fish","kg",core.fmtKg(s.wastage_weight_grams)]);
  pdfTable(doc,177,grn,9);
  doc.setFont("helvetica","normal");doc.setFontSize(9);
  doc.text("Supervisor: __________________________    Sig: ____________",13,270);
  doc.text("Purchasing employee: __________________    Sig: ____________",13,277);
  doc.text("Reference: "+String(s.paper_reference||"").slice(0,40),13,284);
  doc.save(pdfName(s));
}
function historyCard(row){
  const el=make("article");
  el.append(make("strong","",dateText(row.production_date)));
  el.append(make("small","",core.fmtKg(row.issue_weight_grams)+" kg original · "+
    core.fmtKg(row.fillet_weight_grams)+" kg fillet · "+core.fmtKg(row.bone_weight_grams)+
    " kg bones · "+core.fmtKg(row.wastage_weight_grams)+" kg wastage"));
  const actions=make("div");
  const previewButton=make("button","mini","Preview");previewButton.type="button";
  previewButton.addEventListener("click",()=>{try{previewPaper(row,true)}catch(e){status("fishHistoryStatus",e.message,true)}});
  const pdf=make("button","mini","PDF");pdf.type="button";
  pdf.addEventListener("click",()=>void savePDF(row).catch(e=>status("fishHistoryStatus",e.message,true)));
  actions.append(previewButton,pdf);el.append(actions);return el;
}
async function loadHistory(){
  if(!client||!user)return;
  const list=$("fishHistory");list.replaceChildren();
  status("fishHistoryStatus","Loading saved fish papers…");
  try{
    let q=client.from(TABLE).select("*").eq("owner_id",user.id)
      .order("production_date",{ascending:false}).order("created_at",{ascending:false}).limit(50);
    if($("fishHistoryDate").value)q=q.eq("production_date",$("fishHistoryDate").value);
    const {data,error}=await q;
    if(error)throw error;
    const rows=data||[];
    status("fishHistoryStatus",rows.length?rows.length+" saved paper(s)":"No saved papers for this date.");
    for(const row of rows)list.append(historyCard(row));
  }catch(err){status("fishHistoryStatus","Unable to load: "+err.message,true)}
}
async function initialize(){
  if(!window.supabase?.createClient){
    status("fishHistoryStatus","Supabase is unavailable. Check internet access.",true);return;
  }
  client=window.supabase.createClient(PROJECT_URL,PUBLIC_KEY);
  const {data,error}=await client.auth.getSession();
  if(error)status("fishHistoryStatus",error.message,true);
  updateAuth(data?.session?.user||null);
  client.auth.onAuthStateChange((_event,session)=>{
    if(session?.user?.id!==user?.id)updateAuth(session?.user||null);
  });
}
$("fishPreview").addEventListener("click",showCurrentPreview);
$("fishPreviewClose").addEventListener("click",()=>closeDialog($("fishPreviewDialog")));
$("fishPreviewSave").addEventListener("click",openSave);
$("fishSave").addEventListener("click",openSave);
$("fishAccount").addEventListener("click",openSave);
$("fishSaveClose").addEventListener("click",()=>closeDialog($("fishSaveDialog")));
$("fishLoginForm").addEventListener("submit",e=>void login(e));
$("fishSignOut").addEventListener("click",async()=>{
  if(client)await client.auth.signOut();
  updateAuth(null);
});
$("fishSaveDatabase").addEventListener("click",()=>void savePaper());
$("fishSavePDFOnly").addEventListener("click",()=>void savePDF(checkedSnapshot()).catch(e=>status("fishSaveStatus",e.message,true)));
$("fishPreviewPDF").addEventListener("click",()=>void savePDF(preview).catch(e=>status("fishHistoryStatus",e.message,true)));
$("fishHistoryDate").addEventListener("change",()=>void loadHistory());
$("fishRefreshHistory").addEventListener("click",()=>void loadHistory());
window.FishStoreChecks={verifySnapshot,dateText,pdfName,renderPaper:previewPaper};
void initialize();
})();