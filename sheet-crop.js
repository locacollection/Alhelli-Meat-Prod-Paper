/* Reusable, on-device sheet inspector and manual cropping tool.
   The original image remains on the device. No network requests or auto-saving. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.SheetCropEditor=api;
})(typeof window!=="undefined"?window:null,function(){
"use strict";
const FULL={x:0,y:0,w:1,h:1};
const clamp=(x,min,max)=>Math.max(min,Math.min(max,Number.isFinite(Number(x))?Number(x):min));
function normalRect(r=FULL){
  let x=clamp(r.x,0,.995),y=clamp(r.y,0,.995);
  let w=clamp(r.w,.01,1),h=clamp(r.h,.01,1);
  return {x,y,w:Math.min(1-x,w),h:Math.min(1-y,h)};
}
function mapRect(rect,base=FULL){
  const a=normalRect(rect),b=normalRect(base);
  return normalRect({x:b.x+a.x*b.w,y:b.y+a.y*b.h,w:a.w*b.w,h:a.h*b.h});
}
function barcodeRegion(r,width,height){
  if(!r||!(width>0&&height>0))return normalRect({x:.2,y:.2,w:.6,h:.6});
  const x=Number(r.x)||0,y=Number(r.y)||0;
  const bw=Math.max(24,Number(r.w)||24),bh=Math.max(8,Number(r.h)||8);
  const unit=Math.max(bw,bh);
  const vertical=bh>bw*1.2;
  const box=vertical?
    {x:x-unit*.92,y:y-unit*.48,w:unit*2.8,h:unit*1.6}:
    {x:x-unit*.47,y:y-unit*1.55,w:unit*3.08,h:unit*1.80};
  return normalRect({x:box.x/width,y:box.y/height,w:box.w/width,h:box.h/height});
}
const element=(tag,cls,text)=>{
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(text!==undefined)n.textContent=String(text);
  return n;
};
function open({source,title="Inspect original sheet",initialRegion=null,
   barcodeRegion:marker=null,details="",allowWhole=false,
   cropLabel="Use crop and rescan"}={}){
  return new Promise(async(resolve)=>{
    if(!source||typeof document==="undefined"){resolve(null);return}
    const ownUrl=typeof source!=="string";
    const url=ownUrl?URL.createObjectURL(source):source;
    const dialog=element("dialog","sheet-editor-dialog");
    const head=element("div","sheet-editor-head");
    const heading=element("h2","",title);
    const closeBtn=element("button","mini","Cancel");
    closeBtn.type="button";head.append(heading,closeBtn);
    const text=element("p","sheet-editor-description",
      "The green box marks the detected label. Drag anywhere to redraw it; drag inside to move it. Use the corner handle to resize. Zoom displays the ORIGINAL photo pixels.");
    const meta=element("p","sheet-editor-meta",details||"Check the barcode, weight and price on this sheet before confirming.");
    const controls=element("div","sheet-editor-controls");
    const zoomLabel=element("label","","Zoom");
    const zoom=element("input");zoom.type="range";zoom.min="1";zoom.max="4";zoom.step=".25";zoom.value="1";
    const zoomValue=element("span","sheet-editor-zoom-value","1×");
    zoomLabel.append(zoom,zoomValue);
    const enhanceLabel=element("label","sheet-editor-check");
    const enhance=element("input");enhance.type="checkbox";
    enhanceLabel.append(enhance,document.createTextNode("Enhance contrast"));
    const editBtn=element("button","mini sheet-editor-mode","Adjust crop");editBtn.type="button";
    const resetBtn=element("button","mini","Reset selection");resetBtn.type="button";
    controls.append(zoomLabel,enhanceLabel,editBtn,resetBtn);
    const scroll=element("div","sheet-editor-scroll");
    const stage=element("div","sheet-editor-stage");
    const img=element("img","sheet-editor-image");
    img.alt="Original full-resolution sheet with highlighted label";
    const regionEl=element("div","sheet-editor-region");
    regionEl.setAttribute("aria-label","Selected label crop");
    const handle=element("div","sheet-editor-handle");handle.dataset.handle="resize";
    const markerEl=element("div","sheet-editor-barcode");
    markerEl.title="Original barcode detection position";
    regionEl.append(handle);
    stage.append(img,regionEl,markerEl);scroll.append(stage);
    const hint=element("p","sheet-editor-hint","Drag to select the whole sticker, including weight, barcode and total price. Avoid neighboring labels.");
    const result=element("p","sheet-editor-error");result.hidden=true;result.setAttribute("role","status");
    const footer=element("div","sheet-editor-actions");
    const use=element("button","btn",cropLabel);use.type="button";
    if(allowWhole){
      const full=element("button","btn btn-light","Scan full sheet");
      full.type="button";
      full.addEventListener("click",()=>finish({mode:"full",file:source,rect:FULL,enhanced:false}));
      footer.append(full);
    }
    footer.append(use);
    dialog.append(head,text,meta,controls,scroll,hint,result,footer);
    document.body.append(dialog);
    let finished=false,editing=true,dragging=null,rect=normalRect(initialRegion||{x:.20,y:.19,w:.60,h:.55});
    let imageWidth=0,imageHeight=0,baseWidth=0;
    function finish(value){
      if(finished)return;
      finished=true;
      if(dialog.open)dialog.close();
      dialog.remove();
      if(ownUrl)URL.revokeObjectURL(url);
      resolve(value);
    }
    closeBtn.addEventListener("click",()=>finish(null));
    dialog.addEventListener("cancel",event=>{event.preventDefault();finish(null)});
    img.addEventListener("dragstart",e=>e.preventDefault());
    function render(){
      regionEl.style.left=(rect.x*100)+"%";
      regionEl.style.top=(rect.y*100)+"%";
      regionEl.style.width=(rect.w*100)+"%";
      regionEl.style.height=(rect.h*100)+"%";
      if(marker){
        const m=normalRect(marker);
        markerEl.style.left=(m.x*100)+"%";
        markerEl.style.top=(m.y*100)+"%";
        markerEl.style.width=(m.w*100)+"%";
        markerEl.style.height=(m.h*100)+"%";
        markerEl.hidden=false;
      }else markerEl.hidden=true;
    }
    function zoomStage(){
      const factor=Number(zoom.value)||1;
      stage.style.width=Math.max(210,Math.round(baseWidth*factor))+"px";
      zoomValue.textContent=factor.toFixed(factor%1?2:0)+"×";
    }
    function preview(){
      img.style.filter=enhance.checked?"contrast(1.28) brightness(1.06) saturate(.82)":"none";
    }
    function editMode(on){
      editing=on;
      stage.style.touchAction=on?"none":"auto";
      stage.style.cursor=on?"crosshair":"grab";
      editBtn.textContent=on?"Pan / scroll photo":"Adjust crop";
      hint.textContent=on?
        "Drag on the photo to draw a new crop, inside the green box to move it, or its corner handle to resize.":
        "Scroll or pan around the zoomed photo. Tap Adjust crop to change the green box.";
    }
    zoom.addEventListener("input",zoomStage);
    enhance.addEventListener("change",preview);
    editBtn.addEventListener("click",()=>editMode(!editing));
    resetBtn.addEventListener("click",()=>{rect=normalRect(initialRegion||{x:.20,y:.19,w:.60,h:.55});render()});
    function at(event){
      const bounds=img.getBoundingClientRect();
      return {x:clamp((event.clientX-bounds.left)/Math.max(1,bounds.width),0,1),
        y:clamp((event.clientY-bounds.top)/Math.max(1,bounds.height),0,1)};
    }
    stage.addEventListener("pointerdown",event=>{
      if(!editing||!imageWidth||event.button>0)return;
      const point=at(event);
      const resizing=event.target.dataset?.handle==="resize";
      const moving=event.target===regionEl||event.target.closest?.(".sheet-editor-region");
      const mode=resizing?"resize":moving?"move":"draw";
      dragging={mode,start:point,previous:{...rect},pointer:event.pointerId};
      if(mode==="draw")rect={x:point.x,y:point.y,w:.01,h:.01};
      stage.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      render();
    });
    stage.addEventListener("pointermove",event=>{
      if(!dragging||event.pointerId!==dragging.pointer)return;
      const p=at(event),prev=dragging.previous;
      if(dragging.mode==="move"){
        rect=normalRect({x:clamp(prev.x+p.x-dragging.start.x,0,1-prev.w),
          y:clamp(prev.y+p.y-dragging.start.y,0,1-prev.h),w:prev.w,h:prev.h});
      }else if(dragging.mode==="resize"){
        rect=normalRect({x:prev.x,y:prev.y,w:p.x-prev.x,h:p.y-prev.y});
      }else{
        rect=normalRect({x:Math.min(p.x,dragging.start.x),
          y:Math.min(p.y,dragging.start.y),
          w:Math.max(.01,Math.abs(p.x-dragging.start.x)),
          h:Math.max(.01,Math.abs(p.y-dragging.start.y))});
      }
      render();event.preventDefault();
    });
    for(const name of ["pointerup","pointercancel","lostpointercapture"])
      stage.addEventListener(name,()=>{dragging=null});
    use.addEventListener("click",async()=>{
      if(finished)return;
      result.hidden=true;
      if(rect.w*imageWidth<30||rect.h*imageHeight<25){
        result.hidden=false;result.textContent="The crop is too small. Include the complete label.";return;
      }
      use.disabled=true;use.textContent="Preparing original-resolution crop…";
      try{
        const sx=Math.floor(rect.x*imageWidth),sy=Math.floor(rect.y*imageHeight);
        const sw=Math.max(1,Math.min(imageWidth-sx,Math.ceil(rect.w*imageWidth)));
        const sh=Math.max(1,Math.min(imageHeight-sy,Math.ceil(rect.h*imageHeight)));
        // Preserve original photo detail, but cap huge canvases for mobile memory.
        const scale=Math.min(1,3600/Math.max(sw,sh));
        const canvas=document.createElement("canvas");
        canvas.width=Math.max(1,Math.round(sw*scale));
        canvas.height=Math.max(1,Math.round(sh*scale));
        const ctx=canvas.getContext("2d");
        ctx.imageSmoothingQuality="high";
        if(enhance.checked)ctx.filter="contrast(1.28) brightness(1.06)";
        ctx.drawImage(img,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
        ctx.filter="none";
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
        if(!blob)throw Error("Could not create the cropped image.");
        const base=typeof source==="string"?"label.png":(source.name||"label.png");
        const file=new File([blob],base.replace(/\.[^.]+$/,"")+"-manual-crop.png",{type:"image/png"});
        finish({mode:"crop",file,rect:{...rect},enhanced:enhance.checked,
          originalWidth:imageWidth,originalHeight:imageHeight});
      }catch(err){
        result.textContent="Cropping failed: "+(err?.message||err);
        result.hidden=false;use.disabled=false;use.textContent=cropLabel;
      }
    });
    try{
      img.src=url;
      if(img.decode)await img.decode();
      else await new Promise((yes,no)=>{img.onload=yes;img.onerror=no});
      if(finished)return;
      imageWidth=img.naturalWidth||img.width;imageHeight=img.naturalHeight||img.height;
      if(!imageWidth||!imageHeight)throw Error("The original image has no readable pixels.");
      if(dialog.showModal)dialog.showModal();else dialog.setAttribute("open","");
      baseWidth=Math.min(900,Math.max(260,scroll.clientWidth-4));
      zoomStage();preview();editMode(true);render();
    }catch(err){
      finish(null);
    }
  });
}
return {open,normalRect,mapRect,barcodeRegion};
});
