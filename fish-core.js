/* Salmon production calculation: exact 2 g increments, no inferred EAN weight.
   EAN-13 product mapping is intentionally not guessed without real fish labels. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.FishProductionCore=api;
})(typeof window!=="undefined"?window:null,function(){
  "use strict";
  const PRODUCT={
    "6376":"Atlantic Salmon Fish",
    "6668":"Salmon Fillet Fish (With Skin)",
    "7144":"Salmon Fish Bone"
  };
  const allowed=Object.keys(PRODUCT);
  const MAX_GRAMS=100000;
  const fmtKg=x=>(x/1000).toFixed(3);
  const fmtBD=x=>(x/1000).toFixed(3);
  function parseDecimal(raw,scale=1000){
    const input=String(raw??"").trim().replace(",",".");
    if(!/^\d{1,3}(?:\.\d{1,3})?$/.test(input))return null;
    const [w,f=""]=input.split(".");
    const amount=Number(w)*scale+Number(f.padEnd(3,"0"));
    return Number.isSafeInteger(amount)?amount:null;
  }
  function validEAN(code){
    if(!/^\d{13}$/.test(code))return false;
    let sum=0;
    for(let i=0;i<12;i++)sum+=Number(code[i])*(i%2?3:1);
    return (10-(sum%10))%10===Number(code[12]);
  }
  function validateEntry(input){
    const code=String(input.product_code||"").trim();
    if(!allowed.includes(code))return {ok:false,reason:"Select 6376, 6668, or 7144."};
    const grams=Number(input.weight_grams);
    if(!Number.isSafeInteger(grams)||grams<1||grams>MAX_GRAMS||grams%1!==0)
      return {ok:false,reason:"Fish weight must be 0.001 to 100.000 kg in 1 g increments."};
    const barcode=String(input.barcode||"").trim().replace(/\s/g,"");
    if(barcode&&!validEAN(barcode))return {ok:false,reason:"Invalid 13-digit barcode or EAN-13 check digit."};
    if(barcode&&["966777","966780","966781"].some(prefix=>barcode.startsWith(prefix)))
      return {ok:false,reason:"This belongs to the meat barcode catalog. Use Meat Production instead."};
    const unit=input.unit_price_fils,total=input.total_price_fils;
    if(unit!==null&&unit!==undefined&&(!Number.isInteger(unit)||unit<0||unit>999999))
      return {ok:false,reason:"Invalid unit price."};
    if(total!==null&&total!==undefined&&(!Number.isInteger(total)||total<0||total>999999))
      return {ok:false,reason:"Invalid total price."};
    return {ok:true,code,grams,barcode};
  }
  function calculate(entries){
    if(!Array.isArray(entries)||!entries.length)
      return {ok:false,error:"Add salmon fish labels to prepare the paper."};
    const groups=[];let current=null;
    let issue=0,fillet=0,bone=0,value=0,valueCount=0,unpriced=0;
    const errors=[];
    for(let i=0;i<entries.length;i++){
      const e=entries[i],v=validateEntry(e);
      if(!v.ok){errors.push("Label "+(i+1)+": "+v.reason);continue}
      if(e.confirmed!==true){errors.push("Label "+(i+1)+" needs confirmation.");continue}
      if(v.code==="6376"){
        current={original:e,outputs:[],issue:v.grams,fillet:0,bone:0,wastage:0,
          number:groups.length+1};
        groups.push(current);
        issue+=v.grams;
      }else{
        if(!current){
          errors.push("Label "+(i+1)+" ("+v.code+") is before its 6376 original. Reorder the labels.");
          continue;
        }
        current.outputs.push(e);
        if(v.code==="6668"){current.fillet+=v.grams;fillet+=v.grams}
        if(v.code==="7144"){current.bone+=v.grams;bone+=v.grams}
        if(Number.isInteger(e.total_price_fils)){
          value+=e.total_price_fils;valueCount++;
        }else unpriced++;
      }
    }
    for(const g of groups){
      g.wastage=g.issue-g.fillet-g.bone;
      if(g.fillet===0)errors.push("Salmon batch "+g.number+" needs a 6668 fillet label.");
      if(g.bone===0)errors.push("Salmon batch "+g.number+" needs a 7144 bone label.");
      if(g.wastage<0)errors.push("Salmon batch "+g.number+" has more output than its original 6376 weight.");
    }
    if(!groups.length)errors.push("Add the original 6376 salmon weight first.");
    const wastage=issue-fillet-bone;
    return {ok:errors.length===0,error:errors[0]||"",errors,groups,issue,fillet,bone,wastage,
      value_fils:value,priced_outputs:valueCount,unpriced_outputs:unpriced};
  }
  function snapshot(entries,meta){
    const totals=calculate(entries);
    if(!totals.ok)throw new Error(totals.error);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(meta.production_date||""))
      throw new Error("Select a production date.");
    if(entries.length>500)throw new Error("Maximum 500 labels per paper.");
    const labels=entries.map(e=>{
      const valid=validateEntry(e);
      if(!valid.ok||!e.confirmed)throw new Error("All fish labels must be confirmed.");
      return {product_code:valid.code,barcode:valid.barcode,
        weight_grams:valid.grams,unit_price_fils:e.unit_price_fils??null,
        total_price_fils:e.total_price_fils??null};
    });
    return {production_date:meta.production_date,
      plant:String(meta.plant||"Seef Arad / Fish").trim().slice(0,90),
      staff_name:String(meta.staff_name||"").trim().slice(0,90),
      paper_reference:String(meta.paper_reference||"").trim().slice(0,80),
      issue_weight_grams:totals.issue,fillet_weight_grams:totals.fillet,
      bone_weight_grams:totals.bone,wastage_weight_grams:totals.wastage,
      output_value_fils:totals.value_fils,label_count:labels.length,label_details:labels};
  }
  return {PRODUCT,allowed,MAX_GRAMS,parseDecimal,validEAN,validateEntry,calculate,
    snapshot,fmtKg,fmtBD};
});