const fs=require("node:fs");
const vm=require("node:vm");
const assert=require("node:assert/strict");
const code=fs.readFileSync("custom-barcodes.js","utf8");
const page=fs.readFileSync("custom-barcodes.html","utf8");
const workflow=fs.readFileSync(".github/workflows/deploy-pages.yml","utf8");
assert.ok(page.includes('id="scanCustomBarcode"'));
assert.ok(page.includes('id="customBarcode"'));
assert.ok(page.includes('id="customUnitType"'));
assert.ok(page.includes('id="customPieces"'));
assert.ok(page.includes('id="customWeight"'));
assert.ok(page.includes('id="customCameraDialog"'));
assert.ok(page.includes("Per piece (PC)"));
assert.ok(workflow.includes("custom-barcodes.js"));
assert.ok(workflow.includes("custom-barcodes.html"));
class Element{
  constructor(id){
    this.id=id;this.value="";this.hidden=false;this.disabled=false;this.textContent="";
    this.children=[];this.listeners={};this.className="";this.style={};this.open=false;
    this.videoWidth=1280;this.videoHeight=720;this.readyState=4;this.srcObject=null;
    this.classList={toggle:()=>{}};
  }
  addEventListener(name,fn){this.listeners[name]=fn}
  append(...elements){this.children.push(...elements)}
  replaceChildren(...elements){this.children=[...elements]}
  showModal(){this.open=true}
  close(){this.open=false}
  setAttribute(){}
  removeAttribute(){}
  focus(){}
  scrollIntoView(){}
  pause(){}
  async play(){}
  reset(){this.value=""}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function build({signedIn=false,cameraBarcode="4006381333931"}={}){
  const nodes=new Map(),dbRows=[],queries=[],tracks=[];
  const get=id=>{
    if(!nodes.has(id))nodes.set(id,new Element(id));
    return nodes.get(id);
  };
  get("customUnitType").value="kg";
  let user=signedIn?{id:"user-1",email:"staff@example.com"}:null;
  function dbChain(){
    const chain={
      select(){return chain},eq(){return chain},order(){return chain},range(){return chain},
      or(){return chain},ilike(){return chain},
      async maybeSingle(){return {data:null,error:null}},
      async single(){return {data:{id:"saved-1"},error:null}},
      then(resolve,reject){return Promise.resolve({data:dbRows,count:dbRows.length,error:null}).then(resolve,reject)}
    };
    return chain;
  }
  const client={
    auth:{
      async getSession(){return {data:{session:user?{user}:null},error:null}},
      onAuthStateChange(){return {}},
      async signInWithPassword(){return {data:{user},error:null}},
      async signOut(){user=null}
    },
    from(table){
      assert.equal(table,"custom_barcode_items");
      return {
        select:()=>dbChain(),
        insert(payload){queries.push({operation:"insert",payload});dbRows.push({...payload,id:"saved-1"});return dbChain()},
        update(payload){queries.push({operation:"update",payload});return dbChain()},
        delete(){queries.push({operation:"delete"});return dbChain()}
      };
    }
  };
  const stream={getTracks:()=>[{stop(){tracks.push("stopped")}}]};
  const sandbox={
    document:{
      getElementById:get,createElement:tag=>new Element(tag),
      addEventListener(){},head:{append(){}},hidden:false
    },
    window:{
      isSecureContext:true,
      supabase:{createClient:()=>client},
      BarcodeDetector:class{
        static async getSupportedFormats(){return ["ean_13"]}
        async detect(){return [{rawValue:cameraBarcode}]}
      },
      addEventListener(){}
    },
    navigator:{mediaDevices:{async getUserMedia(){return stream}}},
    Map,Promise,console,setTimeout,clearTimeout,Date,confirm:()=>true,
    location:{href:"https://example.com/custom-barcodes.html"}
  };
  vm.runInNewContext(code,sandbox,{filename:"custom-barcodes.js",timeout:2000});
  return {get,sandbox,client,dbRows,queries,tracks};
}
async function main(){
  const {sandbox,get}=build();
  const api=sandbox.window.CustomBarcodeChecks;
  assert.equal(api.isValidEAN13("4006381333931"),true);
  assert.equal(api.isValidEAN13("9158851001002"),true);
  assert.equal(api.isValidEAN13("9667777103054"),true);
  assert.equal(api.isValidEAN13("4006381333932"),false);
  assert.equal(api.isReserved("9667777103054"),true);
  assert.equal(api.isReserved("9667800031057"),true);
  assert.equal(api.isReserved("9667818036457"),true);
  assert.equal(api.isReserved("4006381333931"),false);
  assert.equal(api.optionalFils("3.105","Price"),3105);
  assert.equal(api.optionalFils("4.5","Price"),4500);
  assert.equal(api.optionalFils("","Price"),null);
  assert.throws(()=>api.optionalFils("1.1234","Price"),/3 decimal/);
  const kg=api.validateInput({barcode:"4006381333931",product_name:"Fresh fish",
    item_code:"7001",unit_type:"kg",weight:"0.505",pieces:"",
    unit_price:"4.500",total_price:"2.275",notes:"Test"});
  assert.equal(kg.weight_grams,505);assert.equal(kg.quantity_pieces,null);
  assert.equal(kg.unit_price_fils,4500);assert.equal(kg.total_price_fils,2275);
  assert.equal(api.estimatedTotal(kg),2275);
  const pcs=api.validateInput({barcode:"9158851001002",product_name:"Vegetable leaves",
    unit_type:"pcs",weight:"",pieces:"3",unit_price:"0.100",
    total_price:"0.300",notes:""});
  assert.equal(pcs.weight_grams,null);assert.equal(pcs.quantity_pieces,3);
  assert.equal(api.estimatedTotal(pcs),300);
  assert.throws(()=>api.validateInput({...kg,weight:"0.503"}),/0.005 kg/);
  assert.throws(()=>api.validateInput({...pcs,pieces:"2.5"}),/number of pieces/);
  assert.throws(()=>api.validateInput({...kg,barcode:"9667777103054"}),/protected/);
  assert.throws(()=>api.validateInput({...kg,barcode:"4006381333932"}),/correct check digit/);
  await tick(); // Supabase session lookup is asynchronous
  assert.equal(get("customSave").disabled,true,"Cannot save to DB without account");
  // Scanning only fills the barcode field and never persists an unreviewed item.
  get("scanCustomBarcode").listeners.click();
  await tick();await tick();await tick();
  assert.equal(get("customBarcode").value,"4006381333931");
  assert.equal(get("customCameraDialog").open,false);
  const {sandbox:sb2,get:g2,queries,tracks}=build({signedIn:true});
  await tick();await tick();
  g2("scanCustomBarcode").listeners.click();
  await tick();await tick();await tick();
  assert.equal(g2("customBarcode").value,"4006381333931");
  assert.equal(tracks.length,1);
  assert.equal(queries.length,0,"Scanning cannot silently write to Supabase");
  const a=g2;
  a("customProductName").value="Fresh fish";
  a("customItemCode").value="7001";
  a("customUnitType").value="kg";
  a("customWeight").value="0.505";
  a("customUnitPrice").value="4.500";
  a("customTotalPrice").value="2.275";
  await a("customBarcodeForm").listeners.submit({preventDefault(){}});
  await tick();await tick();
  assert.equal(queries.length,1);
  assert.equal(queries[0].operation,"insert");
  assert.equal(queries[0].payload.owner_id,"user-1");
  assert.equal(queries[0].payload.barcode,"4006381333931");
  assert.equal(queries[0].payload.weight_grams,505);
  assert.equal(queries[0].payload.total_price_fils,2275);
  console.log("Custom catalog tests passed: protected EAN, kg 5g increments, PC integers, one-shot scan, login and explicit save.");
}
main().catch(err=>{console.error(err);process.exitCode=1});
