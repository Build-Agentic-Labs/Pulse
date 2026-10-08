import { expect, it } from "vitest";
import PizZip from "pizzip";
import sharp from "sharp";
import { parseWiDocx } from "./parse-docx";
const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
async function docx({ rotation = 0, external = false, tracked = false } = {}) {
  const zip = new PizZip();
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="${w}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p>${tracked ? "<w:ins>" : ""}<w:r><w:t>Photograph the plate</w:t></w:r>${tracked ? "</w:ins>" : ""}<w:r><w:drawing><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill><pic:spPr><a:xfrm rot="${rotation}"/></pic:spPr></pic:pic></w:drawing></w:r></w:p></w:body></w:document>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<Relationships><Relationship Id="rId1" Target="${external ? "https://example.com/private.jpg" : "media/image1.png"}" ${external ? 'TargetMode="External"' : ""}/></Relationships>`,
  );
  zip.file(
    "word/media/image1.png",
    await sharp({
      create: { width: 80, height: 40, channels: 3, background: "red" },
    })
      .png()
      .toBuffer(),
  );
  return zip.generate({ type: "nodebuffer" });
}
it("extracts pixels and preserves Word's 270 degree image rotation", async () => {
  const p = await parseWiDocx(await docx({ rotation: 16200000 }));
  expect(p.evidence.assets[0]).toMatchObject({
    width: 40,
    height: 80,
    available: true,
  });
  expect(p.evidence.blocks[0].text).toBe("Photograph the plate");
  expect(p.images.size).toBe(1);
});
it("accounts for external images without fetching them", async () => {
  const p = await parseWiDocx(await docx({ external: true }));
  expect(p.images.size).toBe(0);
  expect(p.evidence.assets[0].available).toBe(false);
  expect(p.evidence.warnings[0]).toContain("external");
});
it("rejects tracked changes rather than silently accepting deletions", async () => {
  await expect(parseWiDocx(await docx({ tracked: true }))).rejects.toThrow(
    "tracked changes",
  );
});
it("rejects invalid archives", async () => {
  await expect(parseWiDocx(Buffer.from("not a docx"))).rejects.toThrow(
    "not a readable DOCX",
  );
});
it("rejects XML entities before parsing", async () => {
  const z = new PizZip(await docx());
  z.file(
    "word/document.xml",
    '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///secret">]><a/>',
  );
  await expect(parseWiDocx(z.generate({ type: "nodebuffer" }))).rejects.toThrow(
    "unsupported XML",
  );
});
