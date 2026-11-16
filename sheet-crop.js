/* Local full-resolution sheet inspector with rotatable crop and multi-area scanning.
   The original image remains on the device. No uploading or automatic saving. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.SheetCropEditor=api;
})(typeof window!=="undefined"?window:null,function(){
"use strict";
const FULL={x:0,y:0,w:1,h:1};
const clamp=(x,min,max)=>Math.max(min,Math.min(max,Number.isFinite(Number(x))?Number(x):min));
function normalRect(r=FULL){
  const x=clamp(r.x,0,.995),y=clamp(r.y,0,.995);
  const w=clamp(r.w,.01,1),h=clamp(r.h,.01,1);
  return {x,y,w:Math.min(1-x,w),h:Math.min(1-y,h)};
}
function mapRect(r,base=FULL){
  const a=normalRect(r),b=normalRect(base);
  return normalRect({x:b.x+a.x*b.w,y:b.y+a.y*b.h,w:a.w*b.w,h:a.h*b.h});
}
function turnsOf(n){return ((Math.trunc(Number(n)||0)%4)+4)%4}
// Clockwise quarter turns, in normalized image coordinates. Rotated images
// have swapped pixel dimensions for 90° and 270°; normalized math handles that.
function rotateRect(region,turns=0){
  const r=normalRect(region),t=turnsOf(turns);
  if(t===1)return normalRect({x:1-r.y-r.h,y:r.x,w:r.h,h:r.w});
  if(t===2)return normalRect({x:1-r.x-r.w,y:1-r.y-r.h,w:r.w,h:r.h});
  if(t===3)return normalRect({x:r.y,y:1-r.x-r.w,w:r.h,h:r.w});
  return r;
}
function unrotateRect(region,turns=0){
  return rotateRect(region,4-turnsOf(turns));
}
// A scanner reports normalized rectangles in the pixels it was given.
// Re-map back to the ORIGINAL unrotated photo, even for a rotated manual crop.
function mapScanRect(local,meta={}){
  const t=turnsOf(meta.rotation||0);
  const base=meta.rotatedRect||rotateRect(meta.rect||FULL,t);
  return unrotateRect(mapRect(local,base),t);
}
function barcodeRegion(r,width,height){
  if(!r||!(width>0&&height>0))return normalRect({x:.2,y:.2,w:.6,h:.6});
  const x=Number(r.x)||0,y=Number(r.y)||0;
  const bw=Math.max(24,Number(r.w)||24),bh=Math.max(8,Number(r.h)||8);
  const unit=Math.max(bw,bh),vertical=bh>bw*1.2;
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
function paintOriented(ctx,image,sourceWidth,sourceHeight,turns,scale=1){
  const t=turnsOf(turns),w=sourceWidth*scale,h=sourceHeight*scale;
  if(t===1){ctx.translate(h,0);ctx.rotate(Math.PI/2)}
  if(t===2){ctx.translate(w,h);ctx.rotate(Math.PI)}
  if(t===3){ctx.translate(0,w);ctx.rotate(-Math.PI/2)}
  ctx.drawImage(image,0,0,sourceWidth,sourceHeight,0,0,w,h);
}
function open({source,title="Inspect original sheet",initialRegion=null,
  barcodeRegion:marker=null,details="",allowWhole=false,
  cropLabel="Use crop and rescan"}={}){
  return new Promise(async(resolve)=>{
    if(!source||typeof document==="undefined"){resolve(null);return}
    const ownUrl=typeof source!=="string";
    const originalUrl=ownUrl?URL.createObjectURL(source):source;
    const dialog=element("dialog","sheet-editor-dialog");
    const head=element("div","sheet-editor-head"),heading=element("h2","",title);
    const closeBtn=element("button","mini","Cancel");
    closeBtn.type="button";head.append(heading,closeBtn);
    const instructions=element("p","sheet-editor-description",
      "The green box selects one label OR an area containing several labels. Drag to redraw, move or resize. Rotate the photo to make sideways stickers readable. Scan the full sheet to detect all labels.");
    const meta=element("p","sheet-editor-meta",details||"Check each barcode, weight and price before confirming.");
    const controls=element("div","sheet-editor-controls");
    const zoomLabel=element("label","","Zoom");
    const zoom=element("input");zoom.type="range";zoom.min="1";zoom.max="4";zoom.step=".25";zoom.value="1";
    const zoomValue=element("span","sheet-editor-zoom-value","1×");
    zoomLabel.append(zoom,zoomValue);
    const enhanceLabel=element("label","sheet-editor-check");
    const enhance=element("input");enhance.type="checkbox";
    enhanceLabel.append(enhance,document.createTextNode("Enhance contrast"));
    const rotateLeft=element("button","mini sheet-editor-rotate-left","↶ Rotate left");
    const rotateRight=element("button","mini sheet-editor-rotate-right","Rotate right ↷");
    const rotationValue=element("span","sheet-editor-rotation-value","0°");
    rotateLeft.type="button";rotateRight.type="button";
    const editBtn=element("button","mini sheet-editor-mode","Pan / scroll photo");
    const resetBtn=element("button","mini","Reset selection");
    editBtn.type="button";resetBtn.type="button";
    controls.append(zoomLabel,enhanceLabel,rotateLeft,rotateRight,rotationValue,editBtn,resetBtn);
    const scroll=element("div","sheet-editor-scroll");
    const stage=element("div","sheet-editor-stage"),img=element("img","sheet-editor-image");
    img.alt="Photo with green selected area and visible barcode detection marker";
    const queuedLayer=element("div","sheet-editor-queued-layer");
    const regionEl=element("div","sheet-editor-region");
    regionEl.setAttribute("aria-label","Selected area for scanning");
    const handle=element("div","sheet-editor-handle");handle.dataset.handle="resize";
    const markerEl=element("div","sheet-editor-barcode");
    markerEl.title="Original barcode detection position";
    regionEl.append(handle);
    stage.append(img,queuedLayer,regionEl,markerEl);scroll.append(stage);
    const hint=element("p","sheet-editor-hint",
      "Select the entire sticker, including weight, barcode and total. You can also select several stickers together.");
    const result=element("p","sheet-editor-error");result.hidden=true;
    result.setAttribute("role","status");
    const footer=element("div","sheet-editor-actions");
    const use=element("button","btn",cropLabel);
    use.type="button";
    let addArea=null,scanAreas=null,undoArea=null,countText=null;
    if(allowWhole){
      const full=element("button","btn btn-light","Scan full sheet (all labels)");
      full.type="button";
      full.addEventListener("click",()=>void completeFull());
      footer.append(full);
      const areaTools=element("div","sheet-editor-area-tools");
      addArea=element("button","mini","Add area for multi-scan");
      undoArea=element("button","mini","Undo last area");
      scanAreas=element("button","btn btn-light","Scan selected areas");
      countText=element("span","sheet-editor-areas-count","0 areas selected");
      addArea.type=undoArea.type=scanAreas.type="button";
      undoArea.disabled=true;scanAreas.disabled=true;
      addArea.addEventListener("click",queueArea);
      undoArea.addEventListener("click",()=>{areas.pop();render()});
      scanAreas.addEventListener("click",()=>void completeAreas());
      areaTools.append(addArea,undoArea,countText,scanAreas);
      footer.append(areaTools);
    }
    footer.append(use);
    dialog.append(head,instructions,meta,controls,scroll,hint,result,footer);
    document.body.append(dialog);

    let finished=false,editing=true,dragging=null,rect=normalRect(initialRegion||{x:.20,y:.19,w:.60,h:.55});
    let imageWidth=0,imageHeight=0,baseWidth=0,turn=0,orientationBusy=false;
    let previewToken=0,previewUrl="",originalImage=null;
    const areas=[];
    function finish(value){
      if(finished)return;
      finished=true;previewToken++;
      if(dialog.open)dialog.close();
      dialog.remove();
      if(previewUrl)URL.revokeObjectURL(previewUrl);
      if(ownUrl)URL.revokeObjectURL(originalUrl);
      resolve(value);
    }
    closeBtn.addEventListener("click",()=>finish(null));
    dialog.addEventListener("cancel",event=>{event.preventDefault();finish(null)});
    img.addEventListener("dragstart",e=>e.preventDefault());
    function setBoxStyle(el,box){
      el.style.left=(box.x*100)+"%";
      el.style.top=(box.y*100)+"%";
      el.style.width=(box.w*100)+"%";
      el.style.height=(box.h*100)+"%";
    }
    function render(){
      setBoxStyle(regionEl,rect);
      if(marker){
        setBoxStyle(markerEl,rotateRect(marker,turn));
        markerEl.hidden=false;
      }else markerEl.hidden=true;
      queuedLayer.replaceChildren();
      for(const [index,area] of areas.entries()){
        const box=element("div","sheet-editor-queued-area");
        box.textContent=String(index+1);
        setBoxStyle(box,rotateRect(area.rect,turn));
        queuedLayer.append(box);
      }
      if(countText)countText.textContent=areas.length+
        (areas.length===1?" area selected":" areas selected")+" (max 20)";
      if(undoArea)undoArea.disabled=!areas.length||orientationBusy;
      if(scanAreas)scanAreas.disabled=!areas.length||orientationBusy;
      if(addArea)addArea.disabled=areas.length>=20||orientationBusy;
      use.disabled=orientationBusy;
      rotationValue.textContent=(turn*90)+"°";
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
        "Drag to select one or several labels, move the green box, or resize its corner handle.":
        "Scroll around the zoomed photo. Tap Adjust crop to change the green box.";
    }
    zoom.addEventListener("input",zoomStage);
    enhance.addEventListener("change",preview);
    editBtn.addEventListener("click",()=>editMode(!editing));
    resetBtn.addEventListener("click",()=>{
      rect=rotateRect(normalRect(initialRegion||{x:.20,y:.19,w:.60,h:.55}),turn);
      render();
    });
    function at(event){
      const bounds=img.getBoundingClientRect();
      return {x:clamp((event.clientX-bounds.left)/Math.max(1,bounds.width),0,1),
        y:clamp((event.clientY-bounds.top)/Math.max(1,bounds.height),0,1)};
    }
    stage.addEventListener("pointerdown",event=>{
      if(!editing||orientationBusy||!imageWidth||event.button>0)return;
      const point=at(event),resizing=event.target.dataset?.handle==="resize";
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
    function error(message){result.hidden=false;result.textContent=message}
    function checkArea(area){
      const r=area.rect;
      if(r.w*imageWidth<30||r.h*imageHeight<25)
        throw Error("The selected area is too small. Include the complete label.");
    }
    function selection(){
      const r=normalRect(rect);
      const originalRect=unrotateRect(r,turn);
      const value={rect:originalRect,rotatedRect:r,rotation:turn};
      checkArea(value);
      return value;
    }
    // Crops ALWAYS use pixels from the untouched original photo. The rotated
    // preview is for editing only and never limits OCR resolution.
    async function imageFile(area,label){
      const original=normalRect(area.rect);
      const t=turnsOf(area.rotation);
      const sx=Math.floor(original.x*imageWidth),sy=Math.floor(original.y*imageHeight);
      const sw=Math.max(1,Math.min(imageWidth-sx,Math.ceil(original.w*imageWidth)));
      const sh=Math.max(1,Math.min(imageHeight-sy,Math.ceil(original.h*imageHeight)));
      const scale=Math.min(1,3600/Math.max(sw,sh));
      const outWidth=Math.max(1,Math.round(sw*scale));
      const outHeight=Math.max(1,Math.round(sh*scale));
      const canvas=document.createElement("canvas");
      canvas.width=t%2?outHeight:outWidth;
      canvas.height=t%2?outWidth:outHeight;
      const ctx=canvas.getContext("2d");
      if(!ctx)throw Error("Canvas is unavailable on this device.");
      ctx.imageSmoothingQuality="high";
      if(enhance.checked)ctx.filter="contrast(1.28) brightness(1.06)";
      ctx.save();
      if(t===1){ctx.translate(canvas.width,0);ctx.rotate(Math.PI/2)}
      if(t===2){ctx.translate(canvas.width,canvas.height);ctx.rotate(Math.PI)}
      if(t===3){ctx.translate(0,canvas.height);ctx.rotate(-Math.PI/2)}
      ctx.drawImage(originalImage,sx,sy,sw,sh,0,0,outWidth,outHeight);
      ctx.restore();
      const blob=await new Promise(yes=>canvas.toBlob(yes,"image/png"));
      canvas.width=canvas.height=1;
      if(!blob)throw Error("Could not produce the rotated crop.");
      const base=typeof source==="string"?"original-photo":(source.name||"sheet");
      const name=base.replace(/\.[^.]+$/,"")+"-"+label+"-rot"+(t*90)+".png";
      return new File([blob],name,{type:"image/png"});
    }
    async function completeArea(area){
      const file=await imageFile(area,"manual-crop");
      return {...area,file};
    }
    async function completeFull(){
      if(finished||orientationBusy)return;
      if(turn===0){
        finish({mode:"full",file:source,rect:{...FULL},rotatedRect:{...FULL},rotation:0});
        return;
      }
      use.disabled=true;result.hidden=true;
      try{
        const file=await imageFile({rect:FULL,rotatedRect:FULL,rotation:turn},"full-sheet");
        if(finished)return;
        finish({mode:"full",file,rect:{...FULL},rotatedRect:{...FULL},rotation:turn});
      }catch(e){error("Could not rotate full sheet: "+e.message);render()}
    }
    async function completeAreas(){
      if(finished||orientationBusy||!areas.length)return;
      if(scanAreas)scanAreas.disabled=true;
      use.disabled=true;result.hidden=true;
      try{
        const crops=[];
        for(let index=0;index<areas.length;index++){
          const area=areas[index];
          const file=await imageFile(area,"selected-"+(index+1));
          crops.push({...area,file});
        }
        if(finished)return;
        finish({mode:"multi",crops});
      }catch(e){error("Could not prepare selected areas: "+e.message);render()}
    }
    function queueArea(){
      if(finished||orientationBusy||areas.length>=20)return;
      try{
        const {rect:originalRect,rotation}=selection();
        areas.push({rect:originalRect,rotatedRect:rotateRect(originalRect,rotation),rotation});
        result.hidden=true;render();
      }catch(e){error(e.message)}
    }
    use.addEventListener("click",async()=>{
      if(finished||orientationBusy)return;
      let area;
      try{area=selection()}catch(e){error(e.message);return}
      result.hidden=true;
      use.disabled=true;use.textContent="Preparing original-resolution crop…";
      try{const value=await completeArea(area);if(!finished)finish({mode:"crop",...value,enhanced:enhance.checked,
        originalWidth:imageWidth,originalHeight:imageHeight})}
      catch(e){error("Cropping failed: "+e.message);use.textContent=cropLabel;render()}
    });
    async function drawPreview(t){
      if(t===0){
        const prior=previewUrl;
        img.src=originalUrl;await img.decode();
        if(prior)URL.revokeObjectURL(prior);
        previewUrl="";
        return;
      }
      const factor=Math.min(1,2400/Math.max(imageWidth,imageHeight));
      const w=Math.max(1,Math.round(imageWidth*factor)),h=Math.max(1,Math.round(imageHeight*factor));
      const c=document.createElement("canvas");
      c.width=t%2?h:w;c.height=t%2?w:h;
      const ctx=c.getContext("2d");
      ctx.imageSmoothingQuality="high";
      paintOriented(ctx,originalImage,imageWidth,imageHeight,t,factor);
      const blob=await new Promise(yes=>c.toBlob(yes,"image/jpeg",.92));
      c.width=c.height=1;
      if(!blob)throw Error("Unable to preview rotated photo.");
      const previous=previewUrl;
      previewUrl=URL.createObjectURL(blob);
      img.src=previewUrl;await img.decode();
      if(previous)URL.revokeObjectURL(previous);
    }
    async function rotateBy(delta){
      if(finished||orientationBusy||!imageWidth)return;
      const previous=turn,next=turnsOf(turn+delta);
      orientationBusy=true;dragging=null;
      rotateLeft.disabled=rotateRight.disabled=true;render();
      try{
        await drawPreview(next);
        if(finished)return;
        rect=rotateRect(rect,delta);
        turn=next;
        scroll.scrollTop=0;scroll.scrollLeft=0;
        zoomStage();preview();
        result.hidden=true;
      }catch(err){
        error("Rotation failed: "+err.message);
        // Restore the original preview rather than leaving selection misaligned.
        try{await drawPreview(previous)}catch(_){}
      }finally{
        orientationBusy=false;
        rotateLeft.disabled=rotateRight.disabled=false;
        if(!finished)render();
      }
    }
    rotateLeft.addEventListener("click",()=>void rotateBy(-1));
    rotateRight.addEventListener("click",()=>void rotateBy(1));
    try{
      originalImage=document.createElement("img");
      originalImage.src=originalUrl;
      if(originalImage.decode)await originalImage.decode();
      else await new Promise((yes,no)=>{originalImage.onload=yes;originalImage.onerror=no});
      if(finished)return;
      imageWidth=originalImage.naturalWidth||originalImage.width;
      imageHeight=originalImage.naturalHeight||originalImage.height;
      if(!imageWidth||!imageHeight)throw Error("The source photo has no readable pixels.");
      img.src=originalUrl;
      if(img.decode)await img.decode();
      if(finished)return;
      if(dialog.showModal)dialog.showModal();else dialog.setAttribute("open","");
      baseWidth=Math.min(900,Math.max(260,scroll.clientWidth-4));
      zoomStage();preview();editMode(true);render();
    }catch(err){
      finish(null);
    }
  });
}
return {open,normalRect,mapRect,barcodeRegion,rotateRect,unrotateRect,mapScanRect};
});