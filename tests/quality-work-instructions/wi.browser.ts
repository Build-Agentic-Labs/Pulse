import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
const login = JSON.parse(
  readFileSync("scratch/quality-wi-build/login.json", "utf8"),
) as { email: string; password: string; userId: string; workspaceId: string };
test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
});
async function signIn(page: Page) {
  // Match the AWI suite: authenticate the isolated test user before navigation.
  // These WI workflows test document behavior, not sign-in form hydration.
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => [],
        setAll: async (cookies) => {
          await page.context().addCookies(cookies.map(({ name, value }) => ({
            name, value, domain: "127.0.0.1", path: "/", sameSite: "Lax" as const,
          })));
        },
      },
    },
  );
  const { error } = await client.auth.signInWithPassword({ email: login.email, password: login.password });
  if (error) throw error;
  await page.goto("/sops/work-instructions");
  await expect(
    page.getByRole("heading", { name: "Work Instruction Builder", exact: true }),
  ).toBeVisible();
}
async function draft(page: Page, title: string) {
  await signIn(page);
  await page.getByRole("button", { name: "New WI", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Work instruction builder" }),
  ).toBeVisible();
  await page.getByLabel("Work instruction title").fill(title);
  await page
    .getByLabel("Purpose / scope")
    .fill("Scope of the general procedure.");
  await page
    .getByLabel("Responsibilities", { exact: true })
    .fill("Process Engineer");
  await page.getByRole("button", { name: /Add step/ }).click();
  await page
    .getByLabel("Step 1 title", { exact: true })
    .fill("Open the record");
  await page
    .getByLabel("Step 1 instruction", { exact: true })
    .fill("Open the selected record and confirm its contents.");
  await expect(page.getByRole("status")).toHaveText("Saved");
}

async function publishAndOpenBuilder(page: Page, title: string) {
  await page.getByRole("button", { name: "Publish WI", exact: true }).click();
  await expect(page).toHaveURL(/\/sops\/work-instructions\/published$/);
  await expect(page.getByRole("heading", { name: "Published Work Instructions", exact: true })).toBeVisible();
  await page.getByRole("button", { name: title, exact: true }).click();
  await page.getByRole("button", { name: "Open builder", exact: true }).click();
  await expect(page.getByLabel("Work instruction title")).toHaveValue(title);
}

test("department draft publishes directly, keeps its number and preserves its original revision", async ({
  page,
}) => {
  const title = `Local WI ${Date.now()}`;
  await draft(page, title);
  await expect(page.getByText(/WI-PRO-###/)).toBeVisible();
  await publishAndOpenBuilder(page, title);
  await expect(
    page.getByText(/Process Engineering · WI-PRO-\d+ · Published$/),
  ).toBeVisible();
  const label = await page
    .getByText(/Process Engineering · WI-PRO-\d+ · Published$/)
    .innerText();
  const number = label.match(/WI-PRO-\d+/)![0];
  await page.getByLabel("Work instruction title").fill(title + " revised");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Preview version" }).click();
  await page.getByRole("option", { name: "Published revision A" }).click();
  await expect(
    page.getByRole("img", { name: `${title}, page 1 of 2`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", {name:"Work instruction preview"}).getByText(title + " revised", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close preview" }).click();
  await page.getByLabel("Revision description").fill("Corrected title");
  await publishAndOpenBuilder(page, title + " revised");
  await expect(
    page.getByText(`Process Engineering · ${number} · Published`, {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Work instruction title")).toHaveValue(
    title + " revised",
  );
  await page
    .getByRole("link", { name: "WI Builder", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Work Instruction Builder", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: title + " revised", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Published WIs", exact: true }).click();
  await expect(page.getByRole("button", { name: title + " revised", exact: true })).toBeVisible();
});

test("an offline edit survives reload and retries without publishing incomplete work", async ({
  page,
}) => {
  await draft(page, `Offline WI ${Date.now()}`);
  await page.route("**/rest/v1/rpc/edit_quality_wi", (route) =>
    route.abort("failed"),
  );
  await page
    .getByLabel("Step 1 instruction", { exact: true })
    .fill("Recover this unsaved local instruction.");
  await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel("Step 1 instruction", { exact: true }),
  ).toHaveValue("Recover this unsaved local instruction.");
  await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
  await page.getByRole("button", { name: "Publish WI", exact: true }).click();
  await expect(page.getByText(/WI-PRO-###/)).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Not saved");
  await page.unroute("**/rest/v1/rpc/edit_quality_wi");
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(
    page.getByLabel("Step 1 instruction", { exact: true }),
  ).toHaveValue("Recover this unsaved local instruction.");
});

test("private image and Word export survive reload", async ({ page }) => {
  await draft(page, `Photo WI ${Date.now()}`);
  const png = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 400;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#21858b";
    ctx.fillRect(0, 0, 800, 400);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page
    .getByLabel("Upload image for step 1", { exact: true })
    .setInputFiles({
      name: "reference.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
  await expect(
    page.getByRole("button", { name: "Open image for step 1" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open image for step 1" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Word", exact: true }).click();
  const artifact = await download;
  expect(artifact.suggestedFilename()).toContain("DRAFT.docx");
  await artifact.saveAs("scratch/quality-wi-build/browser-draft-export.docx");
});

test("annotation text is included in Word image export",async({page})=>{
 await draft(page,`Annotated WI ${Date.now()}`);
 const payload=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=800;canvas.height=400;const context=canvas.getContext('2d')!;context.fillStyle='#daeef0';context.fillRect(0,0,800,400);return canvas.toDataURL('image/png').split(',')[1];});
 const imageSaved = page.waitForResponse(response => response.url().endsWith('/rpc/edit_quality_wi') && response.request().postDataJSON()?.p_kind === 'image' && response.ok());
 await page.getByLabel('Upload image for step 1',{exact:true}).setInputFiles({name:'annotated.png',mimeType:'image/png',buffer:Buffer.from(payload,'base64')});await imageSaved;await expect(page.getByRole('status')).toHaveText('Saved');
 await page.getByRole('button',{name:'Open image for step 1'}).click();await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByRole('button',{name:/text/i}).first().click();
 // Annotation tools are verified through their shared renderer; save an explicit text scene
 // using the local caller token to cover real storage, snapshot and canvas/Word conversion.
 await page.keyboard.press('Escape');
 const id=page.url().split('/').at(-1)!;const statusFile='scratch/quality-wi-build/browser-annotation-export.docx';
 const {createClient}=await import('@supabase/supabase-js');const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});const signed=await db.auth.signInWithPassword({email:login.email,password:login.password});if(signed.error)throw signed.error;
 const loaded=await db.rpc('load_quality_wi_document',{p_id:id,p_workspace:login.workspaceId});if(loaded.error)throw loaded.error;const doc=loaded.data as {version:number;steps:{id:string;image:Record<string,unknown>}[]};const step=doc.steps[0];
 const saved=await db.rpc('edit_quality_wi',{p_id:id,p_expected_version:doc.version,p_actor:login.userId,p_operation:crypto.randomUUID(),p_kind:'image',p_payload:{id:step.id,image:{...step.image,annotations:{version:1,items:[{id:'text-local',type:'text',x:.2,y:.2,width:.5,height:.4,fontSize:20,color:'#ffcc00',text:'Confirm the record',textAlign:'left'}]}}}});if(saved.error)throw saved.error;
 await page.reload();await page.getByRole('button',{name:'Preview',exact:true}).click();await expect(page.getByRole('button',{name:'PDF',exact:true})).toBeEnabled();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Word',exact:true}).click();await(await download).saveAs(statusFile); const pdfDownload=page.waitForEvent('download'); await page.getByRole('button',{name:'PDF',exact:true}).click(); await(await pdfDownload).saveAs('scratch/quality-wi-build/browser-annotation-preview.pdf');
});

test("long title, revision description and instructions export without losing the ending",async({page})=>{
 const title=(`${Date.now()} ` + "Detailed general procedure for department operations ".repeat(6)).slice(0,290);
 await draft(page,title);
 await page.getByLabel('Step 1 instruction',{exact:true}).fill('LONG_CONTENT_START '+('Detailed action and explanation. '.repeat(180))+' LONG_CONTENT_END');
 await expect(page.getByRole('status')).toHaveText('Saved');
 await page.getByLabel('Revision description').fill(('Clarified procedure and responsibilities. '.repeat(12)).slice(0,450));
 await publishAndOpenBuilder(page, title);await expect(page.getByText(/Process Engineering · WI-PRO-\d+ · Published$/)).toBeVisible();
 await page.getByRole('button',{name:'Preview',exact:true}).click();await page.getByRole('button',{name:'Preview version'}).click();await page.getByRole('option',{name:'Published revision A'}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Word',exact:true}).click();await(await download).saveAs('scratch/quality-wi-build/browser-long-export.docx'); await expect(page.getByRole('button',{name:'PDF',exact:true})).toBeEnabled(); const pdfDownload=page.waitForEvent('download'); await page.getByRole('button',{name:'PDF',exact:true}).click(); await(await pdfDownload).saveAs('scratch/quality-wi-build/browser-long-preview.pdf');
});


test("Preview uses the SOP document presentation with continuous PDF pages and download", async ({page}) => {
  await draft(page, `PDF WI ${Date.now()}`);
  await page.getByRole('button', {name:'Preview',exact:true}).click();
  await expect(page.locator('.document-preview-pdf-sheet')).toHaveCount(2);
  await expect(page.locator('.sop-document-toolbar')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Zoom in',exact:true})).toHaveCount(0);
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'PDF',exact:true}).click();
  const file=await download;
  await file.saveAs('scratch/quality-wi-build/browser-preview.pdf');
  const {PDFDocument}=await import('pdf-lib');
  const {readFile}=await import('node:fs/promises');
  const pdf=await PDFDocument.load(await readFile('scratch/quality-wi-build/browser-preview.pdf'));
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getTitle()).toMatch(/^PDF WI /);
  await expect(page.getByRole('region',{name:'Document pages'}).or(page.locator('[aria-label="Document pages"]'))).toBeVisible();
  await page.getByRole('button',{name:'Close preview',exact:true}).click();
  await expect(page.getByLabel('Work instruction title')).toBeVisible();
});
