// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PhotoOverlayCropEditor } from "./photo-overlay-crop-editor";
import type { PhotoImageAnnotation } from "@/domain/photo-annotations";
const image: PhotoImageAnnotation = { type:"image",id:"test",x:0,y:0,width:400,height:300,color:"black",strokeWidth:1,sourceWidth:400,sourceHeight:300,dataUrl:"data:image/png;base64,",crop:{left:0,top:0,right:0,bottom:0} };
it("adjusts with keyboard, resets, and commits the same normalized crop contract",()=>{
 const done=vi.fn(),cancel=vi.fn(); render(<PhotoOverlayCropEditor image={image} onDone={done} onCancel={cancel}/>);
 fireEvent.keyDown(screen.getByRole("button",{name:"Resize crop e"}),{key:"ArrowLeft",shiftKey:true});
 fireEvent.click(screen.getByRole("button",{name:"Done"}));
 expect(done).toHaveBeenLastCalledWith({...image.crop,right:.1});
 fireEvent.click(screen.getByRole("button",{name:"Reset"}));
 fireEvent.click(screen.getByRole("button",{name:"Done"}));
 expect(done).toHaveBeenLastCalledWith(image.crop);
 fireEvent.keyDown(screen.getByRole("button",{name:"Done"}),{key:"Escape"});
 expect(cancel).toHaveBeenCalledOnce();
});
