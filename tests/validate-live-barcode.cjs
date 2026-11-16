const fs=require("node:fs");
const vm=require("node:vm");
const assert=require("node:assert/strict");
const script=fs.readFileSync("live-barcode.js","utf8");
const page=fs.readFileSync("index.html","utf8");
const deploy=fs.readFileSync(".github/workflows/deploy-pages.yml","utf8");
assert.ok(page.includes('id="startSingleScan"'));
assert.ok(page.includes('id="singleBarcodeDialog"'));
assert.ok(page.includes('id="singleBarcodeVideo"'));
assert.match(page,/src="live-barcode\.js\?v=historical-6777-\d+"/);
assert.ok(deploy.includes("live-barcode.js"),"Static site must deploy camera scanner file");
function env({detected="9667800031057",native=true,permissionError=null,delayPermission=false}={}){
  const elements=new Map(),events=new Map(),appended=[],added=[];
  let stopped=0,pendingPermission=null,attached=0,detectorCalls=0,zxingResets=0;
  class Element{
    constructor(id){this.id=id;this.hidden=false;this.textContent="";this.value="";this.className="";this.listeners={};this.open=false;this.style={};this.videoWidth=1280;this.videoHeight=720;this.readyState=4;this.srcObject=null;this.classList={toggle:()=>{}}}
    addEventListener(kind,fn){this.listeners[kind]=fn}
    showModal(){this.open=true}
    close(){this.open=false}
    removeAttribute(name){if(name==="open")this.open=false}
    setAttribute(){}
    pause(){}
    async play(){}
    getContext(){return {drawImage:()=>{}}}
    toBlob(callback){callback({type:"image/jpeg",size:1000})}
  }
  const get=id=>{
    if(!elements.has(id))elements.set(id,new Element(id));
    return elements.get(id);
  };
  const stream={
    getTracks:()=>[{stop:()=>{stopped++}}],
    getVideoTracks:()=>[{getCapabilities:()=>({torch:false}),stop:()=>{stopped++}}]
  };
  get("manualSource").value="normal";
  const mediaDevices={getUserMedia:()=>{
    if(permissionError)return Promise.reject(permissionError);
    if(delayPermission)return new Promise(resolve=>{pendingPermission=()=>resolve(stream)});
    return Promise.resolve(stream);
  }};
  const scanner={
    catalogFromBarcode(code){
      if(code==="9667800031057")return {ok:true,info:{code:"6780"},grams:690,price:3105,unit:4500};
      if(code==="9667770031903")return {ok:true,info:{code:"6777"},grams:1000,price:3190,unit:3190};
      return {ok:false,reason:"Ambiguous old or new rate; check printed weight"};
    },
    decode(code){
      if(code==="9667800031057")return {code:"6780",price:3105};
      if(code==="9667770031903")return {code:"6777",price:3190};
      if(code==="9667771209851")return {code:"6777",price:20985};
      return {error:"Not a supported EAN"};
    },
    insertManualEntry(code){
      if((code==="9667770031903"||code==="9667771209851")&&get("manualSource").value==="normal")
        return {error:"Choose bone-in source for 6777"};
      const entry={barcode:code};
      added.push(entry);
      return {entry};
    },
    labelCropBounds:()=>({x:100,y:100,w:340,h:240}),
    keepLabelCrop:async()=>{attached++}
  };
  const ZXing={
    DecodeHintType:{POSSIBLE_FORMATS:1},BarcodeFormat:{EAN_13:13},
    BrowserMultiFormatReader:class{
      decodeFromVideoElementContinuously(_video,callback){
        callback({getText:()=>detected},null);
        return Promise.resolve();
      }
      reset(){zxingResets++}
    }
  };
  const window={
    isSecureContext:true,
    MeatProductionChecks:scanner,
    addEventListener:(key,cb)=>events.set(key,cb),
    ZXing:native?undefined:ZXing
  };
  if(native){
    window.BarcodeDetector=class{
      static async getSupportedFormats(){return ["ean_13"]}
      async detect(){detectorCalls++;return [{rawValue:detected,boundingBox:{x:180,y:180,width:220,height:50}}]}
    };
  }
  const document={
    getElementById:get,
    createElement:tag=>new Element(tag),
    head:{append:el=>appended.push(el)},
    addEventListener:(key,cb)=>events.set(key,cb),
    hidden:false
  };
  const sandbox={window,document,navigator:{mediaDevices},Map,Promise,setTimeout,clearTimeout,console};
  vm.runInNewContext(script,sandbox,{filename:"live-barcode.js",timeout:2000});
  return {window,get,events,added,get stopped(){return stopped},get attached(){return attached},
    get detectorCalls(){return detectorCalls},get zxingResets(){return zxingResets},
    grant:()=>pendingPermission?.(),stream};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function test(){
  {
    const s=env();
    assert.equal(s.window.MeatLiveBarcodeChecks.normalizeBarcode("9667800031057"),"9667800031057");
    assert.equal(s.window.MeatLiveBarcodeChecks.normalizeBarcode("966780003105"),null);
    assert.equal(s.window.MeatLiveBarcodeChecks.normalizeBarcode("9667800031057 extra"),null);
    s.get("startSingleScan").listeners.click();
    await tick();await tick();
    assert.equal(s.added.length,1,"Exactly one label is added");
    assert.equal(s.added[0].barcode,"9667800031057");
    assert.equal(s.get("singleBarcodeDialog").open,false,"Camera closes after successful scan");
    assert.equal(s.get("singleBarcodeVideo").srcObject,null);
    assert.equal(s.stopped,1,"Video track stops after single label");
    assert.match(s.get("singleBarcodeFeedback").textContent,/0\.690 kg/);
    assert.match(s.get("singleBarcodeFeedback").textContent,/3\.105 BD/);
    assert.equal(s.window.MeatLiveBarcodeChecks.acceptSingleBarcode("9667800031057"),false,
      "No double-add after camera stops");
  }
  {
    const s=env({native:false});
    s.get("startSingleScan").listeners.click();
    await tick();await tick();
    assert.equal(s.added.length,1,"ZXing fallback still reads one EAN-13 label");
    assert.equal(s.zxingResets,1,"ZXing decode stops on success");
    assert.equal(s.stopped,1,"Fallback camera is released");
  }
  {
    const s=env({detected:"9667770031903"});
    s.get("startSingleScan").listeners.click();
    await tick();await tick();
    assert.equal(s.added.length,0,"Cannot add 6777 to normal sheet");
    assert.equal(s.window.MeatLiveBarcodeChecks.isActive(),true,"Keep reading until valid source");
    assert.match(s.get("singleBarcodeStatus").textContent,/bone-in/);
    s.get("closeSingleScan").listeners.click();
    assert.equal(s.stopped,1);
    assert.equal(s.get("singleBarcodeDialog").open,false);
  }
  {
    const s=env({detected:"9667771209851"});
    s.get("manualSource").value="bone-new";
    s.get("startSingleScan").listeners.click();
    await tick();await tick();
    assert.equal(s.added.length,1,"New-rate 6777 is retained even if barcode-only weight is ambiguous");
    assert.equal(s.added[0].barcode,"9667771209851");
    assert.match(s.get("singleBarcodeFeedback").textContent,/printed weight and unit price/);
    assert.equal(s.window.MeatLiveBarcodeChecks.isActive(),false);
  }
  {
    const s=env({permissionError:{name:"NotAllowedError"}});
    s.get("startSingleScan").listeners.click();
    await tick();await tick();
    assert.equal(s.added.length,0);
    assert.match(s.get("singleBarcodeStatus").textContent,/permission was denied/);
    assert.equal(s.window.MeatLiveBarcodeChecks.isActive(),false);
  }
  {
    const s=env({delayPermission:true});
    s.get("startSingleScan").listeners.click();
    await tick();
    s.get("closeSingleScan").listeners.click();
    s.grant();
    await tick();await tick();
    assert.equal(s.added.length,0,"Close during camera request must not add a label");
    assert.equal(s.stopped,1,"Delayed camera permission cannot leak a video stream");
  }
  console.log("Live barcode tests passed: native and ZXing one-shot capture, source rules, permission errors and camera cleanup.");
}
test().catch(error=>{console.error(error);process.exitCode=1});
